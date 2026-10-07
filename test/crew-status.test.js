const assert = require('node:assert/strict');
const { buildCrewStatus } = require('../lib/crew-status');

async function run() {
  const roles = [
    { id: 'role-a', name: 'Role A', projectId: null },
    { id: 'role-b', name: 'Role B', projectId: 'project-b' },
    { id: 'role-c', name: 'Role C', projectId: null }
  ];
  const runtimes = [
    {
      roleId: 'role-a',
      providerId: 'codex',
      conversationId: 'thread-a',
      model: 'gpt-a',
      effort: 'high',
      workspace: '/a',
      activatedAt: 100,
      updatedAt: 300
    },
    {
      roleId: 'role-b',
      providerId: 'codex',
      conversationId: 'thread-b',
      model: 'gpt-b',
      effort: 'medium',
      workspace: '/b',
      activatedAt: 110,
      updatedAt: 250
    }
  ];
  const inboxByRole = {
    'role-a': [
      { id: 'req-1', fromRoleId: 'role-b', toRoleId: 'role-a', content: 'queued request', replyToId: null, createdAt: 310 },
      { id: 'reply-1', fromRoleId: 'role-b', toRoleId: 'role-a', content: 'unread reply', replyToId: 'old', createdAt: 320 }
    ],
    'role-b': [],
    'role-c': []
  };
  const activityByRole = {
    'role-a': [{
      id: 'reply-1',
      direction: 'incoming',
      fromRoleId: 'role-b',
      fromRoleName: 'Role B',
      toRoleId: 'role-a',
      toRoleName: 'Role A',
      content: 'unread reply',
      replyToId: 'old',
      createdAt: 320
    }],
    'role-b': [],
    'role-c': []
  };
  const tasks = [{
    id: 'task-a',
    provider: 'codex',
    conversationId: 'thread-a',
    conversationTitle: 'Runtime routing',
    title: 'Implement role visualization',
    status: 'running',
    updatedAt: 330
  }];

  const status = await buildCrewStatus({
    listRoles: async () => roles,
    listRoleRuntimes: async () => runtimes,
    getConversationSettings: async (_provider, conversationId) => conversationId === 'thread-a'
      ? { title: 'Active A', model: 'gpt-a', effort: 'high', workspace: '/a' }
      : { title: 'Active B', model: 'gpt-b', effort: 'medium', workspace: '/b' },
    getCrewInbox: async roleId => inboxByRole[roleId] || [],
    getCrewMessageActivity: async roleId => activityByRole[roleId] || [],
    getProvider: () => ({
      getStatus(conversationId) {
        return { isBusy: conversationId === 'thread-a' };
      }
    }),
    listTasks: async () => tasks
  });

  const byId = new Map(status.roles.map(item => [item.roleId, item]));
  const a = byId.get('role-a');
  assert.equal(a.state, 'working');
  assert.equal(a.busy, true);
  assert.equal(a.runtime.conversationId, 'thread-a');
  assert.equal(a.currentTask.title, 'Implement role visualization');
  assert.equal(a.queuedRequestCount, 1);
  assert.equal(a.unreadReplyCount, 1);
  assert.equal(a.lastActivityAt, 330);
  assert.equal(a.recentMessage.fromRoleName, 'Role B');

  const b = byId.get('role-b');
  assert.equal(b.state, 'idle');
  assert.equal(b.busy, false);
  assert.equal(b.conversationTitle, 'Active B');

  const c = byId.get('role-c');
  assert.equal(c.state, 'new');
  assert.equal(c.runtime, null);

  // A queued request without an active busy turn is visualized as waiting.
  const waiting = await buildCrewStatus({
    listRoles: async () => [{ id: 'role-w', name: 'Role W' }],
    listRoleRuntimes: async () => [{
      roleId: 'role-w',
      providerId: 'codex',
      conversationId: 'thread-w',
      updatedAt: 10
    }],
    getConversationSettings: async () => ({}),
    getCrewInbox: async () => [{ id: 'q', fromRoleId: 'role-a', toRoleId: 'role-w', content: 'q', replyToId: null, createdAt: 20 }],
    getCrewMessageActivity: async () => [],
    getProvider: () => ({ getStatus: () => ({ isBusy: false }) }),
    listTasks: async () => []
  });
  assert.equal(waiting.roles[0].state, 'waiting');
  assert.equal(waiting.roles[0].queuedRequestCount, 1);

  console.log('crew-status tests: ok');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
