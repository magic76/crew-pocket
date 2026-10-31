'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { classifyRootCause, proposalsFromTrace, dedupeKey } = require('../lib/tool-improvement/classifier');
const { ToolImprovementStore } = require('../lib/tool-improvement/store');
const { evaluateCandidate } = require('../lib/tool-improvement/evaluator');

const VERSION = 'a'.repeat(64);
const metrics = (changes = {}) => ({
  taskSuccess: true, toolErrorRate: 0.2, retries: 2,
  toolCalls: 4, tokens: 4200, latencyMs: 5300, recoveryCount: 1,
  ...changes
});
const cases = [
  { id: 'source-1', group: 'source', snapshotHash: '1'.repeat(64) },
  { id: 'similar-1', group: 'similar', snapshotHash: '2'.repeat(64) },
  { id: 'held-out-1', group: 'regression', snapshotHash: '3'.repeat(64) }
];
const goodRunner = async ({ variant, toolHash }) => ({ ...(variant === 'baseline' ? metrics() : metrics({
  toolErrorRate: 0.1, retries: 1, toolCalls: 3, tokens: 3200, latencyMs: 4400, recoveryCount: 0
})), toolHash });
function trace(toolInfo = { error: 'failed' }, changes = {}) {
  return {
    provider: 'codex', conversation_id: 'conversation1',
    request_id: 'request000000001', status: 'completed',
    tools: [{
      tool_group_id: 'tool-1', tool_name: 'run_npm_script',
      state: 'failed', attempts: 1,
      tool_info: toolInfo
    }],
    ...changes
  };
}
async function withStore(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-atat-'));
  try {
    const store = new ToolImprovementStore({ storagePath: path.join(dir, 'candidates.json') });
    return await fn(store, dir);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

test('failure trajectory yields error candidate with stable provenance', () => {
  const candidates = proposalsFromTrace(trace());
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].type, 'error');
  assert.match(candidates[0].sourceEvidence[0], /execution-feedback:codex:conversation1:request000000001:tool:tool-1/);
});
test('healthy, low-cost completed trajectory yields no candidates', () => {
  assert.deepEqual(proposalsFromTrace(trace({}, {
    tools: [{ tool_group_id: 'tool-1', tool_name: 'read', state: 'completed', attempts: 1, tool_info: {} }]
  })), []);
});
test('explicit tool-selection evidence generates description candidate', () => {
  const t = trace({ selection_mismatch: true });
  assert.equal(classifyRootCause(t.tools[0], t), 'TOOL_DESCRIPTION');
  assert.equal(proposalsFromTrace(t)[0].type, 'description');
});
test('schema errors classify even when outcome is generic failure', () => {
  const t = trace({ error: 'missing required parameter: mergeMethod' });
  assert.equal(classifyRootCause(t.tools[0], t), 'TOOL_SCHEMA');
  assert.equal(proposalsFromTrace(t)[0].type, 'schema');
});
test('large re-read output generates output candidate without copying raw data', () => {
  const t = trace({ output_bytes: 120000, reread_count: 3, error: null }, {
    tools: [{ tool_group_id: 'tool-1', tool_name: 'search', state: 'completed', attempts: 1,
      tool_info: { output_bytes: 120000, reread_count: 3, output: 'SECRET_RAW_TOOL_OUTPUT' } }]
  });
  assert.equal(proposalsFromTrace(t)[0].type, 'output');
  assert.doesNotMatch(JSON.stringify(proposalsFromTrace(t)), /SECRET_RAW_TOOL_OUTPUT/);
});
test('recovered tool retains historical failed-attempt signal', () => {
  const t = trace({ error: 'failed' }, {
    tools: [{ tool_group_id: 'tool-1', tool_name: 'run_npm_script',
      state: 'completed', had_failure: true, attempts: 2, tool_info: { error: 'failed' } }]
  });
  assert.equal(proposalsFromTrace(t)[0].type, 'error');
});
test('missing script produces preflight proposal', () => {
  assert.match(proposalsFromTrace(trace({ error_code: 'SCRIPT_NOT_FOUND' }))[0].proposal, /package\.json/);
});
test('agent strategy attribution cannot be converted to tool candidate', () => {
  const t = trace({ error: 'missing required parameter' }, { failureAttribution: 'agent' });
  assert.equal(classifyRootCause(t.tools[0], t), 'AGENT_STRATEGY');
  assert.equal(proposalsFromTrace(t).length, 0);
});
test('harness attribution cannot be converted to tool candidate', () => {
  const t = trace({ error: 'failed' }, { failureAttribution: 'harness' });
  assert.equal(classifyRootCause(t.tools[0], t), 'HARNESS');
  assert.deepEqual(proposalsFromTrace(t), []);
});
test('explicit harness failure produces runtime candidate, not tool candidate', () => {
  const t = trace({ error: 'failed' }, { failureAttribution: 'harness', status: 'failed' });
  const result = proposalsFromTrace(t);
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'runtime');
  assert.equal(result[0].toolId, null);
});
test('environment attribution is diagnostic, not tool improvement', () => {
  const t = trace({ error: 'failed' }, { failureAttribution: 'environment' });
  assert.equal(classifyRootCause(t.tools[0], t), 'ENVIRONMENT');
  assert.equal(proposalsFromTrace(t).length, 0);
});
test('unknown task failure alone does not imply a faulty tool', () => {
  const t = trace({}, { status: 'failed', tools: [{ tool_group_id: 'tool-1', tool_name: 'search',
    state: 'completed', tool_info: {} }] });
  assert.equal(proposalsFromTrace(t).length, 0);
});
test('equivalent tool/problem dedupes independent of spacing', () => {
  const base = proposalsFromTrace(trace())[0];
  assert.equal(dedupeKey(base), dedupeKey({ ...base, problem: '  ' + base.problem.toUpperCase() + '  ' }));
});
test('store accumulates independent evidence without duplicating same request', async () => withStore(async store => {
  await store.observeTurn(trace());
  await store.observeTurn(trace());
  await store.observeTurn(trace({ error: 'failed' }, { request_id: 'request000000002' }));
  const list = await store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].evidenceCount, 2);
  assert.equal(list[0].taskCount, 2);
  assert.equal(list[0].sourceTrajectoryIds.length, 2);
}));
test('missing capability needs 3 distinct tagged atomic sequences', async () => withStore(async store => {
  const tools = ['open_settings', 'search_settings', 'toggle_setting'].map((name, i) => ({
    tool_group_id: 't' + i, tool_name: name, state: 'completed', attempts: 1, tool_info: {}
  }));
  for (let n = 1; n <= 3; n++) {
    await store.observeTurn(trace({}, { tools, request_id: 'request00000000' + n,
      atomicTask: true, atomicTaskKey: 'toggle_bluetooth', elapsed_ms: 1200 }));
    assert.equal((await store.list()).length, n === 3 ? 1 : 0);
  }
  const candidate = (await store.list())[0];
  assert.equal(candidate.type, 'new-capability');
  assert.equal(candidate.taskCount, 3);
  assert.match(candidate.expectedBenefit.latency, /1200 ms/);
}));
test('untagged repeated sequences never create capabilities', async () => withStore(async store => {
  const tools = ['open', 'search', 'tap'].map((name, i) => ({
    tool_group_id: 't' + i, tool_name: name, state: 'completed', tool_info: {}
  }));
  for (let n = 1; n <= 4; n++) await store.observeTurn(trace({}, {
    tools, request_id: 'request00000000' + n
  }));
  assert.deepEqual(await store.list(), []);
}));
test('evaluation exposes pinned versions, baseline, candidate and deltas', async () => {
  const result = await evaluateCandidate({ id: 'c1', baselineHash: VERSION, type: 'error',
    proposal: 'Add deterministic script alternatives' }, cases, goodRunner);
  assert.equal(result.verdict, 'improved');
  assert.equal(result.baselineHash, VERSION);
  assert.match(result.candidateHash, /^[a-f0-9]{64}$/);
  assert.equal(result.baseline.tokens, 4200);
  assert.equal(result.candidate.tokens, 3200);
  assert.equal(result.delta.tokens, -1000);
});
test('missing immutable tool version always fails closed', async () => {
  const result = await evaluateCandidate({ id: 'c1', type: 'error', proposal: 'fix' }, cases, goodRunner);
  assert.equal(result.verdict, 'insufficient-data');
});
test('missing held-out regression group cannot validate', async () => {
  const result = await evaluateCandidate({ id: 'c1', baselineHash: VERSION,
    type: 'error', proposal: 'fix' }, cases.slice(0, 2), goodRunner);
  assert.equal(result.verdict, 'insufficient-data');
});
test('source success with held-out failure is a regression', async () => {
  const result = await evaluateCandidate({ id: 'c1', baselineHash: VERSION,
    type: 'error', proposal: 'fix' }, cases, async ({ variant, task, toolHash }) => ({
    ...(variant === 'baseline' ? metrics() :
      task.group === 'regression' ? metrics({ taskSuccess: false }) :
        metrics({ retries: 1, tokens: 3000 })), toolHash
  }));
  assert.equal(result.verdict, 'regressed');
  assert.ok(result.regressions.some(row => row.taskId === 'held-out-1' && row.metric === 'taskSuccess'));
});
test('replay failure and incomplete metrics do not validate', async () => {
  const candidate = { id: 'c1', baselineHash: VERSION, type: 'schema', proposal: 'fix' };
  assert.equal((await evaluateCandidate(candidate, cases, async () => { throw Error('no runner'); })).verdict, 'insufficient-data');
  assert.equal((await evaluateCandidate(candidate, cases, async ({ toolHash }) => ({ taskSuccess: true, toolHash }))).verdict, 'insufficient-data');
});
test('store validates only evaluated improvement and never promotes', async () => withStore(async store => {
  const t = trace({ error: 'failed', tool_hash: VERSION });
  await store.observeTurn(t);
  const before = (await store.list())[0];
  assert.equal(before.status, 'candidate');
  const after = await store.evaluate(before.id, cases, goodRunner);
  assert.equal(after.status, 'validated');
  assert.equal(after.evaluation.verdict, 'improved');
  assert.notEqual(after.status, 'promoted');
  assert.equal((await store.list())[0].status, 'validated');
}));
test('failed held-out replay leaves candidate unvalidated', async () => withStore(async store => {
  await store.observeTurn(trace({ error: 'failed', tool_hash: VERSION }));
  const candidate = (await store.list())[0];
  const next = await store.evaluate(candidate.id, cases, async ({ variant, task, toolHash }) => ({
    ...(variant === 'baseline' ? metrics() :
      task.group === 'regression' ? metrics({ taskSuccess: false }) : metrics({ retries: 0 })), toolHash
  })
  );
  assert.equal(next.status, 'candidate');
  assert.equal(next.evaluation.verdict, 'regressed');
}));
test('rejected candidates cannot be evaluated or promoted', async () => withStore(async store => {
  await store.observeTurn(trace({ error: 'failed', tool_hash: VERSION }));
  const id = (await store.list())[0].id;
  assert.equal((await store.reject(id)).status, 'rejected');
  assert.equal(await store.evaluate(id, cases, goodRunner), null);
  assert.equal((await store.list())[0].status, 'rejected');
}));
test('raw tool output is not duplicated in candidate store', async () => withStore(async (store, dir) => {
  await store.observeTurn(trace({ error: 'failed', output: 'HIGHLY_PRIVATE_RAW_TOOL_RESULT' }));
  const data = await fs.readFile(path.join(dir, 'candidates.json'), 'utf8');
  assert.doesNotMatch(data, /HIGHLY_PRIVATE_RAW_TOOL_RESULT/);
}));
test('audit events record creation, merge, evaluation and validation', async () => withStore(async (store, dir) => {
  await store.observeTurn(trace({ error: 'failed', tool_hash: VERSION }));
  await store.observeTurn(trace({ error: 'failed' }, { request_id: 'request000000002' }));
  await store.evaluate((await store.list())[0].id, cases, goodRunner);
  const state = JSON.parse(await fs.readFile(path.join(dir, 'candidates.json'), 'utf8'));
  assert.deepEqual(state.events.map(item => item.type), [
    'candidateCreated', 'candidateMergedEvidence', 'candidateEvaluated', 'candidateValidated'
  ]);
  const event = state.events.find(item => item.type === 'candidateEvaluated');
  assert.equal(event.baselineTokens, 4200);
  assert.equal(event.candidateTokens, 3200);
}));
test('P0 integration does not define any production promotion endpoint', async () => {
  const source = await fs.readFile(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /handleToolImprovements/);
  assert.match(source, /No trusted offline historical replay runner/);
  assert.doesNotMatch(source, /api\/tool-improvements\/:id\/promote/);
});
