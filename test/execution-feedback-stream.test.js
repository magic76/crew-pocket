// Requires jsdom (installed in a temporary prefix; no production dependency).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const source = fs.readFileSync(path.join(__dirname, '../public/js/chat.js'), 'utf8');
async function runScenario(scenario) {
  const dom = new JSDOM('<body><main><div id="messages"></div></main><textarea></textarea></body>', { url: 'http://127.0.0.1:8000', runScripts: 'outside-only' });
  const w = dom.window;
  Object.assign(w, { TextDecoder, AbortController, messagesContainer: w.document.querySelector('#messages'), promptInput: w.document.querySelector('textarea'), currentProvider: 'codex', currentConversationId: 'thread-a', currentModel: 'gpt-6-sol', currentWorkspace: '/test', uploadedImagePath: null, cameraInput: null, imagePreviewContainer: null, sendBtn: null, sendIcon: null, stopIcon: null, currentAbortController: null, isOnline: true, isStreaming: false, userScrolledUp: false, activeConversationStorageKey: () => 'test-conv', loadConversations: () => {}, updateContextPill: () => {}, getCurrentRoleId: () => 'role-a', scrollToBottom: () => {}, escapeHtml: value => String(value).replace(/</g, '&lt;').replace(/>/g, '&gt;'), formatMessageTimestamp: () => '12:00', prepareDeferredImages: () => {}, buildEmptyTurnFallbackHtml: () => 'EMPTY', triggerDoneNotification: () => {} });
  let stream;
  w.fetch = async (url, options) => {
    if (url !== '/api/chat') return { ok: true, json: async () => ({ messages: [] }) };
    if (scenario === 'http') return { ok: false, status: 400, json: async () => ({ error: 'invalid fixture request' }) };
    stream = new ReadableStream({ start(controller) {
      const event = (name, data) => controller.enqueue(new TextEncoder().encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`));
      const tool = { tool_id: 'a', tool_name: 'commandExecution', tool_info: { parameters: { command: 'node --check fixture.js' } } };
      event('tool', { ...tool, state: 'running' });
      event('chunk', { delta: '# 摘要\n已完成回饋修正。' });
      if (scenario === 'progress') {
        event('tool', { ...tool, state: 'completed' });
        for (const [id, code] of [['b', 1], ['c', 0]]) {
          event('tool', { tool_id: id, tool_name: 'commandExecution', state: 'completed', tool_info: { parameters: { command: `check-${id}` }, exitCode: code } });
        }
        const pending = { tool_id: 'd', tool_name: 'commandExecution', state: 'running', tool_info: { parameters: { command: 'sleep 10', description: '等待檢查訊號' } } };
        event('tool', pending);
        event('tool', pending); // Repeated polling must not create another row.
      }
      setTimeout(() => {
        if (scenario === 'abort') return;
        if (scenario === 'network') { controller.error(new TypeError('connection lost')); return; }
        if (scenario === 'progress') event('tool', { tool_id: 'd', tool_name: 'commandExecution', state: 'completed' });
        event('tool', { ...tool, state: 'completed' });
        if (scenario !== 'eof') event('done', { status: scenario === 'interrupted' ? 'interrupted' : 'completed', response: '# 摘要\n已完成回饋修正。', turn_result: { kind: 'execution', status: scenario === 'interrupted' ? 'interrupted' : 'completed', duration_ms: 1234 } });
        controller.close();
      }, 30);
      options.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
    } });
    return { ok: true, body: stream };
  };
  w.console.warn = () => {}; // Network/HTTP failures are intentional fixtures.
  w.eval(source);
  w.eval('formatMessageContent = text => `<p>${escapeHtml(text)}</p>`; appendMessage = () => {}; loadConversations = () => {}; prepareDeferredImages = () => {};');
  try {
    const task = w.sendMessage('請檢查回饋');
    await delay(10);
    if (scenario !== 'http') {
      assert.ok(w.messagesContainer.querySelector('.live-progress-peek'));
      assert.equal(w.messagesContainer.querySelector('.live-stage').textContent, '工具執行', 'a chunk cannot hide a running operation');
      if (scenario === 'progress') {
        const peek = w.messagesContainer.querySelector('.live-progress-peek');
        assert.equal(peek.querySelectorAll('li').length, 2);
        assert.match(peek.textContent, /操作未完成 · 執行指令 · check-b/);
        assert.match(peek.textContent, /操作完成 · 執行指令 · check-c/);
        assert.match(peek.textContent, /AI 說明：等待檢查訊號/);
      }
      const status = w.messagesContainer.querySelector('.live-status');
      assert.equal(status.querySelector('.live-progress-list').children.length, 0, 'closed progress does not rebuild hidden rows');
      status.open = true;
      await delay(1);
      assert.ok(status.querySelector('.live-progress-list').children.length > 0);
      status.open = false;
    }
    if (scenario === 'background') {
      w.getCurrentRoleId = () => 'role-b';
      w.currentConversationId = 'thread-b';
      const bubble = w.messagesContainer.lastElementChild;
      bubble.remove();
      await task;
      assert.equal(w.currentConversationId, 'thread-b');
      assert.equal(bubble.querySelector('.execution-result-title').textContent, '完成執行');
      w.messagesContainer.appendChild(bubble);
    } else {
      if (scenario === 'abort') await w.stopGeneration();
      await task;
    }
    const text = w.messagesContainer.textContent;
    if (['eof', 'interrupted', 'abort', 'network'].includes(scenario)) {
      assert.match(text, /執行已中斷/, text);
      assert.doesNotMatch(text, /已完成 ·|is-complete/);
    } else if (scenario === 'http') {
      assert.match(text, /執行未完成/);
      assert.match(text, /invalid fixture request/);
    } else {
      const card = w.messagesContainer.querySelector('.execution-result-card');
      assert.ok(card, text);
      assert.equal(card.open, true, "latest completed result stays expanded");
      assert.equal(card.querySelector('.execution-result-peek').textContent, '已完成回饋修正。');
      card.open = true;
      assert.match(card.querySelector('.execution-result-body').textContent, /已完成回饋修正/);
      assert.equal(card.querySelector('.execution-result-body details').open, false);
    }
    assert.equal(w.messagesContainer.querySelector('.live-stage'), null);
    assert.equal(w.messagesContainer.querySelector('.live-progress-peek'), null, 'live hints are removed on every terminal path');
    assert.equal(w.getActiveRoleStream('role-a'), null);
    console.log(`DOM stream: ${scenario} passed`);
  } finally { dom.window.close(); }
}
(async () => { for (const scenario of ['progress', 'completed', 'eof', 'interrupted', 'abort', 'network', 'http', 'background']) await runScenario(scenario); })().catch(error => { console.error(error); process.exitCode = 1; });
