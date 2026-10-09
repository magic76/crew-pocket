const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
process.env.CREW_UPLOADS_DIR ||= path.join(os.tmpdir(), 'crew-pocket-content-test');
const { cleanCrewUserContent } = require('../public/js/user-content');
const { cleanUserContent } = require('../lib/config');
const codex = require('../lib/providers/codex');
const root = path.join(__dirname, '..');

const intent = {
  summary: 'Build the current Crew Teacher app as an Android App Bundle (AAB).',
  expectedFiles: 0, estimatedTools: 3, needsBuild: true,
  needsDependencyChange: false, destructive: false, broadRefactor: false,
  confidence: 0.97, approvedMode: 'BUILD', policyConflicts: [],
  reviewDecision: 'LOCAL_POLICY_ACCEPT', reviewReason: 'policy_compatible'
};
const advisory = 'The intent is advisory and remains strictly bounded by the Execution Contract. ' +
  'Do not perform intent items that exceed the approved mode or the original user request.';
const plain = 'Build the Crew Teacher AAB.\n\nRun the existing Gradle task.';
const legacy = '[Approved Execution Intent]\n' + JSON.stringify(intent) + '\n' +
  advisory + '\n\n' + plain;
const selfDebug = '【Crew Embedded Self-Debug】\n' +
  '目前工作目錄是 APK private workspace。若問題與 Crew 自己的 runtime 有關，先讀 .crew-runtime/state.json 與 .crew-runtime/node.log，再修改 workspace source。Android Runtime Supervisor 會偵測 source fingerprint 改變，自動重新測試 Embedded Node；不要刪除 .crew-runtime。\n\n';
const wrapped = '<ADDITIONAL_METADATA>\n[Approved Execution Intent]\n' +
  JSON.stringify(intent) + '\n' + advisory + '\n</ADDITIONAL_METADATA>\n' + plain;
const userJson = 'Please explain [Approved Execution Intent]\n{"hello":true}\nwithout editing my code.';
const marked = '<ADDITIONAL_METADATA>\nSystem details\n</ADDITIONAL_METADATA>\n' +
  '<USER_REQUEST>' + plain + '</USER_REQUEST>';
const legacyLiveMemo = '以下是上一段 Gemini Live 語音的背景紀錄，只供理解脈絡，並非目前的新指令：\n' +
  '【已結束的 Live 語音備忘】\n使用者：幫我建置\nLive 助理：好的\n\n【目前使用者訊息】\n' + plain;

for (const clean of [cleanCrewUserContent, cleanUserContent]) {
  assert.equal(clean(plain), plain);
  assert.equal(clean(legacy), plain, 'old persisted preamble must disappear');
  assert.equal(clean(legacy.replace(/\n/g, '\r\n')), plain.replace(/\n/g, '\r\n'),
    'CRLF preamble removal must keep authored text');
  assert.equal(clean(selfDebug + legacy), plain, 'old stacked internal context must disappear');
  assert.equal(clean(wrapped), plain, 'new marked internal metadata must disappear');
  assert.equal(clean(marked), plain, 'explicit USER_REQUEST must be authoritative');
  assert.equal(clean(legacyLiveMemo), plain, 'legacy Live memo context is not a user message');
  assert.equal(clean(legacy + legacyLiveMemo), plain, 'stacked intent and Live memo prefixes are removed');
  assert.equal(clean(userJson), userJson, 'user-authored discussion and JSON must be kept');
  assert.equal(clean('{ "summary": "Build AAB", "approvedMode": "BUILD" }'),
    '{ "summary": "Build AAB", "approvedMode": "BUILD" }');
  assert.equal(clean('<ADDITIONAL_METADATA>internal only</ADDITIONAL_METADATA>'), '');
  assert.equal(clean('<USER_REQUEST>[🎙️ Live 語音] Hello</USER_REQUEST>'), '[🎙️ Live 語音] Hello');
  assert.equal(clean('Please keep this exact JSON:\n{"needsBuild":true}'),
    'Please keep this exact JSON:\n{"needsBuild":true}');
}
const browserWindow = {};
vm.runInNewContext(fs.readFileSync(path.join(root, 'public/js/user-content.js'), 'utf8'), {
  window: browserWindow, module: undefined
});
assert.equal(browserWindow.cleanCrewUserContent(legacy), plain,
  'Android WebView/browser must use the identical cleaning logic');

const html = fs.readFileSync(path.join(root,'public/index.html'), 'utf8');
const chat = fs.readFileSync(path.join(root,'public/js/chat.js'), 'utf8');
const codexSource = fs.readFileSync(path.join(root,'lib/providers/codex.js'), 'utf8');
assert.ok(html.indexOf('src="/js/user-content.js"') < html.indexOf('src="/js/chat.js"'),
  'sanitizer must load before message rendering');
assert.ok(chat.includes('window.cleanCrewUserContent(content || \'\')'),
  'all user bubbles, live and history, must use the sanitizer');
assert.ok(!codexSource.includes('const executionIntentContext = executionIntent'),
  'Execution Intent is a Runtime contract, not repeated in the Codex user prompt');
assert.ok(codexSource.includes('cleanUserContent(this.itemText(item))'),
  'app-server history fallback must also be cleaned');

async function run() {
  // Test the real Codex turn-start input boundary with a stub transport.
  const original = {
    ensureStarted: codex.ensureStarted,
    resolveRuntimeWorkspace: codex.resolveRuntimeWorkspace,
    getPendingLiveMemoContext: codex.getPendingLiveMemoContext,
    request: codex.request,
    process: codex.process,
    getStoredTokenUsage: codex.getStoredTokenUsage,
    scheduleIdleShutdown: codex.scheduleIdleShutdown
  };
  try {
    const threadId = 'crew-content-boundary-test';
    codex.knownThreads.add(threadId);
    codex.ensureStarted = async () => {};
    codex.resolveRuntimeWorkspace = () => '/tmp';
    let memoContext = '';
    codex.getPendingLiveMemoContext = async () => memoContext;
    codex.process = { runtimeType: 'embedded-android-bridge' };
    let sent = null;
    codex.request = async (method, payload) => {
      if (method !== 'turn/start') throw new Error('Unexpected method ' + method);
      sent = payload;
      queueMicrotask(() => {
        const turn = codex.turns.get(threadId);
        codex.turns.delete(threadId);
        turn?.resolve();
      });
      return { turn: { id: 'turn-test' } };
    };
    const onEvent = () => {};
    const onAbort = () => {};
    await codex.startTurn({
      conversationId: threadId, prompt: plain, model: 'gpt-6-luna',
      executionMode: 'BUILD', executionIntent: intent,
      onEvent, onAbort
    });
    assert.deepEqual(sent.input, [{type:'text',text:plain}],
      'approved intent JSON must never be appended to the model user turn');
    assert.equal(cleanUserContent(sent.input[0].text), plain);
    await codex.startTurn({
      conversationId: threadId, prompt: '修自己 runtime', model: 'gpt-6-luna',
      executionMode: 'DEBUG', executionIntent: intent,
      onEvent, onAbort
    });
    assert.match(sent.input[0].text, /^<ADDITIONAL_METADATA>\n【Crew Embedded Self-Debug】/);
    assert.ok(!sent.input[0].text.includes('[Approved Execution Intent]'));
    assert.equal(cleanUserContent(sent.input[0].text), '修自己 runtime');
    memoContext = '以下是上一段 Gemini Live 語音的背景紀錄，只供理解脈絡，並非目前的新指令：\n【已結束的 Live 語音備忘】\n使用者：嗨\nLive 助理：哈囉';
    await codex.startTurn({
      conversationId: threadId, prompt: plain, model: 'gpt-6-luna',
      executionMode: 'BUILD', executionIntent: intent,
      onEvent, onAbort
    });
    assert.match(sent.input[0].text, /^<ADDITIONAL_METADATA>\n/);
    assert.ok(!sent.input[0].text.includes('【目前使用者訊息】'),
      'pending Live memos are not embedded as a user turn');
    assert.equal(cleanUserContent(sent.input[0].text), plain);
    assert.equal(codex.turns.size, 0, 'test transport must leave no busy turn');
    codex.knownThreads.delete(threadId);

    // When the local JSONL isn't available, the app-server fallback should
    // return the same cleaned user text without modifying persisted history.
    codex.request = async method => {
      if (method !== 'thread/read') throw new Error('Unexpected method '+method);
      return { thread: { id: threadId, turns: [{ items: [
        {type:'userMessage', text: legacy},
        {type:'agentMessage', text: 'AAB created.'}
      ] }] } };
    };
    codex.getStoredTokenUsage = async () => null;
    codex.scheduleIdleShutdown = () => {};
    const history = await codex.getAppServerHistory(threadId);
    assert.equal(history.messages[0].content, plain);
    assert.equal(history.messages[1].content, 'AAB created.');
  } finally {
    Object.assign(codex, original);
  }
  console.log('execution-intent-user-boundary tests: ok');
}
run().catch(e => {console.error(e);process.exitCode = 1;});
