const test = require('node:test');
const assert = require('node:assert/strict');
const provider = require('../lib/providers/codex');
const { listCodexRoleTools } = require('../lib/mcp/codex-adapter');

function stubTransport() {
  const sent = [];
  provider.process = { killed: false, stdin: { write(line) { sent.push(JSON.parse(line)); } } };
  provider.knownThreads.clear();
  provider.roleToolsByThread.clear();
  provider.roleToolEnabledThreads.clear();
  provider.roleToolsAllowed = true;
  provider.roleToolsProtocolAvailable = true;
  return sent;
}

test('Codex dynamic tools carry no model-selectable Role identity', () => {
  const tools = listCodexRoleTools();
  assert.equal(tools.length, 13);
  assert.equal(tools.some(tool => JSON.stringify(tool.inputSchema).includes('fromRoleId')), false);
  assert.equal(tools.some(tool => JSON.stringify(tool.inputSchema).includes('"roleId"')), false);
  assert.deepEqual(tools.map(t => t.name).sort(), [
    'crew_whoami','crew_list_roles','crew_get_inbox','crew_send_message','crew_recall','crew_propose_memory','crew_handoff','crew_get_task_status','crew_report_done',
    'crew_context_propose','crew_context_list','crew_context_curate','crew_context_recall'
  ].sort());
});

test('Codex routes dynamic calls through trusted thread binding and rejects unknown thread', async () => {
  const sent = stubTransport();
  const calls = [];
  provider.invokeCrewTool = async (role, tool, args) => {
    calls.push({ role, tool, args });
    return { role, ok: true };
  };
  provider.roleToolsByThread.set('thread-a', 'role-a');
  provider.turns.set('thread-a', { allowCrewTools: true });
  await provider.handleCrewRoleToolCall({
    id: 42, method: 'item/tool/call',
    params: { threadId: 'thread-a', tool: 'crew_whoami', arguments: '{"roleId":"role-b"}' }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].role, 'role-a');
  assert.deepEqual(sent[0].result.contentItems, [{ type: 'inputText',
    text: JSON.stringify({ role: 'role-a', ok: true }) }]);
  assert.equal(sent[0].result.success, true);

  await provider.handleCrewRoleToolCall({
    id: 43, params: { threadId: 'unbound', tool: 'crew_recall', arguments: {} }
  });
  assert.equal(sent[1].result.success, false);
  assert.equal(calls.length, 1);

  provider.turns.get('thread-a').allowCrewTools = false;
  await provider.handleCrewRoleToolCall({
    id: 44, params: { threadId: 'thread-a', tool: 'crew_send_message', arguments: { toRoleId: 'role-b', message: 'hi' } }
  });
  assert.equal(sent[2].result.success, false);
  assert.equal(calls.length, 1);

  provider.turns.clear();
  provider.roleToolsByThread.clear();
  provider.process = null;
});

test('Codex new threads advertise role tools while old threads are not rewritten', async () => {
  const sent = stubTransport();
  const calls = [];
  provider.ensureStarted = async () => {};
  provider.getPendingLiveMemoContext = async () => '';
  provider.request = async (method, params) => {
    calls.push({ method, params });
    if (method === 'thread/start') return { thread: { id: 'thread-new' } };
    if (method === 'turn/start') {
      setImmediate(() => provider.handleMessage({
        method: 'turn/completed', params: { threadId: params.threadId, turn: { status: 'completed' } }
      }));
      return { turn: { id: 'turn-1' } };
    }
    throw Error('Unexpected method: ' + method);
  };
  const events = [];
  await provider.startTurn({
    roleId: 'role-a', conversationId: null, model: 'codex-default',
    workspace: '/tmp', prompt: 'who am I?',
    onEvent: event => events.push(event),
    onAbort: () => {}
  });
  assert.equal(calls[0].method, 'thread/start');
  assert.equal(calls[0].params.dynamicTools.length, 13);
  assert.equal(events[0].roleToolsStatus, 'ready');
  assert.equal(provider.roleToolsByThread.get('thread-new'), 'role-a');
  assert.equal(provider.getRoleToolStatus('thread-new').status, 'ready');
  assert.equal(sent.length, 0);
  provider.clearIdleTimer();
  provider.turns.clear();
  provider.process = null;
});

test('Codex on unsupported dynamicTools falls back to plain thread/start', async () => {
  stubTransport();
  provider.ensureStarted = async () => {};
  provider.getPendingLiveMemoContext = async () => '';
  const calls = [];
  provider.request = async (method, params) => {
    calls.push({ method, params });
    if (method === 'thread/start') {
      if (params.dynamicTools) throw Error('unknown field dynamicTools');
      return { thread: { id: 'thread-fallback' } };
    }
    if (method === 'turn/start') {
      setImmediate(() => provider.handleMessage({
        method: 'turn/completed', params: { threadId: params.threadId, turn: { status: 'completed' } }
      }));
      return { turn: { id: 'turn-2' } };
    }
    throw Error('Unexpected method');
  };
  const events = [];
  await provider.startTurn({
    roleId: 'role-b', conversationId: null, model: 'codex-default',
    workspace: '/tmp', prompt: 'test',
    onEvent: e => events.push(e), onAbort: () => {}
  });
  assert.equal(calls.filter(c => c.method === 'thread/start').length, 2);
  assert.equal(events[0].roleToolsStatus, 'legacy_fallback');
  assert.equal(provider.getRoleToolStatus('thread-fallback').status, 'unsupported');
  provider.clearIdleTimer();
  provider.turns.clear();
  provider.process = null;
});
