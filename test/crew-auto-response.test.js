const assert = require('node:assert/strict');
const {
  buildCrewAutoReplyPrompt,
  findLatestRoleRuntime,
  hasBusyRoleConversation,
  createCrewAutoResponder
} = require('../lib/crew-auto-response');

async function run() {
  const settingsByProvider = {
    codex: new Map([
      ['codex-old', { roleId: 'role-b', model: 'gpt-old', effort: 'low', updatedAt: 10 }],
      ['codex-new', { roleId: 'role-b', model: 'gpt-new', effort: 'medium', updatedAt: 30 }]
    ]),
    antigravity: new Map([
      ['agy-newer', { roleId: 'role-b', model: 'gemini-new', effort: 'low', updatedAt: 40 }]
    ])
  };
  const providers = [
    { id: 'codex', getStatus: id => ({ isBusy: id === 'codex-old' }) },
    { id: 'antigravity', getStatus: () => ({ isBusy: false }) }
  ];
  const getProviderConversationSettings = async providerId => settingsByProvider[providerId] || new Map();

  const latest = await findLatestRoleRuntime('role-b', {
    listProviders: () => providers,
    getProviderConversationSettings,
    getDefaultModel: providerId => providerId + '-default'
  });
  assert.equal(latest.providerId, 'antigravity');
  assert.equal(latest.model, 'gemini-new');
  assert.equal(latest.sourceConversationId, 'agy-newer');

  assert.equal(await hasBusyRoleConversation('role-b', {
    listProviders: () => providers,
    getProviderConversationSettings
  }), true);

  const prompt = buildCrewAutoReplyPrompt({
    contextText: '[OWN ROLE CONTEXT]',
    message: {
      id: 'm1',
      fromRoleId: 'role-a',
      toRoleId: 'role-b',
      content: 'What do you think about the fallback?'
    },
    senderRole: { id: 'role-a', name: 'Role A' },
    recipientRole: { id: 'role-b', name: 'Role B' }
  });
  assert.ok(prompt.includes('[OWN ROLE CONTEXT]'));
  assert.ok(prompt.includes('What do you think about the fallback?'));
  assert.ok(prompt.includes('No sender Context, Memory, Conversation, Project, workspace or tool state was transferred.'));
  assert.ok(prompt.includes('do not modify files, run tools, build, execute commands, or delegate'));
  assert.ok(prompt.includes('Do not call send_message yourself'));

  // Scheduling is one-way: the captured final response is stored directly,
  // and the reply does not recursively call schedule().
  const roles = new Map([
    ['role-a', { id: 'role-a', name: 'Role A', projectId: null }],
    ['role-b', { id: 'role-b', name: 'Role B', projectId: null }]
  ]);
  const sent = [];
  const delivered = [];
  const fakeProvider = {
    id: 'codex',
    metadata: { capabilities: { delete: true } },
    getStatus: () => ({ isBusy: false }),
    async startTurn({ onAbort, onEvent, prompt: receivedPrompt }) {
      onAbort(() => {});
      assert.ok(receivedPrompt.includes('hello B'));
      onEvent({ type: 'session_started', conversationId: 'temp-thread' });
      onEvent({ type: 'turn_completed', response: 'hello A' });
      return { conversationId: 'temp-thread' };
    },
    async deleteConversation(id) {
      assert.equal(id, 'temp-thread');
    }
  };
  const immediate = [];
  const responder = createCrewAutoResponder({
    listProviders: () => [fakeProvider],
    getProvider: () => fakeProvider,
    getProviderConversationSettings: async () => new Map(),
    getDefaultModel: () => 'model-default',
    getRole: async id => roles.get(id) || null,
    buildAgentContext: async ({ roleId, currentPrompt }) => ({
      role: roles.get(roleId),
      project: null,
      memories: [],
      currentTask: currentPrompt
    }),
    formatAgentContext: context => '[ROLE ' + context.role.id + ']',
    sendCrewMessage: async message => {
      sent.push(message);
      return { id: 'reply-1', ...message };
    },
    markCrewMessagesDelivered: async (roleId, ids) => {
      delivered.push({ roleId, ids });
      return ids.length;
    },
    runtimeHome: '/tmp',
    logger: { log() {}, warn() {} },
    defer: fn => immediate.push(fn),
    timeoutMs: 1000
  });

  const scheduled = await responder.schedule({
    id: 'm2',
    fromRoleId: 'role-a',
    toRoleId: 'role-b',
    content: 'hello B'
  });
  assert.equal(scheduled.status, 'scheduled');
  assert.equal(immediate.length, 1);
  await immediate.shift()();

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    fromRoleId: 'role-b',
    toRoleId: 'role-a',
    content: 'hello A',
    replyToId: 'm2'
  });
  assert.deepEqual(delivered, [{ roleId: 'role-b', ids: ['m2'] }]);

  console.log('crew-auto-response tests: ok');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
