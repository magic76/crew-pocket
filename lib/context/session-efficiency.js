'use strict';

// Session-level measurements are deliberately separate from Context Health.
// Missing provider counters remain null; a context-window snapshot is NOT spend.
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const finite = value => Number.isFinite(value) && value >= 0 ? value : null;
const unique = list => [...new Set(list)];

function normalizeTurn(row) {
  const stats = row?.context_stats || {};
  const input = integer(stats.turn_input_tokens);
  const cached = integer(stats.turn_cached_input_tokens);
  const hasCache = input !== null && cached !== null && cached <= input;
  // Never promote "last model call" or cumulative thread counters to turn usage.
  const output = integer(stats.turn_output_tokens);
  return {
    at: finite(row?.at) ?? (Number.isFinite(Date.parse(row?.timestamp)) ? Date.parse(row.timestamp) : null),
    provider: typeof row?.provider === 'string' ? row.provider : null,
    model: typeof row?.model === 'string' ? row.model : null,
    conversationId: typeof row?.conversation_id === 'string' ? row.conversation_id : null,
    roleId: typeof row?.role_id === 'string' ? row.role_id : null,
    inputTokens: input,
    cachedTokens: hasCache ? cached : null,
    uncachedTokens: hasCache ? input - cached : null,
    outputTokens: output,
    elapsedMs: finite(row?.elapsed_ms),
    executions: integer(row?.executions),
    polls: integer(row?.polls),
    status: typeof row?.reason === 'string' ? row.reason : null,
    readFingerprints: unique((Array.isArray(row?.read_fingerprints) ? row.read_fingerprints : [])
      .filter(value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)))
  };
}

function normalizedCompactions(records, conversationId, provider) {
  return (records || []).filter(row =>
    row?.didCompact === true && row?.conversationId === conversationId &&
    row?.provider === provider && Number.isFinite(Date.parse(row.timestamp))
  ).map(row => Date.parse(row.timestamp)).sort((a, b) => a - b);
}

// Only call these "suspected": repeating a read across a compaction can be
// intentional (a file may have changed), and no instrumentation proves cause.
function suspectedReacquisitions(turns, compactTimes, { windowTurns = 3, maxGapMs = 30 * 60 * 1000 } = {}) {
  const evidence = new Set();
  let evaluated = 0;
  for (const at of compactTimes) {
    const before = turns.filter(turn => turn.at !== null && turn.at < at &&
      at - turn.at <= maxGapMs).slice(-windowTurns);
    const after = turns.filter(turn => turn.at !== null && turn.at >= at &&
      turn.at - at <= maxGapMs).slice(0, windowTurns);
    if (!before.length || !after.length) continue;
    const seen = new Set(before.flatMap(turn => turn.readFingerprints));
    const repeated = new Set(after.flatMap(turn => turn.readFingerprints)
      .filter(sig => seen.has(sig)));
    evaluated += 1;
    for (const sig of repeated) evidence.add(String(at) + ':' + sig);
  }
  return { evaluatedCompactions: evaluated, suspectedReads: evidence.size };
}

function aggregateSession(rawTurns, rawCompactions = [], { conversationId, provider } = {}) {
  const turns = rawTurns.map(normalizeTurn).filter(turn =>
    (!conversationId || turn.conversationId === conversationId) &&
    (!provider || turn.provider === provider)
  ).sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  if (!turns.length) return null;
  const id = conversationId || turns[0].conversationId;
  const engine = provider || turns[0].provider;
  const compacts = normalizedCompactions(rawCompactions, id, engine);
  const input = turns.filter(t => t.inputTokens !== null);
  const cached = turns.filter(t => t.cachedTokens !== null);
  const output = turns.filter(t => t.outputTokens !== null);
  const durations = turns.filter(t => t.elapsedMs !== null);
  const executions = turns.filter(t => t.executions !== null);
  const sum = (rows, field) => rows.reduce((total, row) => total + row[field], 0);
  const totalInput = input.length === turns.length ? sum(input, 'inputTokens') : null;
  const totalOutput = output.length === turns.length ? sum(output, 'outputTokens') : null;
  const totalCached = cached.length === turns.length ? sum(cached, 'cachedTokens') : null;
  const read = suspectedReacquisitions(turns, compacts);
  return {
    provider: engine,
    conversationId: id,
    model: turns.find(t => t.model)?.model || null,
    roleId: turns.find(t => t.roleId)?.roleId || null,
    turns: turns.length,
    measuredInputTurns: input.length,
    measuredCacheTurns: cached.length,
    measuredOutputTurns: output.length,
    inputTokens: totalInput,
    cachedInputTokens: totalCached,
    uncachedInputTokens: totalInput !== null && totalCached !== null ? totalInput - totalCached : null,
    outputTokens: totalOutput,
    cacheReadRate: totalInput !== null && totalCached !== null && totalInput > 0
      ? totalCached / totalInput : null,
    elapsedMs: durations.length === turns.length ? sum(durations, 'elapsedMs') : null,
    toolExecutions: executions.length === turns.length ? sum(executions, 'executions') : null,
    compactions: compacts.length,
    ...read,
    // Provider execution completed is not equivalent to task success.
    taskSuccess: null
  };
}

function estimateUsd(session, pricing) {
  if (!pricing || !Number.isFinite(pricing.inputPerMillion) ||
    !Number.isFinite(pricing.cachedInputPerMillion) ||
    !Number.isFinite(pricing.outputPerMillion) ||
    [pricing.inputPerMillion, pricing.cachedInputPerMillion, pricing.outputPerMillion].some(value => value < 0)) return null;
  if ([session?.uncachedInputTokens, session?.cachedInputTokens, session?.outputTokens]
    .some(value => value === null || value === undefined)) return null;
  return (session.uncachedInputTokens * pricing.inputPerMillion +
    session.cachedInputTokens * pricing.cachedInputPerMillion +
    session.outputTokens * pricing.outputPerMillion) / 1000000;
}

function relativeDelta(baseline, candidate) {
  return Number.isFinite(baseline) && Number.isFinite(candidate) && baseline > 0
    ? (candidate - baseline) / baseline : null;
}

module.exports = {
  normalizeTurn, normalizedCompactions, suspectedReacquisitions,
  aggregateSession, estimateUsd, relativeDelta
};
