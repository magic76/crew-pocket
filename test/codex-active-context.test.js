'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readCodexActiveHistory } = require('../lib/context/codex-active-history');
const { analyzeConversationContext } = require('../lib/context/health');
const { planContextCompaction } = require('../lib/context/compaction');
const { buildAgentContext, filterConversationMemories } = require('../lib/context-builder');
const response = payload => ({ type: 'response_item', payload });
const message = (role, text) => ({ type: 'message', role, content: [{ type: 'input_text', text }] });
const compact = history => ({ type: 'compacted', timestamp: '2026-10-12T08:51:00Z', payload: { replacement_history: history } });
const lines = entries => entries.map(entry => JSON.stringify(entry)).join('\n');

test('latest replacement excludes archived tools, pairs both tool schemas, and ignores event mirrors', () => {
  const data = readCodexActiveHistory(lines([
    response(message('user', 'archived request')),
    response({ type: 'custom_tool_call', call_id: 'old', name: 'exec', input: 'old command' }),
    compact([message('assistant', 'earlier summary')]),
    response({ type: 'custom_tool_call_output', call_id: 'old', output: 'also replaced' }),
    compact([message('user', 'retained request'), message('assistant', 'latest summary')]),
    { type: 'event_msg', payload: { type: 'agent_message', message: 'duplicate display event' } },
    response(message('user', 'new request')),
    response({ type: 'custom_tool_call', call_id: 'c', name: 'exec', input: 'ls' }),
    response({ type: 'function_call', call_id: 'f', name: 'lookup', arguments: '{"q":"hi"}' }),
    response({ type: 'function_call_output', call_id: 'f', output: 'found' }),
    response({ type: 'custom_tool_call_output', call_id: 'c', output: [{ type: 'text', text: 'file.js' }] }),
    response(message('assistant', 'done'))
  ]));
  const serialized = JSON.stringify(data.active_messages);
  assert.doesNotMatch(serialized, /archived|also replaced|earlier summary|duplicate display/);
  assert.match(serialized, /latest summary/);
  const tools = data.active_messages.flatMap(m => m.tools || []);
  assert.equal(tools.length, 2);
  assert.deepEqual(tools.map(t => t.output), ['file.js', 'found']);
  assert.equal(data.active_messages.length, 4, 'tool records share the assistant message, not the recent-message budget');
  assert.equal(data.context_attribution.compacted, true);
  assert.equal(data.context_attribution.complete, true);
});

test('missing replacement, opaque state, and truncated lines never fall back to full history', () => {
  const data = readCodexActiveHistory(lines([
    response(message('user', 'ARCHIVED')),
    { type: 'compacted', payload: { message: 'readable summary' } },
    response({ type: 'compaction', encrypted_content: 'DO-NOT-COUNT-CIPHERTEXT' }),
    response(message('user', 'current')),
    response({ type: 'function_call_output', call_id: 'missing', output: 'orphan output' })
  ]) + '\n{"type":');
  assert.equal(data.context_attribution.complete, false);
  assert.doesNotMatch(JSON.stringify(data.active_messages), /ARCHIVED|CIPHERTEXT/);
  assert.match(JSON.stringify(data.active_messages), /readable summary|orphan output/);
  assert.equal(data.context_attribution.opaqueItems, 1);
});

test('raw injected metadata is counted once; snapshot ledger and display archive are excluded', () => {
  const active = readCodexActiveHistory(lines([
    response(message('developer', 'system guidance')),
    response(message('user', '<ADDITIONAL_METADATA>remember this</ADDITIONAL_METADATA>\n<ADDITIONAL_METADATA>\n[Updated Long-Term Memory]\ncheckpoint</ADDITIONAL_METADATA>hello')),
    response({ type: 'function_call', name: 'tool', call_id: 't', arguments: '{}' }),
    response({ type: 'function_call_output', call_id: 't', output: 'x'.repeat(400) })
  ]));
  const health = analyzeConversationContext({ ...active,
    messages: [{ role: 'assistant', content: 'archive'.repeat(10000) }],
    context_stats: { active_tokens: 2000, active_tokens_exact: true, context_window: 8000 }
  }, { additionalContributions: [{ id: 'ledger', type: 'memory', estimatedTokens: 9000 }] });
  assert.equal(health.totalUsage.value, 2000);
  assert.equal(health.breakdownEstimate.scope, 'active');
  assert.equal(health.contributions.some(c => c.id === 'ledger'), false);
  assert.ok(health.breakdown.system.estimatedTokens > 0);
  assert.ok(health.breakdown.other.estimatedTokens > 0);
  assert.ok(health.breakdown.memory.estimatedTokens > 0, 'delivered memory updates are attributed from actual active messages');
  assert.ok(health.breakdown.tool.estimatedTokens >= 100, 'tool output contributes');
  assert.ok(health.breakdown.conversation.estimatedTokens < 10);
  const unknown = analyzeConversationContext({ active_messages: [], messages: [{ content: 'old'.repeat(999) }],
    context_attribution: { scope: 'unknown', complete: false },
    context_stats: { active_tokens: 2000, context_window: 8000 }
  });
  assert.equal(unknown.contributionEstimateTokens, 0);
  assert.equal(unknown.unattributedTokens, 2000);
});

test('native compaction has candidates but does not promise savings or retention', () => {
  const active = readCodexActiveHistory(lines([
    response(message('user', 'old user')),
    response({ type: 'custom_tool_call', name: 'exec', call_id: 'c', input: 'command' }),
    response({ type: 'custom_tool_call_output', call_id: 'c', output: 'x'.repeat(10000) }),
    ...Array.from({ length: 12 }, (_, i) => response(message(i % 2 ? 'assistant' : 'user', 'next ' + i)))
  ]));
  const health = analyzeConversationContext({ ...active,
    context_stats: { active_tokens: 12000, context_window: 20000, active_tokens_exact: true }
  });
  const plan = planContextCompaction({ health });
  assert.equal(plan.execution, 'provider_native');
  assert.equal(plan.hasActionableWork, true);
  assert.equal(plan.estimatedSavingsTokens, null);
  assert.equal(plan.estimatedAfterTokens, null);
  assert.equal(plan.retentionGuaranteed, false);
  assert.ok(plan.drop.every(item => item.estimatedSavingsTokens === null));
});

const checkpoint = id => ({ record: { id: 'working-role', kind: 'working', source: 'crew-dreaming-checkpoint', text: 'recent outcome',
  provenance: { sources: [{ type: 'conversation', id }] } } });
test('working checkpoints bootstrap new threads only; learned experience survives', async () => {
  const memories = [checkpoint('same'), checkpoint('other'), { record: { id: 'experience', kind: 'experience', text: 'learned rule' } }];
  assert.equal(filterConversationMemories(memories, null).length, 3);
  assert.deepEqual(filterConversationMemories(memories, 'same'), memories.slice(2));
  const context = await buildAgentContext({ roleId: 'role', conversationId: 'same',
    roleResolver: async () => ({ id: 'role', name: 'Role' }), projectResolver: async () => null,
    memoryProvider: { recall: async () => memories }, skillRegistry: { match: async () => [] }
  });
  assert.deepEqual(context.memories, memories.slice(2));
  assert.equal(context.contributions.filter(c => c.type === 'memory').length, 1);
});

test('provider keeps the full display history and rollout bytes while exposing separate active context', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-context-'));
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = dir;
  try {
    const provider = require('../lib/providers/codex');
    const sessionDir = path.join(dir, 'sessions');
    await fs.mkdir(sessionDir);
    const id = 'context-regression';
    const file = path.join(sessionDir, id + '.jsonl');
    const content = lines([
      { type: 'event_msg', payload: { type: 'user_message', message: 'archived request' } },
      { type: 'event_msg', payload: { type: 'agent_message', message: 'archived reply' } },
      response(message('user', 'archived request')),
      compact([message('assistant', 'summary')]),
      response(message('user', '<ADDITIONAL_METADATA>memory</ADDITIONAL_METADATA>new request')),
      { type: 'event_msg', payload: { type: 'user_message', message: '<ADDITIONAL_METADATA>memory</ADDITIONAL_METADATA>new request' } },
      { type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 1234 }, model_context_window: 8000 } } }
    ]);
    await fs.writeFile(file, content);
    const history = await provider.getLocalHistory(id);
    assert.ok(history, 'fixture is loaded without starting a Codex process');
    assert.equal(history.context_stats.is_compacted, true);
    assert.equal(history.context_stats.active_tokens, 1234);
    assert.match(JSON.stringify(history.messages), /archived request/);
    assert.doesNotMatch(JSON.stringify(history.messages), /ADDITIONAL_METADATA/);
    assert.doesNotMatch(JSON.stringify(history.active_messages), /archived request/);
    assert.match(JSON.stringify(history.active_messages), /ADDITIONAL_METADATA/);
    assert.equal(await fs.readFile(file, 'utf8'), content);
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('Context UI separates unknown remainder and avoids a native savings promise', async () => {
  const vm = require('node:vm');
  const source = await fs.readFile(path.join(__dirname, '../public/js/chat.js'), 'utf8');
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', insertAdjacentHTML(_, value) { this.innerHTML += value; } });
    return elements.get(id);
  };
  const sandbox = { document: { getElementById: element },
    formatContextTokens: value => String(value),
    contributionDisplayName: entry => entry.label, escapeHtml: value => value };
  vm.createContext(sandbox);
  for (const [start, end] of [['renderContextBreakdown', 'renderContextContributionLists'], ['renderCompactionPlan', 'openSafeContextCompactionPreview']]) {
    const at = source.indexOf('function ' + start + '(');
    let endAt = source.indexOf('function ' + end + '(', at);
    if (source.slice(endAt - 6, endAt) === 'async ') endAt -= 6;
    vm.runInContext(source.slice(at, endAt), sandbox);
  }
  sandbox.renderContextBreakdown({ totalUsage: { value: 1000 }, unattributedTokens: 950,
    breakdown: { system: { estimatedTokens: 50 } } });
  const html = element('context-breakdown').innerHTML;
  assert.match(html, /可讀取的系統指令/);
  assert.match(html, /未歸因差額/);
  assert.match(html, /950/);
  assert.doesNotMatch(html, /Other \/ system/);
  sandbox.renderCompactionPlan({ execution: 'provider_native', estimatedBeforeTokens: 1000,
    estimatedAfterTokens: null, estimatedSavingsTokens: null, keep: [], drop: [], summarize: [], reretrieve: [] });
  assert.equal(element('context-preview-after').textContent, '執行後確認');
  assert.equal(element('context-preview-savings').textContent, '無法預測');
});
