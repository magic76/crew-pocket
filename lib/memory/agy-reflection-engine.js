const { spawn } = require('node:child_process');
const os = require('node:os');
const { MemoryReflectionEngine } = require('./reflection-engine');

const DEFAULT_MODEL = 'gemini-3.7-flash';
const DEFAULT_TIMEOUT_MS = 22000;

function sanitizeEvidenceText(value, maxLength = 4000) {
  return String(value || '')
    .replace(/(["']?(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret|password|authorization)["']?\s*[:=]\s*)[^,\s"']+/gi, '$1[REDACTED]')
    .replace(/\b[A-Z][A-Z0-9_]{2,}\s*=\s*\S+/g, '[ENV_REDACTED]')
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED]')
    .slice(0, maxLength);
}

function normalizeReflectionInput(input = {}) {
  return {
    role: {
      id: String(input.roleId || '').slice(0, 160),
      name: String(input.roleName || '').slice(0, 160)
    },
    project: input.projectId ? {
      id: String(input.projectId).slice(0, 160),
      name: String(input.projectName || '').slice(0, 160)
    } : null,
    executionMode: String(input.executionMode || '').slice(0, 40),
    taskSummary: sanitizeEvidenceText(input.taskSummary, 700),
    userRequest: sanitizeEvidenceText(input.prompt, 2600),
    finalResult: sanitizeEvidenceText(input.response, 4200),
    changedFiles: Array.isArray(input.changedFiles)
      ? input.changedFiles.map(value => sanitizeEvidenceText(value, 300)).filter(Boolean).slice(0, 20)
      : [],
    toolMetrics: {
      executions: Number(input.toolMetrics?.executions) || 0,
      uniqueTools: Number(input.toolMetrics?.unique_tools) || 0,
      changedFiles: Number(input.toolMetrics?.changed_files?.length) || 0
    }
  };
}

function buildReflectionPrompt(input) {
  const evidence = normalizeReflectionInput(input);
  return `You are Crew Pocket Memory Reflector.

Extract only durable, reusable long-term knowledge from ONE completed agent turn.
This is not transcript summarization. Return zero memories when the turn contains only temporary progress, routine execution, pleasantries, or facts unlikely to help a future task.

Hard rules:
- Output JSON only, exactly: {"memories":[...]}.
- Return at most 3 memories.
- Each memory must be a concise standalone statement, preferably one sentence and under 420 characters.
- Never copy a whole user or assistant message.
- Never store secrets, credentials, tokens, private keys, authorization headers, or environment values.
- Never store transient status such as "build passed today", temporary timestamps, request IDs, or a one-off current task state.
- Prefer reusable architecture decisions, stable constraints, workflows, recurring failure lessons, source-of-truth rules, and explicit durable preferences.
- Allowed scopes are ROLE and PROJECT only. Use PROJECT for repository/product-specific knowledge and ROLE for reusable experience of this Role.
- Allowed kinds: architecture, decision, constraint, workflow, lesson, preference.
- confidence and importance must be numbers from 0 to 1.
- Use concise English while preserving exact identifiers, file paths, API names, commands, and product names when they matter.
- If evidence is insufficient, output {"memories":[]}.

Each item schema:
{"text":"...","scope":"ROLE|PROJECT","kind":"architecture|decision|constraint|workflow|lesson|preference","importance":0.0,"confidence":0.0,"tags":["..."]}

Evidence:
${JSON.stringify(evidence)}

Return JSON only.`;
}

function extractAgyResponseText(output) {
  const raw = String(output || '').trim();
  if (!raw) return '';

  try {
    const direct = JSON.parse(raw);
    if (direct && Array.isArray(direct.memories)) return raw;
    if (typeof direct?.result?.response === 'string') return direct.result.response.trim();
  } catch (_) {}

  let streamed = '';
  let finalResponse = '';
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line);
      if (typeof item?.result?.response === 'string') finalResponse = item.result.response;
      else if (typeof item?.step_update?.text_delta === 'string') streamed += item.step_update.text_delta;
    } catch (_) {}
  }
  return String(finalResponse || streamed || raw).trim();
}

function parseReflectionOutput(output) {
  let text = extractAgyResponseText(output)
    .replace(/^\s*\`\`\`(?:json)?\s*/i, '')
    .replace(/\s*\`\`\`\s*$/i, '')
    .trim();
  if (!text) return [];

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return [];
    try { parsed = JSON.parse(text.slice(start, end + 1)); }
    catch (_) { return []; }
  }
  return Array.isArray(parsed?.memories) ? parsed.memories.slice(0, 3) : [];
}

class AgyMemoryReflectionEngine extends MemoryReflectionEngine {
  constructor({
    model = DEFAULT_MODEL,
    effort = 'low',
    timeoutMs = DEFAULT_TIMEOUT_MS,
    cwd = process.env.HOME || os.homedir(),
    spawnImpl = spawn
  } = {}) {
    super();
    this.model = model;
    this.effort = effort;
    this.timeoutMs = timeoutMs;
    this.cwd = cwd;
    this.spawnImpl = spawnImpl;
  }

  async extract(input) {
    const prompt = buildReflectionPrompt(input);
    return new Promise((resolve, reject) => {
      const child = this.spawnImpl('agy', [
        '--prompt', prompt,
        '--model', this.model,
        '--effort', this.effort,
        '--dangerously-skip-permissions'
      ], {
        cwd: this.cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      let settled = false;
      child.stdout?.setEncoding?.('utf8');
      child.stderr?.setEncoding?.('utf8');
      child.stdout?.on('data', chunk => { stdout += String(chunk); });
      child.stderr?.on('data', chunk => { stderr += String(chunk); });

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child.kill('SIGKILL'); } catch (_) {}
        reject(new Error('Memory reflection timed out'));
      }, this.timeoutMs);

      child.on('error', error => {
        clearTimeout(timeout);
        if (settled) return;
        settled = true;
        reject(error);
      });

      child.on('close', code => {
        clearTimeout(timeout);
        if (settled) return;
        settled = true;
        const memories = parseReflectionOutput(stdout);
        if (code !== 0 && !memories.length) {
          return reject(new Error(String(stderr || `agy exited with code ${code}`).trim().slice(-1200)));
        }
        resolve(memories);
      });
    });
  }
}

module.exports = {
  AgyMemoryReflectionEngine,
  DEFAULT_MODEL,
  buildReflectionPrompt,
  extractAgyResponseText,
  normalizeReflectionInput,
  parseReflectionOutput,
  sanitizeEvidenceText
};
