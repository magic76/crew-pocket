'use strict';

const crypto = require('node:crypto');

const ROOT_CAUSES = Object.freeze([
  'AGENT_STRATEGY', 'HARNESS', 'TOOL_DESCRIPTION', 'TOOL_SCHEMA',
  'TOOL_OUTPUT', 'TOOL_ERROR', 'MISSING_CAPABILITY', 'ENVIRONMENT', 'UNKNOWN'
]);
const TOOL_TYPES = Object.freeze({
  TOOL_DESCRIPTION: 'description', TOOL_SCHEMA: 'schema',
  TOOL_OUTPUT: 'output', TOOL_ERROR: 'error',
  MISSING_CAPABILITY: 'new-capability', HARNESS: 'runtime'
});
const toolCauses = new Set(['TOOL_DESCRIPTION', 'TOOL_SCHEMA', 'TOOL_OUTPUT', 'TOOL_ERROR']);
const validCauses = new Set(ROOT_CAUSES);
const short = (value, max = 150) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const isFailure = state => /^(failed|error)$/.test(String(state || '').toLowerCase());

function classifyRootCause(tool, trace = {}) {
  const info = tool?.tool_info || tool?.info || {};
  // Strong task-level attribution overrides any lower-level tool symptom.
  if (trace.failureAttribution === 'agent') return 'AGENT_STRATEGY';
  if (trace.failureAttribution === 'harness') return 'HARNESS';
  if (trace.failureAttribution === 'environment') return 'ENVIRONMENT';
  const explicit = short(info.root_cause || info.rootCause || trace.rootCause, 50).toUpperCase();
  if (validCauses.has(explicit)) return explicit;
  const code = short(info.error_code || info.errorCode || '', 80).toUpperCase();
  const message = short(info.error || '', 1000);
  if (info.selection_mismatch === true || code === 'TOOL_SELECTION_AMBIGUOUS') return 'TOOL_DESCRIPTION';
  if (info.schema_invalid === true || /^(INVALID_(ARGUMENTS?|ENUM|PARAMETERS?)|SCHEMA_VALIDATION_FAILED)$/.test(code) ||
    /(?:missing required (?:field|argument|parameter)|unknown (?:argument|field|parameter)|invalid enum|schema validation|unrecognized (?:argument|field))/i.test(message)) return 'TOOL_SCHEMA';
  if (Number(info.output_bytes) >= 32768 && Number(info.reread_count) >= 2) return 'TOOL_OUTPUT';
  if (isFailure(tool?.state) && (code === 'SCRIPT_NOT_FOUND' ||
    /(?:missing script|script not found)/i.test(message))) return 'TOOL_ERROR';
  // A generic error is only an error-UX issue if the *tool invocation* failed.
  if (isFailure(tool?.state) && (/^(failed|error|unknown error|execution failed|something went wrong)[.!]?$/i.test(message) ||
    (info.error && !code && message.length < 12))) return 'TOOL_ERROR';
  return 'UNKNOWN';
}

function classifyTrajectory(trace = {}) {
  const tools = Array.isArray(trace.tools) ? trace.tools : [];
  return tools.map((tool, index) => ({
    index, toolName: short(tool.tool_name || tool.name, 100),
    cause: classifyRootCause(tool, trace)
  }));
}

function signalPresent(tool, trace = {}) {
  const info = tool?.tool_info || tool?.info || {};
  return isFailure(tool?.state) ||
    Number(tool?.attempts) >= 3 ||
    (Number(info.output_bytes) >= 32768 && Number(info.reread_count) >= 2) ||
    ['failed', 'error'].includes(String(trace.status || '').toLowerCase());
}

function toolProposal(tool, cause, trace = {}) {
  const info = tool?.tool_info || tool?.info || {};
  const name = short(tool?.tool_name || tool?.name || 'tool', 100);
  const error = short(info.error, 1000);
  const script = /(?:missing script|script not found)/i.test(error) ||
    short(info.error_code, 80).toUpperCase() === 'SCRIPT_NOT_FOUND';
  const proposals = {
    TOOL_DESCRIPTION: {
      problem: 'Tool selection is explicitly marked ambiguous or mismatched.',
      proposal: 'Clarify the tool description with supported search scope, non-goals and contrasting examples.'
    },
    TOOL_SCHEMA: {
      problem: 'Tool input failed required-field, enum or parameter validation.',
      proposal: 'Clarify required fields, accepted names and enum values without breaking existing callers.'
    },
    TOOL_OUTPUT: {
      problem: 'Large tool output was re-read at least twice in the same trace.',
      proposal: 'Keep raw evidence immutable; expose a separate structured result and concise derived model view.'
    },
    TOOL_ERROR: script ? {
      problem: 'A nonexistent script produced a failed tool invocation without actionable preflight.',
      proposal: 'Before execution, inspect the actual package.json scripts and return SCRIPT_NOT_FOUND with requested and available names.'
    } : {
      problem: 'A failed tool invocation returned an unhelpful generic error.',
      proposal: 'Return a stable machine-readable error code, observed failed precondition and deterministic recovery alternatives.'
    }
  };
  const spec = proposals[cause];
  if (!spec) return null;
  const requestId = short(trace.request_id || trace.requestId, 120);
  const provider = short(trace.provider, 60);
  const conversation = short(trace.conversation_id || trace.conversationId, 180);
  // These are references, NOT copied prompts, arguments or tool outputs.
  if (!requestId || !provider || !conversation || !tool?.tool_group_id && !tool?.toolId) return null;
  const toolRef = short(tool.tool_group_id || tool.toolId, 180);
  return {
    toolId: name, toolName: name, type: TOOL_TYPES[cause],
    rootCause: cause, title: name + ': ' + cause.toLowerCase().replaceAll('_', ' '),
    ...spec,
    sourceEvidence: ['execution-feedback:' + provider + ':' + conversation + ':' + requestId + ':tool:' + toolRef],
    sourceTaskIds: [requestId], sourceTrajectoryIds: [requestId],
    baselineHash: /^[a-f0-9]{64}$/i.test(String(info.tool_hash || '')) ? info.tool_hash.toLowerCase() : null,
    // A provider's mutable display name is not a version or a replay baseline.
    expectedBenefit: { retries: 'Reduce avoidable repair calls; must be confirmed in held-out replay.' }
  };
}

function proposalsFromTrace(trace = {}) {
  const requestId = short(trace.request_id || trace.requestId);
  const conversationId = short(trace.conversation_id || trace.conversationId);
  const provider = short(trace.provider);
  if (!requestId || !conversationId || !provider) return [];
  const tools = Array.isArray(trace.tools) ? trace.tools : [];
  const proposed = tools.flatMap(tool => {
    const cause = classifyRootCause(tool, trace);
    if (!toolCauses.has(cause) || !signalPresent(tool, trace)) return [];
    const proposal = toolProposal(tool, cause, trace);
    return proposal ? [proposal] : [];
  });
  // Harness proposals require explicit structured attribution; tool errors do
  // not imply runtime defects. They are never routed into Role Skill candidates.
  if (trace.failureAttribution === 'harness' && ['failed', 'error'].includes(trace.status)) {
    proposed.push({
      toolId: null, toolName: null, type: 'runtime', rootCause: 'HARNESS',
      title: 'Observed harness failure', problem: 'Structured trajectory attributes this failure to the harness runtime.',
      proposal: 'Investigate runtime preconditions and add deterministic runtime regression checks before any fix.',
      sourceEvidence: ['execution-feedback:' + provider + ':' + conversationId + ':' + requestId + ':turn'],
      sourceTaskIds: [requestId], sourceTrajectoryIds: [requestId],
      baselineHash: null, expectedBenefit: { success: 'Requires verified replay; no inferred task success.' }
    });
  }
  return proposed;
}

function normalizeProblem(value) {
  return short(value, 400).toLocaleLowerCase().replace(/\s+/g, ' ');
}
function dedupeKey(proposal) {
  return crypto.createHash('sha256').update([
    proposal.toolId || '', proposal.type, normalizeProblem(proposal.problem)
  ].join('\0')).digest('hex');
}
module.exports = {
  ROOT_CAUSES, TOOL_TYPES, classifyRootCause, classifyTrajectory,
  proposalsFromTrace, dedupeKey, short
};
