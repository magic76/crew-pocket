'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFingerprint } = require('../lib/context/tool-fingerprint');
const { normalizeTurn, aggregateSession, estimateUsd } = require('../lib/context/session-efficiency');
const { runBenchmark, readOptions } = require('../scripts/benchmark-session-efficiency');

const sig = readFingerprint({ name: 'Read', info: { parameters: { file_path: '/tmp/project/a.ts' } } });
const other = readFingerprint({ name: 'Read', info: { parameters: { file_path: '/tmp/project/b.ts' } } });

const turn = (conversation_id, at, fingerprint, input, cached, output, extra = {}) => ({
  conversation_id, provider: 'codex', model: 'gpt-6', role_id: 'dev',
  at, reason: 'completed', elapsed_ms: 1000, executions: 1,
  read_fingerprints: fingerprint ? [fingerprint] : [],
  context_stats: {
    turn_input_tokens: input, turn_cached_input_tokens: cached,
    turn_output_tokens: output
  },
  ...extra
});

test('tool read fingerprints are stable within a process and do not contain paths', () => {
  assert.match(sig, /^[a-f0-9]{32}$/);
  assert.notEqual(sig, other);
  assert.equal(sig, readFingerprint({ name:'Read', info:{ parameters:{file_path:'/tmp/project/a.ts'} } }));
  assert.ok(!sig.includes('/tmp'));
  assert.equal(readFingerprint({name:'apply_patch', info:{ parameters:{file_path:'/tmp/project/a.ts'} }}), null);
  assert.equal(readFingerprint({name:'shell', info:{ parameters:{command:'npm install'} }}), null);
  assert.match(readFingerprint({name:'shell', info:{parameters:{command:'rg TODO src'}}}), /^[a-f0-9]{32}$/);
  assert.equal(readFingerprint({name:'Read'}), null);
});

test('missing counters never turn into zero or cumulative spend', () => {
  const t = normalizeTurn({
    conversation_id: 'old', provider: 'claude', at: 100,
    context_stats: { total_input_tokens: 200000, last_input_tokens: 15000 }
  });
  assert.equal(t.inputTokens, null);
  assert.equal(t.cachedTokens, null);
  assert.equal(t.outputTokens, null);
  const session = aggregateSession([{
    conversation_id: 'old', provider:'claude', at:100,
    context_stats:{last_input_tokens:5000}, elapsed_ms:200
  }], [], { conversationId:'old', provider:'claude' });
  assert.equal(session.inputTokens, null);
  assert.equal(session.taskSuccess, null);
  assert.equal(session.measuredInputTurns, 0);
  assert.equal(estimateUsd(session, {inputPerMillion:2,cachedInputPerMillion:1,outputPerMillion:3}), null);
  assert.equal(normalizeTurn(turn('x', 0, null, 300, 350, null)).cachedTokens, null);
});

test('reacquisition signal needs a compaction AND identical read before/after', () => {
  const a = 1700000000000, at = a + 1500;
  const records = [
    turn('same', a, sig, 100, 0, 20),
    turn('same', a + 2000, sig, 100, 50, 20),
    turn('same', a + 2500, other, 100, 50, 20)
  ];
  const compacts = [{
    provider:'codex', conversationId:'same', didCompact:true,
    timestamp:new Date(at).toISOString()
  }];
  assert.equal(aggregateSession(records, [], {conversationId:'same',provider:'codex'}).suspectedReads, 0);
  const result = aggregateSession(records, compacts, {conversationId:'same',provider:'codex'});
  assert.equal(result.compactions, 1);
  assert.equal(result.evaluatedCompactions, 1);
  assert.equal(result.suspectedReads, 1);
  assert.equal(result.inputTokens, 300);
  assert.equal(result.cachedInputTokens, 100);
  assert.equal(result.outputTokens, 60);
  assert.equal(result.elapsedMs, 3000);
  const outside = [{...compacts[0],timestamp:new Date(a + 40 * 60000).toISOString()}];
  assert.equal(aggregateSession(records, outside, {conversationId:'same',provider:'codex'}).suspectedReads, 0);
});

test('offline A/B comparison preserves matching conditions and explicit task labels', () => {
  const baseline = [turn('before', 1700000000000, sig, 1000, 100, 100)];
  const candidate = [turn('after', 1700000001000, sig, 1200, 100, 100)];
  const manifest = {version:1,cases:[{
    id:'repo-read',provider:'codex',model:'gpt-6',cacheCondition:'warm',
    baseline:{conversationId:'before',taskSuccess:true},
    candidate:{conversationId:'after',taskSuccess:false}
  }]};
  const result = runBenchmark({
    manifest,baseline,candidate,
    pricing:{'codex/gpt-6':{inputPerMillion:3,cachedInputPerMillion:0.5,outputPerMillion:12}}
  });
  assert.equal(result.summary.successRegressions,1);
  assert.equal(result.summary.acceptance,'fail');
  assert.equal(result.cases[0].comparison.inputTokenDelta,0.2);
  assert.ok(result.cases[0].comparison.estimatedCostDelta > 0);
  assert.equal(result.cases[0].candidate.taskSuccess,false);
});

test('benchmark does not pass without independent task labels and output counters', () => {
  const raw = turn('b', 1700000000000, sig, 1000, 300, null);
  const raw2 = turn('c', 1700000000000, other, 100, 50, null);
  const manifest={version:1,cases:[{
    id:'inspect',provider:'codex',model:'gpt-6',cacheCondition:'cold',
    baseline:{conversationId:'b'},candidate:{conversationId:'c'}
  }]};
  const result=runBenchmark({
    manifest,baseline:[raw],candidate:[raw2],
    pricing:{'codex/gpt-6':{inputPerMillion:2,cachedInputPerMillion:1,outputPerMillion:10}}
  });
  assert.equal(result.summary.acceptance,'inconclusive');
  assert.equal(result.summary.pricedComparablePairs,0);
  assert.equal(result.cases[0].candidate.estimatedUsd,null);
  assert.throws(() => runBenchmark({
    manifest:{...manifest,cases:[{...manifest.cases[0],candidate:{conversationId:'b'}}]},
    baseline:[raw],candidate:[raw]
  }), /distinct conversations/);
  assert.throws(() => readOptions(['--baseline','b']),/Missing --manifest/);
});
