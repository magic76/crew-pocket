const assert = require('node:assert/strict');
const {
  buildCrewAutoReplyPrompt,
  findLatestRoleRuntime,
  resolveRoleRuntime,
  hasBusyRoleConversation,
  createCrewAutoResponder
} = require('../lib/crew-auto-response');

async function run() {
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
  assert.ok(prompt.includes('handled inside your own current conversation'));
  assert.ok(prompt.includes("sender's Context, Memory, Conversation, Project, workspace and tool state are not copied"));
  assert.ok(prompt.includes('do not modify files, run tools, build, execute commands, or delegate'));
  assert.ok(prompt.includes('Do not call send_message yourself'));

  const settingsByProvider = {
    codex: new Map([
      ['codex-old', { roleId: 'role-b', model: 'gpt-old', effort: 'low', workspace: '/old', updatedAt: 10 }],
      ['codex-new', { roleId: 'role-b', model: 'gpt-new', effort: 'medium', workspace: '/new', updatedAt: 30 }]
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
  assert.equal(latest.conversationId, 'agy-newer');

  const activated = [];
  const resolved = await resolveRoleRuntime('role-b', {
    listProviders: () => providers,
    getProviderConversationSettings,
    getDefaultModel: providerId => providerId + '-default',
    getRoleRuntime: async () => null,
    activateRoleConversation: async value => {
      activated.push(value);
      return { ...value, activatedAt: 1, updatedAt: 1 };
    },
    clearRoleConversation: async () => false
  });
  assert.equal(resolved.conversationId, 'agy-newer');
  assert.equal(activated.length, 1);

  assert.equal(await hasBusyRoleConversation('role-b', {
    getRoleRuntime: async () => ({ providerId: 'codex', conversationId: 'codex-old' }),
    getProvider: id => providers.find(provider => provider.id === id)
  }), true);

  const roles = new Map([
    ['role-a', { id: 'role-a', name: 'Role A', projectId: null }],
    ['role-b', { id: 'role-b', name: 'Role B', projectId: null }]
  ]);

  // Existing active conversation: resume it, pass its id into memory/context
  // assembly, and return the reply inline to the sender tool call.
  {
    const runtime = new Map([
      ['role-b', {
        roleId: 'role-b',
        providerId: 'codex',
        conversationId: 'existing-thread',
        model: 'gpt-current',
        effort: 'medium',
        workspace: '/workspace-b'
      }]
    ]);
    const settings = new Map([
      ['existing-thread', {
        roleId: 'role-b',
        model: 'gpt-current',
        effort: 'medium',
        workspace: '/workspace-b',
        updatedAt: 100
      }]
    ]);
    const sent = [];
    const delivered = [];
    const contextCalls = [];
    let deleteCalled = false;
    let startConversationId = undefined;
    const fakeProvider = {
      id: 'codex',
      metadata: { capabilities: { delete: true } },
      getStatus: () => ({ isBusy: false }),
      async startTurn({ conversationId, onAbort, onEvent, prompt: receivedPrompt }) {
        startConversationId = conversationId;
        onAbort(() => {});
        assert.ok(receivedPrompt.includes('hello B'));
        onEvent({ type: 'session_started', conversationId });
        onEvent({ type: 'turn_completed', conversationId, response: 'hello A' });
        return { conversationId };
      },
      async deleteConversation() {
        deleteCalled = true;
      }
    };
    const responder = createCrewAutoResponder({
      listProviders: () => [fakeProvider],
      getProvider: () => fakeProvider,
      getProviderConversationSettings: async () => settings,
      saveConversationSettings: async (_provider, conversationId, value) => ({ ...value, provider: 'codex', conversationId }),
      getDefaultModel: () => 'model-default',
      getRole: async id => roles.get(id) || null,
      getRoleRuntime: async id => runtime.get(id) || null,
      activateRoleConversation: async value => {
        runtime.set(value.roleId, value);
        return value;
      },
      clearRoleConversation: async id => runtime.delete(id),
      buildAgentContext: async input => {
        contextCalls.push(input);
        return { role: roles.get(input.roleId), project: null, memories: [], currentTask: input.currentPrompt };
      },
      formatAgentContext: context => '[ROLE ' + context.role.id + ']',
      sendCrewMessage: async message => {
        sent.push(message);
        return { id: 'reply-1', ...message };
      },
      getCrewInbox: async () => [],
      markCrewMessagesDelivered: async (roleId, ids) => {
        delivered.push({ roleId, ids });
        return ids.length;
      },
      runtimeHome: '/tmp',
      logger: { log() {}, warn() {} },
      defer: fn => fn(),
      timeoutMs: 1000
    });

    const result = await responder.dispatch({
      id: 'm2',
      fromRoleId: 'role-a',
      toRoleId: 'role-b',
      content: 'hello B'
    }, { waitForReply: true });

    assert.equal(result.status, 'replied');
    assert.equal(result.delivery, 'inline');
    assert.equal(result.reply, 'hello A');
    assert.equal(result.conversationId, 'existing-thread');
    assert.equal(startConversationId, 'existing-thread');
    assert.equal(contextCalls[0].conversationId, 'existing-thread');
    assert.equal(deleteCalled, false);
    assert.deepEqual(sent[0], {
      fromRoleId: 'role-b',
      toRoleId: 'role-a',
      content: 'hello A',
      replyToId: 'm2'
    });
    assert.deepEqual(delivered, [
      { roleId: 'role-b', ids: ['m2'] },
      { roleId: 'role-a', ids: ['reply-1'] }
    ]);
  }

  // No active conversation: create one real provider conversation, persist it,
  // and keep it as the Role's current conversation.
  {
    const runtime = new Map();
    const saved = [];
    const activatedRuntime = [];
    let startConversationId = 'not-called';
    const fakeProvider = {
      id: 'codex',
      metadata: { capabilities: { delete: true } },
      getStatus: () => ({ isBusy: false }),
      async startTurn({ conversationId, onAbort, onEvent }) {
        startConversationId = conversationId;
        onAbort(() => {});
        onEvent({ type: 'session_started', conversationId: 'new-persistent-thread' });
        onEvent({ type: 'turn_completed', conversationId: 'new-persistent-thread', response: 'created and replied' });
        return { conversationId: 'new-persistent-thread' };
      },
      async deleteConversation() {
        throw new Error('persistent Crew conversation must not be deleted');
      }
    };
    const responder = createCrewAutoResponder({
      listProviders: () => [fakeProvider],
      getProvider: () => fakeProvider,
      getProviderConversationSettings: async () => new Map(),
      saveConversationSettings: async (providerId, conversationId, value) => {
        saved.push({ providerId, conversationId, value });
        return { ...value, provider: providerId };
      },
      getDefaultModel: () => 'model-default',
      getRole: async id => roles.get(id) || null,
      getRoleRuntime: async id => runtime.get(id) || null,
      activateRoleConversation: async value => {
        activatedRuntime.push(value);
        runtime.set(value.roleId, value);
        return value;
      },
      clearRoleConversation: async id => runtime.delete(id),
      buildAgentContext: async input => ({
        role: roles.get(input.roleId),
        project: { workspace: '/role-project' },
        memories: [],
        currentTask: input.currentPrompt
      }),
      formatAgentContext: context => '[ROLE ' + context.role.id + ']',
      sendCrewMessage: async message => ({ id: 'reply-new', ...message }),
      getCrewInbox: async () => [],
      markCrewMessagesDelivered: async () => 1,
      runtimeHome: '/tmp',
      logger: { log() {}, warn() {} },
      defer: fn => fn(),
      timeoutMs: 1000
    });

    const result = await responder.dispatch({
      id: 'm3',
      fromRoleId: 'role-a',
      toRoleId: 'role-b',
      content: 'start your thread'
    }, { waitForReply: true });

    assert.equal(startConversationId, null);
    assert.equal(result.conversationId, 'new-persistent-thread');
    assert.equal(saved[0].conversationId, 'new-persistent-thread');
    assert.equal(saved[0].value.roleId, 'role-b');
    assert.equal(activatedRuntime.at(-1).conversationId, 'new-persistent-thread');
    assert.equal(runtime.get('role-b').conversationId, 'new-persistent-thread');
  }

  // Busy current conversation means the request remains in the message store
  // for later drain; do not create a side conversation.
  {
    let started = false;
    const fakeProvider = {
      id: 'codex',
      getStatus: () => ({ isBusy: true }),
      async startTurn() { started = true; }
    };
    const responder = createCrewAutoResponder({
      listProviders: () => [fakeProvider],
      getProvider: () => fakeProvider,
      getProviderConversationSettings: async () => new Map([
        ['busy-thread', { roleId: 'role-b', model: 'gpt-current', effort: 'low', updatedAt: 1 }]
      ]),
      saveConversationSettings: async () => { throw new Error('should not save'); },
      getDefaultModel: () => 'model-default',
      getRole: async id => roles.get(id) || null,
      getRoleRuntime: async id => id === 'role-b'
        ? { roleId: id, providerId: 'codex', conversationId: 'busy-thread', model: 'gpt-current', effort: 'low' }
        : null,
      activateRoleConversation: async value => value,
      clearRoleConversation: async () => false,
      buildAgentContext: async () => { throw new Error('should not build'); },
      formatAgentContext: () => '',
      sendCrewMessage: async () => { throw new Error('should not reply'); },
      getCrewInbox: async () => [],
      markCrewMessagesDelivered: async () => 0,
      runtimeHome: '/tmp',
      logger: { log() {}, warn() {} },
      defer: fn => fn(),
      timeoutMs: 1000
    });

    const result = await responder.dispatch({
      id: 'm4',
      fromRoleId: 'role-a',
      toRoleId: 'role-b',
      content: 'queued'
    }, { waitForReply: true });
    assert.deepEqual(result, { status: 'pending', reason: 'role_busy' });
    assert.equal(started, false);
  }

  console.log('crew-auto-response tests: ok');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
