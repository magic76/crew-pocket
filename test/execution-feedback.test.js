const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

async function run() {
  const source = await fs.readFile(path.join(__dirname, '../public/js/chat.js'), 'utf8');
  const context = vm.createContext({
    escapeHtml: text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    formatMessageContent: text => text,
    buildEmptyTurnFallbackHtml: () => 'EMPTY'
  });
  vm.runInContext(source.slice(0, source.indexOf('let activeExecutionStickyController')), context);
  const preview = context.executionResultPreviewText;
  assert.equal(preview('# 摘要\n```js\nconst secret = 1;\n```\n已修正 **串流**，保留 `file_name.js`。\n- [測試通過](https://example.com)'), '已修正 串流，保留 file_name.js。 · 測試通過');
  assert.equal(preview('~~~html\n<div>code</div>\n~~~\n## 驗證\n    node --check\n完成修正。'), '完成修正。');
  assert.equal(preview('```js\nconst only = 1;\n```'), '');
  assert.equal(context.formatExecutionDuration(null), '');
  assert.equal(context.buildExecutionResultHeadline({ status: 'completed', execution_mode: 'SURGICAL_EDIT' }, []), '回覆完成 · 修改任務');
  const metadata = context.buildExecutionResultCardHtml('已修正。', [], '', { status: 'completed', changed_files: ['public/js/chat.js'], commit: { short_hash: 'abc12345' }, duration_ms: 84211, checks: [{ label: 'node --check', status: 'passed' }] });
  assert.match(metadata, /完成修改 · chat.js/);
  assert.match(metadata, /abc12345 · 1m 24s/);
  assert.match(metadata, /驗證結果/);
  assert.equal(context.formatExecutionDuration(84211), '1m 24s');
  assert.equal(context.toolProgressState({ state: 'completed', tool_info: { exitCode: 1 } }), 'failed');
  assert.equal(context.toolProgressState({ state: 'running' }), 'running');
  const unknown = context.buildExecutionResultCardHtml('歷史答案', [{ name: 'exec_command' }]);
  assert.match(unknown, /終態未確認/);
  assert.doesNotMatch(unknown, /is-complete|✓/);
  const interrupted = context.buildExecutionResultCardHtml('', [], '', { kind: 'execution', status: 'interrupted', duration_ms: null });
  assert.match(interrupted, /執行已中斷/);
  assert.doesNotMatch(interrupted, /EMPTY|0s|已完成/);
  const tools = [{ tool_id: 'a', name: 'exec_command', state: 'completed', tool_info: { exitCode: 1 } }];
  const failedTool = context.buildExecutionResultCardHtml('完成回覆', tools, '', { status: 'completed' });
  assert.match(failedTool, /有操作失敗/);
  assert.match(failedTool, /<details class="execution-result-section">/);
  const grouped = context.coalesceToolEvents([{ tool_id: 'a', state: 'running' }, { tool_id: 'a', state: 'completed' }]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].state, 'completed');

  const activity = new Map([
    ['tool:a', { startedAt: 0, finishedAt: 1000 }],
    ['tool:b', { startedAt: 0, finishedAt: 2000 }],
    ['tool:c', { startedAt: 0, finishedAt: 3000 }],
    ['tool:d', { startedAt: 4000 }]
  ]);
  const progressTools = [
    { tool_id: 'a', name: 'exec_command', state: 'completed', args: { cmd: 'old-command' } },
    { tool_id: 'b', name: 'exec_command', state: 'completed', tool_info: { parameters: { cmd: 'bad-command' }, exitCode: 1 } },
    { tool_id: 'c', name: 'exec_command', state: 'completed', args: { cmd: 'latest-command' } },
    { tool_id: 'd', name: 'exec_command', state: 'running', args: { cmd: 'slow-command' } }
  ];
  const peek = context.buildLiveProgressPeekHtml(progressTools, activity, 14000, 4000, '<script>note</script>');
  assert.equal((peek.match(/<li class=/g) || []).length, 2);
  assert.doesNotMatch(peek, /old-command|<script>/);
  assert.match(peek, /操作未完成 · 執行指令 · bad-command/);
  assert.match(peek, /操作完成 · 執行指令 · latest-command/);
  assert.match(peek, /目前操作已執行 10 秒 · 等待工具更新/);
  assert.match(peek, /&lt;script&gt;/);
  assert.match(context.buildLiveProgressPeekHtml([], new Map(), 10000, 0), /等待下一個串流事件 · 10 秒/);
  assert.equal(context.buildLiveProgressPeekHtml([], new Map(), 1000, 0).trim(), '');

  assert.equal(context.getLiveExecutionStatus([], 'preparing', 0, 0).stage, '準備中');
  assert.equal(context.getLiveExecutionStatus([], 'analysis', 1000, 0).stage, '分析中');
  assert.equal(context.getLiveExecutionStatus([], 'writing', 1000, 0).stage, '回覆輸出');
  assert.equal(context.getLiveExecutionStatus(progressTools, 'writing', 5000, 4000).stage, '工具執行', 'streaming commentary must not hide running tools');
  assert.equal(context.getLiveExecutionStatus(progressTools, 'writing', 14000, 4000).stage, '等待更新');
  assert.equal(context.getLiveExecutionStatus([progressTools[1]], 'tool', 1000, 0).stage, '工具回報');
  assert.match(context.getLiveExecutionStatus([progressTools[1]], 'tool', 1000, 0).text, /操作未完成/);
  const body = context.buildExecutionResultBodyHtml('成果在這裡', progressTools, '', { status: 'completed' });
  assert.ok(body.indexOf('成果在這裡') < body.indexOf('執行紀錄'), 'answer precedes tool history');
  assert.doesNotMatch(body, /工作說明|execution-result-hero-status/, 'do not repeat status or label before the answer');

  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-feedback-test-'));
  const previousHome = process.env.HOME;
  process.env.HOME = temp;
  const { saveExecutionFeedback, enrichExecutionHistory } = require('../lib/execution-feedback');
  try {
    const startedAt = Date.now();
    const timestamp = new Date(startedAt + 10).toISOString();
    const turnResult = { kind: 'execution', status: 'interrupted', duration_ms: 1234 };
    await saveExecutionFeedback('codex', 'thread-a', { response: 'partial', startedAt, endedAt: startedAt + 20, turnResult, tools });
    const history = { messages: [{ role: 'assistant', content: 'partial', timestamp }] };
    assert.deepEqual((await enrichExecutionHistory('codex', 'thread-a', history)).messages[0].turn_result, turnResult);
    assert.equal((await enrichExecutionHistory('antigravity', 'thread-a', history)).messages[0].turn_result, undefined);
    assert.equal((await enrichExecutionHistory('codex', 'thread-b', history)).messages[0].turn_result, undefined);
    const old = { messages: [{ ...history.messages[0], timestamp: new Date(startedAt - 1).toISOString() }] };
    assert.equal((await enrichExecutionHistory('codex', 'thread-a', old)).messages[0].turn_result, undefined);
    assert.equal(history.messages[0].turn_result, undefined, 'provider-owned history stays untouched');
    await assert.rejects(saveExecutionFeedback('codex', '../escape', { response: 'x', turnResult }), /Invalid/);
  } finally {
    process.env.HOME = previousHome;
    await fs.rm(temp, { recursive: true, force: true });
  }
  const { buildTurnResult } = require('../lib/turn-result');
  assert.equal(buildTurnResult({ executionPolicy: { mode: 'DEBUG' }, status: 'interrupted' }).status, 'interrupted');
  assert.equal(buildTurnResult({ executionPolicy: { mode: 'DEBUG' }, status: 'pending' }).status, 'unknown');
  console.log('execution-feedback tests passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
