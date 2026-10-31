'use strict';

const crypto = require('node:crypto');

const GROUPS = ['source', 'similar', 'regression'];
const MEASURES = ['toolErrorRate', 'retries', 'toolCalls', 'tokens', 'latencyMs', 'recoveryCount'];
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const measured = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function normalizeMetrics(input) {
  if (typeof input?.taskSuccess !== 'boolean' || MEASURES.some(key => !measured(input[key])) ||
      input.toolErrorRate > 1) return null;
  return { taskSuccess: input.taskSuccess, ...Object.fromEntries(MEASURES.map(key => [key, input[key]])) };
}
function aggregate(rows) {
  if (!rows.length) return null;
  const avg = (field) => rows.reduce((sum, row) => sum + row[field], 0) / rows.length;
  return {
    taskSuccessRate: rows.filter(row => row.taskSuccess).length / rows.length,
    ...Object.fromEntries(MEASURES.map(key => [key, avg(key)]))
  };
}
function differences(base, next) {
  if (!base || !next) return null;
  return Object.fromEntries(Object.keys(base).map(key => [key, next[key] - base[key]]));
}
function insufficient(candidateId, reason) {
  return {
    candidateId, baselineHash: null, candidateHash: null,
    baseline: null, candidate: null, delta: null, cases: [], regressions: [],
    verdict: 'insufficient-data', reason
  };
}

// P0 is runner-agnostic. A runner MUST execute immutable historical tasks
// against independently pinned baseline/candidate implementations. This
// function never pretends stored output or heuristics are a real replay.
async function evaluateCandidate(candidate, cases = [], runCase) {
  if (!candidate?.id) throw new Error('Candidate id required');
  if (!/^[a-f0-9]{64}$/i.test(candidate.baselineHash || '')) {
    return insufficient(candidate.id, 'Missing immutable baseline tool version hash');
  }
  if (typeof runCase !== 'function') return insufficient(candidate.id, 'No offline replay runner connected');
  if (!Array.isArray(cases) || cases.length < 3 || cases.length > 60 ||
      !GROUPS.every(group => cases.some(item => item?.group === group)) ||
      cases.some(item => !GROUPS.includes(item?.group) || !/^[A-Za-z0-9._-]{1,160}$/.test(item.id || '') ||
        !/^[a-f0-9]{64}$/i.test(item.snapshotHash || '')) ||
      new Set(cases.map(item => item.id)).size !== cases.length) {
    return insufficient(candidate.id, 'Replay requires distinct source, similar and held-out regression tasks');
  }
  const version = hash(candidate.baselineHash + '\0' + candidate.type + '\0' + candidate.proposal);
  if (candidate.candidateHash && candidate.candidateHash !== version) {
    return insufficient(candidate.id, 'Candidate proposal differs from pinned version');
  }
  const rows = [];
  try {
    for (const item of cases) {
      const baselineResult = await runCase({
        task: item, variant: 'baseline', toolHash: candidate.baselineHash, candidateId: candidate.id
      });
      const candidateResult = await runCase({
        task: item, variant: 'candidate', toolHash: version, candidateId: candidate.id
      });
      if (baselineResult?.toolHash !== candidate.baselineHash ||
          candidateResult?.toolHash !== version) {
        return insufficient(candidate.id, 'Replay runner did not confirm both pinned tool versions');
      }
      const baseline = normalizeMetrics(baselineResult);
      const proposed = normalizeMetrics(candidateResult);
      if (!baseline || !proposed) return insufficient(candidate.id, 'Replay returned incomplete or unverified metrics');
      rows.push({ taskId: item.id, group: item.group, baseline, candidate: proposed });
    }
  } catch (_) {
    return insufficient(candidate.id, 'Offline replay did not complete');
  }
  const baseline = aggregate(rows.map(row => row.baseline));
  const proposed = aggregate(rows.map(row => row.candidate));
  const regressions = [];
  for (const row of rows) {
    const b = row.baseline, c = row.candidate;
    if (b.taskSuccess && !c.taskSuccess) regressions.push({ taskId: row.taskId, group: row.group, metric: 'taskSuccess' });
    if (c.toolErrorRate > b.toolErrorRate + 0.00001) regressions.push({ taskId: row.taskId, group: row.group, metric: 'toolErrorRate' });
    // Guard against large cost regressions; small latency variation alone is
    // not enough to promote a candidate but may reflect normal environment noise.
    for (const key of ['retries', 'toolCalls', 'tokens', 'latencyMs', 'recoveryCount']) {
      if (c[key] > b[key] * 1.2 && c[key] - b[key] > (key === 'latencyMs' ? 500 : key === 'tokens' ? 250 : 1)) {
        regressions.push({ taskId: row.taskId, group: row.group, metric: key });
      }
    }
  }
  const improved = rows.some(row => (
    (!row.baseline.taskSuccess && row.candidate.taskSuccess) ||
    MEASURES.some(key => row.candidate[key] < row.baseline[key] - 0.00001)
  ));
  return {
    candidateId: candidate.id, baselineHash: candidate.baselineHash, candidateHash: version,
    baseline, candidate: proposed, delta: differences(baseline, proposed),
    cases: rows, regressions,
    verdict: regressions.length ? 'regressed' : improved ? 'improved' : 'neutral',
    reason: null
  };
}
module.exports = { GROUPS, MEASURES, evaluateCandidate, normalizeMetrics, aggregate };
