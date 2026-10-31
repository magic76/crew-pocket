'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { proposalsFromTrace, dedupeKey, short } = require('./classifier');
const { evaluateCandidate } = require('./evaluator');

const DEFAULT_PATH = process.env.CREW_TOOL_IMPROVEMENTS_PATH ||
  path.join(os.homedir(), '.crew-pocket', 'tool-improvements.json');
const MAX_CANDIDATES = 300;
const MAX_REFS = 128;
const MAX_EVENTS = 600;
const MAX_PATTERNS = 100;
function emptyState() { return { version: 1, candidates: [], patterns: {}, events: [] }; }
function uniqueLimited(list, add) {
  return [...new Set([...(Array.isArray(list) ? list : []), ...(Array.isArray(add) ? add : [])])].slice(0, MAX_REFS);
}
function recordEvent(state, type, candidate, at, detail = {}) {
  state.events.push({ type, candidateId: candidate.id, at, ...detail });
  state.events = state.events.slice(-MAX_EVENTS);
}
function mergeEvidence(target, proposal, at) {
  const prior = target.sourceEvidence.length;
  target.sourceEvidence = uniqueLimited(target.sourceEvidence, proposal.sourceEvidence);
  target.sourceTaskIds = uniqueLimited(target.sourceTaskIds, proposal.sourceTaskIds);
  target.sourceTrajectoryIds = uniqueLimited(target.sourceTrajectoryIds, proposal.sourceTrajectoryIds);
  target.evidenceCount = target.sourceEvidence.length; // bounded observed references, never fabricated counts
  target.taskCount = target.sourceTaskIds.length;
  if (target.sourceEvidence.length > prior) target.updatedAt = new Date(at).toISOString();
  return target.sourceEvidence.length > prior;
}
function addCandidate(state, proposal, at) {
  const key = dedupeKey(proposal);
  const existing = state.candidates.find(c => c.dedupeKey === key);
  if (existing) {
    if (mergeEvidence(existing, proposal, at)) recordEvent(state, 'candidateMergedEvidence', existing, at);
    return existing;
  }
  if (state.candidates.length >= MAX_CANDIDATES) return null;
  const candidate = {
    id: 'tool-improvement-' + key.slice(0, 24), dedupeKey: key,
    toolId: proposal.toolId ?? null, toolName: proposal.toolName || null,
    type: proposal.type, rootCause: proposal.rootCause,
    title: proposal.title, problem: proposal.problem, proposal: proposal.proposal,
    sourceEvidence: [], sourceTaskIds: [], sourceTrajectoryIds: [],
    expectedBenefit: proposal.expectedBenefit || null,
    baselineHash: proposal.baselineHash || null,
    candidateHash: null, status: 'candidate',
    createdAt: new Date(at).toISOString(), updatedAt: new Date(at).toISOString(),
    evidenceCount: 0, taskCount: 0, evaluation: null
  };
  mergeEvidence(candidate, proposal, at);
  state.candidates.push(candidate);
  recordEvent(state, 'candidateCreated', candidate, at);
  return candidate;
}
function observeAtomicSequence(state, trace, at) {
  // Never infer "same atomic task" from mere adjacency of tools.
  // Requires an observed, structured task key set by a capability/trajectory source.
  const key = short(trace.atomicTaskKey, 100);
  const id = short(trace.request_id || trace.requestId, 120);
  const provider = short(trace.provider, 60);
  const conversation = short(trace.conversation_id || trace.conversationId, 180);
  const tools = Array.isArray(trace.tools) ? trace.tools : [];
  const names = tools.map(tool => short(tool.tool_name || tool.name, 100));
  if (trace.atomicTask !== true || !/^[A-Za-z0-9._-]{3,100}$/.test(key) ||
    names.length < 3 || names.length > 8 || names.some(name => !name) ||
    !id || !provider || !conversation) return null;
  const patternKey = crypto.createHash('sha256').update(key + '\0' + names.join('\0')).digest('hex');
  let pattern = state.patterns[patternKey];
  if (!pattern) {
    if (Object.keys(state.patterns).length >= MAX_PATTERNS) return null;
    pattern = { taskKey: key, names, evidence: [], elapsed: [], failedTurns: 0 };
    state.patterns[patternKey] = pattern;
  }
  const ref = 'execution-feedback:' + provider + ':' + conversation + ':' + id + ':sequence';
  if (!pattern.evidence.includes(ref) && pattern.evidence.length < MAX_REFS) {
    pattern.evidence.push(ref);
    if (Number.isFinite(trace.elapsed_ms) && trace.elapsed_ms >= 0) pattern.elapsed.push(trace.elapsed_ms);
    if (['failed', 'error'].includes(trace.status)) pattern.failedTurns++;
  }
  if (pattern.evidence.length < 3) return null;
  const count = pattern.evidence.length;
  const averageLatency = pattern.elapsed.length ?
    Math.round(pattern.elapsed.reduce((a, b) => a + b, 0) / pattern.elapsed.length) : null;
  return addCandidate(state, {
    toolId: null, toolName: null, type: 'new-capability', rootCause: 'MISSING_CAPABILITY',
    title: 'Repeated atomic tool sequence: ' + key,
    problem: 'Observed atomic task ' + key + ' repeatedly requires ' + names.join(' → '),
    proposal: 'Review a single explicit capability for ' + key + '; do not create or deploy a tool automatically.',
    sourceEvidence: pattern.evidence, sourceTaskIds: pattern.evidence.map(ref => ref.split(':')[3]),
    sourceTrajectoryIds: pattern.evidence.map(ref => ref.split(':')[3]),
    expectedBenefit: {
      retries: 'Measured sequence frequency: ' + count + ' turns; average steps: ' + names.length,
      latency: averageLatency === null ? 'Not measured' : 'Observed whole-turn mean: ' + averageLatency + ' ms (not isolated sequence latency)',
      success: 'Observed turn failure rate: ' + (pattern.failedTurns / count).toFixed(2) + ' (not verified task success)'
    },
    baselineHash: null
  }, at);
}

class ToolImprovementStore {
  constructor({ storagePath = DEFAULT_PATH, now = Date.now } = {}) {
    this.storagePath = storagePath;
    this.now = now;
    this.queue = Promise.resolve();
  }
  async readState() {
    try {
      const state = JSON.parse(await fs.readFile(this.storagePath, 'utf8'));
      if (state.version !== 1 || !Array.isArray(state.candidates) ||
          !Array.isArray(state.events) || !state.patterns || Array.isArray(state.patterns)) {
        throw new Error('Invalid tool improvement store');
      }
      return state;
    } catch (error) {
      if (error.code === 'ENOENT') return emptyState();
      throw error;
    }
  }
  async writeState(state) {
    await fs.mkdir(path.dirname(this.storagePath), { recursive: true, mode: 0o700 });
    const temp = this.storagePath + '.' + crypto.randomUUID() + '.tmp';
    try {
      await fs.writeFile(temp, JSON.stringify(state, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      await fs.rename(temp, this.storagePath);
    } finally {
      await fs.rm(temp, { force: true }).catch(() => {});
    }
  }
  mutate(fn) {
    const operation = this.queue.then(async () => {
      const state = await this.readState();
      const result = await fn(state);
      if (result.changed) await this.writeState(state);
      return result.value;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async list() {
    await this.queue;
    return (await this.readState()).candidates.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id) {
    if (!/^tool-improvement-[a-f0-9]{24}$/.test(id || '')) return null;
    return (await this.list()).find(candidate => candidate.id === id) || null;
  }
  async observeTurn(trace) {
    // Input is the existing execution-feedback/turn-metrics projection.
    // Raw output and tool arguments remain in their original stores.
    if (!trace || !trace.request_id || !trace.conversation_id || !trace.provider ||
      !Array.isArray(trace.tools)) return [];
    return this.mutate(state => {
      const at = this.now();
      const proposals = proposalsFromTrace(trace);
      const candidates = proposals.map(p => addCandidate(state, p, at)).filter(Boolean);
      const sequence = observeAtomicSequence(state, trace, at);
      if (sequence) candidates.push(sequence);
      return { changed: candidates.length > 0 || Object.keys(state.patterns).length > 0, value: candidates };
    });
  }
  async reject(id) {
    return this.mutate(state => {
      const candidate = state.candidates.find(item => item.id === id);
      if (!candidate) return { changed: false, value: null };
      if (!['candidate', 'evaluating', 'validated'].includes(candidate.status)) {
        return { changed: false, value: candidate };
      }
      candidate.status = 'rejected';
      candidate.updatedAt = new Date(this.now()).toISOString();
      recordEvent(state, 'candidateRejected', candidate, this.now());
      return { changed: true, value: candidate };
    });
  }
  async evaluate(id, cases, runCase) {
    const candidate = await this.get(id);
    if (!candidate || candidate.status === 'rejected') return null;
    const evaluation = await evaluateCandidate(candidate, cases, runCase);
    return this.mutate(state => {
      const current = state.candidates.find(item => item.id === id);
      if (!current || current.status === 'rejected') return { changed: false, value: null };
      current.evaluation = evaluation;
      // Regression and insufficient replay NEVER validate the proposal.
      current.status = evaluation.verdict === 'improved' && current.baselineHash &&
        evaluation.candidateHash && !evaluation.regressions.length ? 'validated' : 'candidate';
      current.candidateHash = evaluation.candidateHash || null;
      current.updatedAt = new Date(this.now()).toISOString();
      recordEvent(state, 'candidateEvaluated', current, this.now(), {
        verdict: evaluation.verdict,
        baselineSuccess: evaluation.baseline?.taskSuccessRate ?? null,
        candidateSuccess: evaluation.candidate?.taskSuccessRate ?? null,
        baselineTokens: evaluation.baseline?.tokens ?? null,
        candidateTokens: evaluation.candidate?.tokens ?? null,
        baselineLatency: evaluation.baseline?.latencyMs ?? null,
        candidateLatency: evaluation.candidate?.latencyMs ?? null,
        baselineRetries: evaluation.baseline?.retries ?? null,
        candidateRetries: evaluation.candidate?.retries ?? null
      });
      if (current.status === 'validated') recordEvent(state, 'candidateValidated', current, this.now());
      return { changed: true, value: current };
    });
  }
}
const defaultToolImprovementStore = new ToolImprovementStore();
module.exports = { ToolImprovementStore, defaultToolImprovementStore, emptyState };
