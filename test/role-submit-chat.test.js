'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { runChatInBackground } = require('../lib/role-submit');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const identity = source.slice(source.indexOf('function requestedRoleId'), source.indexOf('async function handleConversationSettings'));
const handler = source.slice(source.indexOf('const activeChatRoles = new Set()'), source.indexOf('// 🛑 Abort Active Generation'));
const settings = new Map([['target-thread', { roleId: 'target', model: 'target-model', effort: 'high', workspace: '/target' }]]);
const roles = new Map([['target', { id: 'target', projectId: 'target-project' }]]);
const contextReads = []; const memoryReads = []; const providerCalls = []; const persisted = [];
let releaseTurn = null;
const sandbox = {
  console: { log() {}, warn() {}, error() {} }, crypto: require('node:crypto'),
  DEFAULT_ROLE_ID: 'role-general', RUNTIME_HOME: '/home', TURN_METRICS_DIR: '/metrics', TURN_METRICS_FILE: '/metrics/turns',
  getRole: async id => roles.get(id), getProject: async id => ({ id, workspace: '/target' }),
  getConversationSettings: async (_, id) => settings.get(id),
  saveConversationSettings: async (providerId, id, value) => { settings.set(id, value); persisted.push({ providerId, id, value }); return value; },
  activateRoleConversation: async value => value,
  resolveWorkspace: async candidate => candidate,
  normalizeProviderId: id => id, getDefaultModel: () => 'default-model',
  prepareTurnExecution: async () => ({}),
  getCrewInbox: async () => [], markCrewMessagesDelivered: async () => {},
  getContextSnapshot: async (providerId, id) => { contextReads.push([providerId, id]); return { crewToolGuideVersion: 1 }; },
  roleProjectFingerprint: () => 'target-fingerprint', memoryStoreRevision: async () => 'target-revision',
  buildAgentContext: async input => { memoryReads.push(input); return { contributions: [], memories: [], role: { id: input.roleId } }; },
  formatAgentContext: context => 'OWN MEMORY FOR ' + context.role.id,
  memoryEvidenceSignatures: () => ({}), buildCapabilityGuide: () => '',
  buildCrewToolGuide: role => 'OWN GUIDE ' + role.id, formatCrewInbox: () => '', contributionFromText: input => input,
  ContextSourceType: {}, ContextPriority: {},
  fsPromises: { mkdir: async () => {}, appendFile: async () => {} },
  buildTurnResult: () => null, saveExecutionFeedback: async () => {}, saveContextSnapshot: async () => {},
  broadcastCrewStatusEvent() {}, cleanUserContent: text => text,
  dreamingManager: { recordTurn: async () => {} }, crewAutoResponder: { drain: async () => {}, activeRoles: new Set() },
  setImmediate, setTimeout, clearTimeout,
  getProvider: () => ({ startTurn: async args => {
    providerCalls.push(args);
    if (releaseTurn) await new Promise(resolve => { releaseTurn.resolve = resolve; });
    const id = args.conversationId || 'target-new-thread';
    args.onEvent({ type: 'session_started', conversationId: id });
    args.onEvent({ type: 'text_delta', delta: 'answer' });
    args.onEvent({ type: 'turn_completed', conversationId: id, response: 'answer', status: 'completed' });
  } })
};
vm.createContext(sandbox);
vm.runInContext(identity + '\n' + handler + '\nthis.chatHandler = handleChat;', sandbox);
(async () => {
  const body = { role_id: 'target', provider: 'codex', conversation_id: 'target-thread', model: 'target-model', effort: 'high', prompt: 'analyze marked screenshot', image_path: '/uploads/screen.jpg' };
  const resumed = await runChatInBackground(sandbox.chatHandler, body);
  assert.equal(resumed.error, undefined); assert.equal(resumed.conversation_id, 'target-thread');
  assert.deepEqual(contextReads, [['codex', 'target-thread']]);
  assert.equal(memoryReads.length, 0, 'resumed target retains own resident context');
  assert.equal(providerCalls[0].conversationId, 'target-thread'); assert.equal(providerCalls[0].workspace, '/target');
  assert.equal(providerCalls[0].imagePath, '/uploads/screen.jpg'); assert.equal(providerCalls[0].model, 'target-model');
  assert.match(providerCalls[0].prompt, /analyze marked screenshot/);

  const fresh = await runChatInBackground(sandbox.chatHandler, { ...body, conversation_id: null });
  assert.equal(fresh.error, undefined); assert.equal(fresh.conversation_id, 'target-new-thread');
  assert.equal(memoryReads.at(-1).roleId, 'target'); assert.equal(memoryReads.at(-1).projectId, 'target-project');
  assert.match(providerCalls.at(-1).prompt, /OWN MEMORY FOR target/);
  assert.equal(persisted.at(-1).value.roleId, 'target'); assert.equal(persisted.at(-1).value.workspace, '/target');

  settings.set('sender-thread', { roleId: 'sender', workspace: '/sender' });
  const before = providerCalls.length;
  const rejected = await runChatInBackground(sandbox.chatHandler, { ...body, conversation_id: 'sender-thread' });
  assert.equal(rejected.statusCode, 409); assert.match(rejected.error, /另一個 Role/);
  assert.equal(providerCalls.length, before, 'cross-Role thread cannot reach provider');

  releaseTurn = {};
  const first = runChatInBackground(sandbox.chatHandler, { ...body, conversation_id: null });
  // Hold first new-thread turn while the second attempts to enter the same Role.
  while (!releaseTurn.resolve) await new Promise(resolve => setImmediate(resolve));
  const race = await runChatInBackground(sandbox.chatHandler, { ...body, conversation_id: null });
  assert.equal(race.code, 'CONVERSATION_BUSY');
  const release = releaseTurn.resolve; releaseTurn = null; release(); await first;
  console.log('role-submit-chat: real handler context/workspace isolation, new-thread persistence and Role race passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
