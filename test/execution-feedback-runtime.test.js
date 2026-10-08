const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-feedback-runtime-'));
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const repo = path.resolve(__dirname, '..');
  const child = spawn(process.execPath, ['-r', path.join(__dirname, 'fixtures/execution-feedback-provider.js'), 'server.js'], {
    cwd: repo, env: { ...process.env, HOME: temp, CODEX_HOME: path.join(temp, '.codex'), PORT: String(port), CREW_UPLOADS_DIR: path.join(temp, 'uploads'), CREW_BRAIN_DIR: path.join(temp, 'brain') }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk; });
  child.stderr.on('data', chunk => { logs += chunk; });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let attempt = 0; ; attempt++) {
      try { if ((await fetch(base + '/api/runtime/status')).ok) break; } catch (_) {}
      if (attempt === 60) throw new Error('Runtime startup failed: ' + logs.slice(-2000));
      await delay(100);
    }
    const js = await fetch(base + '/js/chat.js');
    assert.match(js.headers.get('cache-control'), /no-store/);
    const scenarios = ['completed', 'toolfailed', 'providererror', 'interrupted'];
    for (const scenario of scenarios) {
      const id = `feedback-${scenario}`;
      const response = await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'codex', prompt: `scenario:${scenario}`, conversation_id: id, workspace: temp, execution_mode: 'INSPECT', model: 'gpt-6-sol', role_id: 'role-general' }) });
      const stream = await response.text();
      assert.equal(response.status, 200, stream);
      const events = stream.split('\n\n').flatMap(block => {
        const event = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        return event && data ? [{ event, data: JSON.parse(data) }] : [];
      });
      const done = events.find(event => event.event === 'done')?.data;
      assert.ok(done?.turn_result, stream);
      assert.equal(done.turn_result.status, scenario === 'providererror' ? 'failed' : scenario === 'interrupted' ? 'interrupted' : 'completed');
      assert.equal(events.filter(event => event.event === 'tool').length, 4);
      assert.equal(done.turn_result.tool_count, 2);
      assert.equal(done.turn_result.commit, undefined);
      assert.equal(done.turn_result.checks, undefined);
      const history = await (await fetch(base + `/api/history?provider=codex&id=${id}`)).json();
      const last = history.messages?.find(message => message.role === 'assistant');
      assert.deepEqual(last?.turn_result, done.turn_result, JSON.stringify(history));
      if (scenario === 'toolfailed') assert.equal(last.tools[1].state, 'failed');
      console.log(`Runtime SSE/history: ${scenario} passed`);
    }
    // A client disconnect must not save a successful terminal result.
    const controller = new AbortController();
    const response = await fetch(base + '/api/chat', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'codex', prompt: 'scenario:slow', conversation_id: 'feedback-disconnect', workspace: temp, execution_mode: 'INSPECT', model: 'gpt-6-sol', role_id: 'role-general' }) });
    const reader = response.body.getReader();
    await reader.read();
    await delay(50);
    controller.abort();
    await delay(100);
    const history = await (await fetch(base + '/api/history?provider=codex&id=feedback-disconnect')).json();
    assert.equal(history.messages.find(message => message.role === 'assistant').turn_result.status, 'interrupted');
    console.log('Runtime SSE client disconnect/history: passed');
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
    await fs.rm(temp, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
