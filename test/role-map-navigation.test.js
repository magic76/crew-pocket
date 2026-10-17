const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
function between(source, begin, end) {
  const start = source.indexOf(begin);
  const stop = source.indexOf(end, start);
  assert.ok(start >= 0 && stop > start, 'source function boundaries must exist');
  return source.slice(start, stop);
}

function roleHarness({ runtime, latest = null, failures = [], openResult = true } = {}) {
  const storage = new Map();
  const calls = [];
  const scope = {
    console, Promise,
    currentRoleId: 'role-a', currentProvider: 'codex', currentConversationId: 'conv-a',
    roleMeta: id => ({ id, name: id }),
    loadCrewStatus: async () => {},
    crewStatusForRole: id => ({ runtime: id === 'role-b' ? runtime : null }),
    loadConversations: async () => [],
    roleLatestConversation: id => id === 'role-b' ? latest : null,
    closeWorkspaceModal: () => {},
    toggleDrawer: () => {},
    activateRoleIdentity: role => { scope.currentRoleId = role.id; },
    showContextToast: message => calls.push(['toast', message]),
    activeConversationStorageKey: () => 'active_conv_id',
    localStorage: { setItem: (key, value) => storage.set(key, value) },
    revokeAllBlobUrls: () => {},
    clearQueuedBtwMessages: async () => {},
    updateContextPill: () => {},
    promptInput: null, cameraInput: null, attachInput: null,
    imagePreviewContainer: null,
    uploadedImagePath: null,
    headerTitle: { textContent: 'current' },
    messagesContainer: { innerHTML: 'old' },
    appendMessage: () => {},
    showRoleNavigationView: () => {},
    roleProjectLabel: () => 'General',
    prepareNewRoleRuntime: async () => {},
    window: {
      getConversationHistoryLoadErrors: () => failures,
      requestProviderPrewarm: () => {},
      openCrewConversation: async (provider, id) => {
        calls.push(['open', provider, id]);
        if (openResult === false && id === 'conv-b') return false;
        scope.currentProvider = provider;
        scope.currentConversationId = id;
        return true;
      }
    }
  };
  const code = between(read('public/js/ui.js'),
    'let roleSelectionVersion = 0;', '\nasync function selectWorkspace(');
  vm.runInNewContext(code + '\nglobalThis.testSelectRole = selectRole;', scope);
  return { scope, calls, select: scope.testSelectRole, storage };
}

test('Role navigation resumes the correct native conversation', async () => {
  const h = roleHarness({ runtime: { conversationId: 'conv-b', providerId: 'antigravity' } });
  assert.equal(await h.select('role-b'), true);
  assert.equal(h.scope.currentRoleId, 'role-b');
  assert.equal(h.scope.currentConversationId, 'conv-b');
  assert.deepEqual(h.calls[0], ['open', 'antigravity', 'conv-b']);
});

test('failed Role restore does not convert existing work into a new conversation', async () => {
  const h = roleHarness({
    runtime: { conversationId: 'conv-b', providerId: 'codex' }, openResult: false
  });
  assert.equal(await h.select('role-b'), false);
  assert.equal(h.scope.currentRoleId, 'role-a');
  assert.equal(h.scope.currentConversationId, 'conv-a');
  assert.ok(h.calls.some(call => call[0] === 'toast'));
});

test('missing provider history is not proof of an empty Role conversation', async () => {
  const h = roleHarness({ runtime: null, failures: ['antigravity'] });
  assert.equal(await h.select('role-b'), false);
  assert.equal(h.scope.currentRoleId, 'role-a');
  assert.equal(h.scope.currentConversationId, 'conv-a');
});

test('new Role with verified empty history can open a fresh work context', async () => {
  const h = roleHarness({ runtime: null });
  assert.equal(await h.select('role-b'), true);
  assert.equal(h.scope.currentRoleId, 'role-b');
  assert.equal(h.scope.currentConversationId, null);
  assert.equal(h.storage.get('active_conv_id'), '__new__');
});

test('AGY session ID is resolved before a Role turn starts', async () => {
  const source = read('lib/providers/antigravity.js');
  const fn = between(source, 'async function awaitConversationId(', '\nasync function startTurn(');
  const ctx = { Promise, setTimeout, clearTimeout, Error };
  vm.runInNewContext(fn + '\nglobalThis.waitForId = awaitConversationId;', ctx);
  const session = { conversationId: null, emitter: new EventEmitter(), process: new EventEmitter() };
  session.process.killed = false;
  const result = ctx.waitForId(session);
  session.conversationId = 'agy-native-1';
  session.emitter.emit('event', { event: 'init', conversation_id: session.conversationId });
  assert.equal(await result, 'agy-native-1');
});
