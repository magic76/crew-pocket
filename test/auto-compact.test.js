const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {
  buildAutoCompactSignals, evaluateAutoCompact, autoCompactCooldown,
  calculateRepetitionScore, summarizeRepeatedTools, inferTaskStage
} = require('../lib/context/auto-compact');
const { analyzeContext, buildHistoryContextContributions } = require('../lib/context/health');
const { planContextCompaction } = require('../lib/context/compaction');

const source = file => require('node:fs').readFileSync(path.join(__dirname, '..', file), 'utf8');

function evalSignals(signals, extras = {}) {
  return evaluateAutoCompact({ signals: { workingStateStable: true, ...signals }, ...extras });
}

async function run() {
  // 1-4: none/suggest/auto plus unstable high score never auto.
  const low = evalSignals({ contextPressure: 0.15, staleContextRatio: 0.05 });
  const medium = evalSignals({ contextPressure: 0.52, staleContextRatio: 0.61,
    toolOutputRatio: 0.29, repetitionScore: 0.42, taskStageTransition: true });
  const high = evalSignals({ contextPressure: 0.98, staleContextRatio: 0.95,
    toolOutputRatio: 0.9, repetitionScore: 0.95, taskStageTransition: true });
  const unsafe = evalSignals({ contextPressure: 0.98, staleContextRatio: 0.95,
    toolOutputRatio: 0.9, repetitionScore: 0.95, taskStageTransition: true,
    workingStateStable: false });
  assert.equal(low.recommendation, 'none');
  assert.equal(medium.recommendation, 'suggest');
  assert.equal(high.recommendation, 'auto');
  assert.equal(unsafe.recommendation, 'suggest');
  assert.equal(unsafe.safeNow, false);

  // 5-9: every decision signal can increase scoring independently.
  const base = { contextPressure: 0.1, staleContextRatio: 0.1, toolOutputRatio: 0.1,
    repetitionScore: 0.1, taskStageTransition: false, workingStateStable: true };
  for (const key of ['contextPressure', 'staleContextRatio', 'toolOutputRatio', 'repetitionScore']) {
    assert.ok(evalSignals({ ...base, [key]: 0.9 }).score > evalSignals(base).score, key);
  }
  assert.ok(evalSignals({ ...base, taskStageTransition: true }).score > evalSignals(base).score);

  const contributions = [
    { id: 'role-core', type: 'role', priority: 'required', estimatedTokens: 3000, pinned: true, compactable: false },
    { id: 'project-core', type: 'project', estimatedTokens: 1500, pinned: true, compactable: false },
    { id: 'task-current', type: 'task', estimatedTokens: 2000, priority: 'required', pinned: true },
    { id: 'conversation-recent', type: 'conversation', estimatedTokens: 5000, compactable: false },
    { id: 'conversation-history', type: 'conversation', estimatedTokens: 25000, compactable: true },
    { id: 'tools-history', type: 'tool', estimatedTokens: 15000, compactable: true },
    { id: 'code-history', type: 'code', estimatedTokens: 2500, compactable: true }
  ];
  const health = analyzeContext({
    budget: { maxTokens: 100000 }, totalUsage: { value: 54000, exact: true, source: 'provider' }, contributions
  });
  const signals = buildAutoCompactSignals({ health });
  const plan = planContextCompaction({ health });

  // 10-12: role/current task/recent tail unchanged; planner is the authority.
  assert.ok(signals.staleContextRatio > 0.7);
  for (const id of ['role-core','project-core','task-current','conversation-recent']) {
    assert.ok(plan.keep.some(item => item.id === id), id);
  }
  assert.ok(plan.summarize.some(item => item.id === 'conversation-history'));
  assert.ok(plan.drop.some(item => item.id === 'tools-history'));
  const recentTail = buildHistoryContextContributions({ messages: Array.from({length: 16}, (_, i) =>
    ({ role: 'user', content: 'message ' + i })) });
  assert.ok(recentTail.some(item => item.id === 'conversation-recent' && item.compactable === false));

  // 13-14: active streaming, build and tool operations are unsafe.
  for (const runtime of [{streaming:true},{toolRunning:true},{buildRunning:true},{pendingSideEffect:true}]) {
    const state = buildAutoCompactSignals({health, runtime});
    assert.equal(state.workingStateStable, false);
    assert.equal(evalSignals({...high, ...state, contextPressure:0.99,
      staleContextRatio:0.99, toolOutputRatio:0.99,repetitionScore:0.99}).safeNow, false);
  }
  // 15: cooled-down automatic execution still needs enough new work.
  const now = Date.now();
  const before = new Date(now - 2 * 60000).toISOString();
  assert.equal(autoCompactCooldown({lastCompactedAt:before, lastCompactedTurn:10,
    currentTurn:25, currentTokens:80000, lastCompactedTokenCount:40000, now}).active, true);
  assert.equal(autoCompactCooldown({lastCompactedAt:new Date(now-15*60000).toISOString(),
    lastCompactedTurn:10,currentTurn:11,currentTokens:43000,lastCompactedTokenCount:40000,now}).active,true);
  assert.equal(autoCompactCooldown({lastCompactedAt:new Date(now-15*60000).toISOString(),
    lastCompactedTurn:10,currentTurn:14,currentTokens:43000,lastCompactedTokenCount:40000,now}).active,false);
  assert.equal(evalSignals({ contextPressure: 0.98, staleContextRatio: 0.95,
    toolOutputRatio: 0.9, repetitionScore: 0.95, taskStageTransition: true,
    workingStateStable: true }, {cooldown:{active:true}}).recommendation,'suggest');

  // 16: unknown context limit is represented as null, not fabricated.
  const unknown = analyzeContext({ totalUsage:{value:54000,exact:false,source:'heuristic'}, contributions });
  assert.equal(unknown.status,'unknown');
  const unknownSignals = buildAutoCompactSignals({health:unknown});
  assert.equal(unknownSignals.contextPressure,null);
  assert.ok(Number.isFinite(evalSignals(unknownSignals).score));

  // Repeated read and similar command signatures count as heuristic evidence.
  const reads = Array.from({ length: 8 }, () => ({name:'read_file',args:{path:'/a/file.ts'}}));
  assert.ok(calculateRepetitionScore(reads)>0.4);
  assert.equal(calculateRepetitionScore([{name:'read_file',args:{path:'/x'}}]),0);
  assert.equal(summarizeRepeatedTools(reads).repeated,6);
  assert.equal(calculateRepetitionScore(Array.from({length:8},()=>({name:'read_file'}))),0);
  assert.equal(buildAutoCompactSignals({health,recentTools:[{name:'compile',state:'awaiting_external_result'}]}).workingStateStable,false);
  assert.equal(inferTaskStage({},[{name:'read_file',args:{path:'/x'},state:'completed'},
    {name:'apply_patch',state:'completed'}]), 'implementation');
  assert.equal(buildAutoCompactSignals({health,history:{active_messages:[]},
    previousStage:'research',recentTools:[{name:'apply_patch',state:'completed'}]}).taskStageTransition,true);

  // 17: same provider Safe Compact reanalyzes after actual compact.
  const server = source('server.js');
  assert.ok(server.includes('const afterBundle = await getConversationContextHealth(providerId, conversationId)'));
  assert.ok(server.includes('const plan = planContextCompaction({ health: beforeBundle.contextHealth })'));
  assert.ok(server.includes("mode: 'continue'"));
  // No competing compaction runtime and no destructive Role memory operations.
  const safeSource = server.slice(server.indexOf('async function performSafeContextCompact'),
    server.indexOf('async function handleAutoCompactSettings'));
  assert.ok(safeSource.includes('provider.compactConversation'));
  assert.ok(safeSource.includes('markContextMemoryReretrieve'));
  assert.equal(safeSource.includes('defaultMemoryProvider.forget('),false);
  assert.equal(safeSource.includes('deleteConversation('),false);

  // 18-19: local telemetry captures before/after and opt-in starts disabled.
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-compact-'));
  process.env.CREW_AUTO_COMPACT_STATE_FILE = path.join(temp,'state.json');
  process.env.CREW_AUTO_COMPACT_TELEMETRY_FILE = path.join(temp,'telemetry.jsonl');
  const store = require('../lib/context/auto-compact-store');
  try {
    assert.deepEqual(await store.getAutoCompactSettings(),{enabled:false});
    await store.setAutoCompactSettings(true);
    assert.deepEqual(await store.getAutoCompactSettings(),{enabled:true});
    await store.recordAutoCompactTurn('codex','conversation123','research');
    await store.recordAutoCompactTurn('codex','conversation123','implementation');
    let state = await store.getAutoCompactState('codex','conversation123');
    assert.equal(state.turnCount,2);
    assert.ok(state.stageTransitionAt);
    await store.recordAutoCompactSuccess('codex','conversation123',{afterTokens:34000});
    state = await store.getAutoCompactState('codex','conversation123');
    assert.equal(state.lastCompactedTokenCount,34000);
    assert.equal(state.stageTransitionAt,null);
    await store.appendAutoCompactTelemetry({
      conversationId:'conversation123', agentId:'role1',beforeTokens:63000,
      afterTokens:34000, didCompact:true, mode:'automatic', prompt:'NEVER STORE THIS'
    });
    const telemetry = JSON.parse((await fs.readFile(process.env.CREW_AUTO_COMPACT_TELEMETRY_FILE,'utf8')).trim());
    assert.equal(telemetry.beforeTokens,63000);
    assert.equal(telemetry.afterTokens,34000);
    assert.equal(telemetry.prompt,undefined);
  } finally {
    await fs.rm(temp,{recursive:true,force:true});
  }

  // 20: existing manual UX and routes still work; compact flag is separate.
  const html=source('public/index.html'),chat=source('public/js/chat.js');
  assert.ok(server.includes("pathname === '/api/context/compact'"));
  assert.ok(server.includes("body.confirmed !== true"));
  assert.ok(server.includes("pathname === '/api/context/auto-compact-settings'"));
  assert.ok(server.includes("mode: 'manual'"));
  assert.ok(server.includes("mode: 'automatic'"));
  assert.ok(chat.includes('window.executeSafeContextCompaction = executeSafeContextCompaction'));
  assert.ok(html.includes('id="auto-compact-enabled"'));
  assert.ok(html.includes('id="context-compact-preview-modal"'));
  console.log('auto-compact tests: ok');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
