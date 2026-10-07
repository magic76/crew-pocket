const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

async function run() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-role-http-'));
  let child;
  let output = '';
  try {
    fs.mkdirSync(path.join(fixture, 'project-a'));
    fs.mkdirSync(path.join(fixture, '.crew-pocket'));
    const settingsPath = path.join(fixture, '.crew-pocket/conversation-settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
      'codex:legacy': { provider: 'codex', model: 'gpt-6-sol', effort: 'low', workspace: fixture, title: 'Preserved', customField: 'keep' }
    }));
    const listener = net.createServer();
    await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
    const port = listener.address().port;
    await new Promise(resolve => listener.close(resolve));
    child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env, HOME: fixture, CODEX_HOME: path.join(fixture, '.codex'),
        PORT: String(port), CREW_BIND_HOST: '127.0.0.1', CREW_API_TOKEN: 'isolated-test-token',
        CREW_UPLOADS_DIR: path.join(fixture, 'uploads'), CREW_PREVIOUS_UPLOADS_DIR: path.join(fixture, 'previous'),
        CREW_BRAIN_DIR: path.join(fixture, 'brain'), CREW_CONVERSATION_SETTINGS_PATH: settingsPath,
        CREW_CODEX_SESSION_WARMUP: '0', CREW_CODEX_BRIDGE: 'off', CREW_PROVIDER_DELIVERY: 'termux'
      }, stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const base = `http://127.0.0.1:${port}`;
    async function request(route, body) {
      const response = await fetch(base + route, {
        method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(4000)
      });
      return { status: response.status, headers: response.headers, data: response.status === 204 ? null : await response.json() };
    }
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { if ((await request('/healthz')).status === 204) { ready = true; break; } } catch (_) {}
      if (child.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'Isolated server must become ready');
    let result = await request('/api/roles');
    assert.equal(result.status, 200);
    assert.match(result.headers.get('cache-control'), /\bno-store\b/);
    const projectRole = result.data.roles.find(role => role.projectId);
    assert.ok(projectRole);
    result = await request('/api/conversation-settings', { provider: 'codex', conversation_id: 'project-thread', role_id: projectRole.id, model: 'gpt-6-sol', effort: 'low' });
    assert.equal(result.status, 200);
    assert.equal(result.data.conversation_settings.workspace, path.join(fixture, 'project-a'));
    result = await request('/api/conversation-settings', { provider: 'codex', conversation_id: 'project-thread', role_id: 'role-general' });
    assert.equal(result.status, 409);
    result = await request('/api/conversation-settings', { provider: 'codex', conversation_id: 'legacy', role_id: 'role-general' });
    assert.equal(result.status, 200);
    assert.equal(result.data.conversation_settings.customField, 'keep');
    assert.equal(result.data.conversation_settings.title, 'Preserved');
    assert.equal(result.data.conversation_settings.workspace, fixture);
    for (const record of [{ scope: 'role', roleId: projectRole.id, text: 'Project-specific memory' }, { scope: 'global', text: 'Shared memory' }]) {
      assert.equal((await request('/api/memories', record)).status, 201);
    }
    assert.equal((await request('/api/memories?scopes=role&roleId=role-general')).data.memories.length, 0);
    assert.equal((await request(`/api/memories?scopes=role&roleId=${projectRole.id}`)).data.memories.length, 1);
    assert.equal((await request('/api/memories?scopes=global&roleId=role-general')).data.memories.length, 1);
    assert.equal((await request('/api/runtime/update-readiness')).status, 200);
    const asset = await fetch(base + '/js/ui.js', { signal: AbortSignal.timeout(4000) });
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('cache-control'), /\bno-store\b/);
    console.log('role-memory-http tests: ok');
  } catch (error) {
    console.error(output.slice(-1500));
    throw error;
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
    }
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
