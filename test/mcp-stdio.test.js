const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const repoRoot = path.join(__dirname, '..');
const hasSdk = fs.existsSync(path.join(repoRoot, 'mcp', 'node_modules', '@modelcontextprotocol', 'server'));

test('MCP stdio handshake, tool discovery, and bound whoami', { skip: !hasSdk }, async t => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'crew-mcp-stdio-'));
  t.after(() => fsp.rm(home, { recursive: true, force: true }));
  const dataDir = path.join(home, '.crew-pocket');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(path.join(dataDir, 'roles.json'), JSON.stringify({
    version: 2, bootstrapped: true,
    roles: [{ id: 'role-general', name: 'General', description: 'Test role',
      systemContext: 'Only for MCP smoke test', projectId: null, skills: [] }]
  }), 'utf8');

  const child = spawn(process.execPath, ['mcp/server.mjs'], {
    cwd: repoRoot,
    env: { ...process.env, HOME: home, CREW_MCP_ROLE_ID: 'role-general' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  t.after(() => { if (!child.killed) child.kill('SIGTERM'); });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  let buffer = '';
  const pending = new Map();
  child.stdout.on('data', chunk => {
    buffer += chunk.toString('utf8');
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch (_) { continue; }
      const callback = pending.get(message.id);
      if (callback) {
        pending.delete(message.id);
        callback(message);
      }
    }
  });

  async function request(id, method, params) {
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('MCP timed out: ' + method + ' ' + stderr.slice(-500)));
      }, 12000);
      pending.set(id, message => {
        clearTimeout(timer);
        resolve(message);
      });
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return response;
  }

  const init = await request(1, 'initialize', {
    protocolVersion: '2026-07-28',
    capabilities: {},
    clientInfo: { name: 'crew-pocket-test', version: '1.0.0' }
  });
  assert.equal(init.error, undefined, JSON.stringify(init.error));
  assert.equal(init.result.serverInfo.name, 'crew-pocket');

  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const list = await request(2, 'tools/list', {});
  assert.equal(list.error, undefined, JSON.stringify(list.error));
  const names = list.result.tools.map(tool => tool.name);
  assert.deepEqual([...names].sort(), [
    'crew_whoami', 'crew_list_roles', 'crew_get_inbox', 'crew_send_message',
    'crew_recall', 'crew_propose_memory', 'crew_handoff', 'crew_get_task_status', 'crew_report_done'
  ].sort());

  const whoami = await request(3, 'tools/call', { name: 'crew_whoami', arguments: {} });
  assert.equal(whoami.error, undefined, JSON.stringify(whoami.error));
  assert.equal(whoami.result.isError, undefined);
  assert.equal(JSON.parse(whoami.result.content[0].text).role.id, 'role-general');
});
