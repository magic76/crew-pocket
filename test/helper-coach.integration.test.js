'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { HelperCoachService } = require('../lib/helper-coach/service');
const { HelperCoachStore, defaultHelperCoachStore } = require('../lib/helper-coach/store');
const { HelperCoachBridgeClient, createRequestSignature, validSecret } = require('../lib/helper-coach/bridge-client');
const { HelperCodePRService, validateHelperPatch } = require('../lib/helper-coach/code-pr');
const { handleHelperCoachRoute } = require('../lib/helper-coach/http');
const { SkillRegistry } = require('../lib/skills/registry');
const { LocalMemoryProvider } = require('../lib/memory/local-memory-provider');
const { RoleStore, HELPER_COACH_ROLE_ID } = require('../lib/roles');
const { normalizeEvent } = require('../lib/helper-coach/protocol');

const NOW = Date.now();

class MockHelperBridge {
  constructor(secret, clock) {
    this.secret = secret;
    this.clock = clock;
    this.events = [];
    this.advice = [];
    this.adviceRejection = null;
    this.skills = [];
    this.codeProposals = [];
    this.requests = [];
    this.nonces = new Set();
    this.sequence = 0;
  }

  async start() {
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise(resolve => this.server.listen(0, '127.0.0.1', resolve));
    this.baseUrl = `http://127.0.0.1:${this.server.address().port}`;
  }

  async stop() {
    if (this.server?.listening) await new Promise(resolve => this.server.close(resolve));
  }

  enqueue(kind, taskId, fields = {}, at = this.clock.value) {
    const event = {
      protocol_version: 1,
      event_id: `helper-event-${String(++this.sequence).padStart(6, '0')}`,
      task_id: taskId,
      timestamp: new Date(at).toISOString(),
      source: 'helper',
      kind,
      ...fields
    };
    this.events.push(event);
    return event;
  }

  async handle(req, res) {
    const chunks = [];
    let length = 0;
    for await (const chunk of req) { length += chunk.length; chunks.push(chunk); }
    const rawBody = Buffer.concat(chunks, length);
    const timestamp = req.headers['x-coach-timestamp'];
    const nonce = req.headers['x-coach-nonce'];
    const signature = req.headers['x-coach-signature'];
    const digest = crypto.createHash('sha256').update(rawBody).digest('hex');
    const canonical = `${req.method.toUpperCase()}\n${req.url}\n${timestamp}\n${nonce}\n${digest}`;
    const expected = crypto.createHmac('sha256', Buffer.from(this.secret, 'hex')).update(canonical).digest('hex');
    if (!/^\d{10,16}$/.test(String(timestamp)) || Math.abs(this.clock.value - Number(timestamp)) > 60_000 ||
        !/^[A-Za-z0-9_-]{16,128}$/.test(String(nonce)) || this.nonces.has(nonce) || signature !== expected || rawBody.length > 32 * 1024) {
      return this.respond(res, 401, { success: false, error: 'COACH_AUTH_REJECTED' });
    }
    this.nonces.add(nonce);
    this.requests.push({ method: req.method, target: req.url, headers: req.headers, rawBody });
    const pathname = new URL(req.url, this.baseUrl).pathname;
    if (req.method === 'GET' && pathname === '/coach/v1/events') {
      const url = new URL(req.url, this.baseUrl);
      const cursor = url.searchParams.get('since_event_id') || '';
      const limit = Number(url.searchParams.get('limit'));
      const index = cursor ? this.events.findIndex(event => event.event_id === cursor) : -1;
      const start = index >= 0 ? index + 1 : 0;
      const events = this.events.slice(start, start + limit);
      const hasMore = start + events.length < this.events.length;
      const nextCursor = events.at(-1)?.event_id || cursor;
      return this.respond(res, 200, { protocol_version: 1, events, has_more: hasMore, next_cursor: nextCursor });
    }
    if (req.method !== 'POST') return this.respond(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED' });
    let body;
    try { body = JSON.parse(rawBody.toString('utf8')); }
    catch (_) { return this.respond(res, 400, { success: false, error: 'INVALID_JSON' }); }
    if (pathname === '/coach/v1/advice') {
      if (this.adviceRejection) {
        return this.respond(res, this.adviceRejection.status, this.adviceRejection.body);
      }
      this.advice.push(body);
      return this.respond(res, 202, {
        protocol_version: 1, event_id: body.event_id, advice_event_id: body.event_id,
        observation_event_id: body.observation_event_id, task_id: body.task_id,
        status: 'accepted', queued: true
      });
    }
    if (pathname === '/coach/v1/skill-candidate') {
      this.skills.push(body);
      return this.respond(res, 202, { protocol_version: 1, success: true, status: 'CANDIDATE', skill_id: body.skill_id });
    }
    if (pathname === '/coach/v1/code-change-proposal') {
      this.codeProposals.push(body);
      return this.respond(res, 202, { protocol_version: 1, success: true, status: 'PENDING_REVIEW', proposal_id: 'proposal-001' });
    }
    return this.respond(res, 404, { success: false, error: 'ROUTE_NOT_FOUND' });
  }

  respond(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }
}

function observationFields({ app = 'com.google.android.apps.maps', goal = 'NAVIGATION:START', result = 'failed', retry = true } = {}) {
  return {
    app_package: app,
    goal,
    step_index: 2,
    ui_summary: 'accessibility=available;elements=6;clickable=2;editable=1;scrollable=0',
    available_actions: retry ? ['inspect_ui', 'retry_previous_safe_tap'] : ['inspect_ui'],
    active_skills: [],
    previous_action: result === 'failed' ? 'tap_element/TAP' : '',
    result,
    error_code: result === 'failed' ? 'ACTION_TIMEOUT' : 'NONE',
    evidence_refs: []
  };
}

function actionResultFields(advice, status = 'executed', success = true) {
  return {
    observation_event_id: advice.observation_event_id,
    advice_event_id: advice.event_id,
    suggested_action_id: advice.suggested_action_id,
    status,
    runtime_action_success: success,
    error_code: success ? 'NONE' : 'RUNTIME_ACTION_FAILED',
    evidence_refs: success ? ['TAP_EFFECT_OBSERVED'] : []
  };
}

function outcomeFields(app, { verified = true, method, evidence, result = verified ? 'success' : 'unknown' } = {}) {
  return {
    app_package: app,
    verified,
    verification_method: method,
    duration_ms: 8300,
    result,
    error_code: verified ? 'NONE' : 'TASK_NOT_VERIFIED',
    evidence_refs: [evidence]
  };
}

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'helper-coach-v1-'));
  const clock = { value: NOW };
  const secret = crypto.randomBytes(32).toString('hex');
  const bridge = new MockHelperBridge(secret, clock);
  await bridge.start();
  const store = new HelperCoachStore({ storagePath: path.join(dir, 'coach.json') });
  const skills = new SkillRegistry({ storagePath: path.join(dir, 'skills.json'), now: () => clock.value });
  const memory = new LocalMemoryProvider({ storagePath: path.join(dir, 'memory.json') });
  const bridgeClient = new HelperCoachBridgeClient({ baseUrl: bridge.baseUrl, now: () => clock.value });
  const service = new HelperCoachService({ store, skillRegistry: skills, memoryProvider: memory, bridgeClient, now: () => clock.value, logger: { warn() {} } });
  const pairing = await service.pair({ secret });
  t.after(async () => { service.stopPolling(); await bridge.stop(); await fs.rm(dir, { recursive: true, force: true }); });
  return { dir, clock, secret, bridge, store, skills, memory, bridgeClient, service, pairing };
}

test('Pocket polls Helper with exact HMAC contract, applies scoped advice, and distinguishes queued action from verified task', async t => {
  const { clock, secret, bridge, store, skills, memory, service, pairing } = await fixture(t);
  assert.equal(validSecret(secret), true);
  assert.equal(pairing.pairingSecret, undefined, 'Pocket consumes Helper-owned keys and never generates a replacement');
  await assert.rejects(() => service.pair({ secret: 'not-base64url-or-hex' }), /64 位/);

  const mapsId = 'task-maps-000001';
  const musicId = 'task-music-000001';
  const searchId = 'task-search-000001';
  const otherId = 'task-other-000001';
  bridge.enqueue('task_observation', mapsId, observationFields());
  bridge.enqueue('task_observation', musicId, observationFields({ app: 'com.apple.android.music', goal: 'MEDIA:PLAY' }));
  bridge.enqueue('task_observation', searchId, observationFields({ app: 'com.apple.android.music', goal: 'SEARCH:RESULT' }));
  bridge.enqueue('task_observation', otherId, observationFields({ app: 'com.google.android.apps.maps', goal: 'APP:OPEN' }));

  const polled = await service.pollBridge();
  assert.equal(polled.processed, 4);
  assert.equal(bridge.advice.length, 3, 'unsupported GoalIntent abstains');
  const mapsAdvice = bridge.advice.find(item => item.task_id === mapsId);
  const musicAdvice = bridge.advice.find(item => item.task_id === musicId);
  const searchAdvice = bridge.advice.find(item => item.task_id === searchId);
  assert.equal(mapsAdvice.suggested_action_id, 'retry_previous_safe_tap');
  assert.equal(mapsAdvice.expected_postcondition, 'NAVIGATION_ACTIVE');
  assert.equal(musicAdvice.expected_postcondition, 'MEDIA_PLAYBACK_BECAME_ACTIVE');
  assert.equal(searchAdvice.suggested_action_id, 'inspect_ui');
  assert.equal(searchAdvice.expected_postcondition, 'FRESH_OBSERVATION', 'Pocket does not guess SEARCH:RESULT retry postconditions');
  for (const advice of bridge.advice) {
    assert.deepEqual(advice.parameters, {});
    assert.equal(advice.source, 'pocket');
    assert.equal(advice.kind, 'coach_advice');
    assert.ok(Date.parse(advice.expires_at) <= Date.parse(advice.timestamp) + 60_000);
    assert.ok(Date.parse(advice.expires_at) > clock.value);
    assert.equal(advice.requires_user_confirmation, false);
    assert.ok(advice.confidence >= 0.5);
    for (const forbidden of ['app_package', 'task_type', 'app_version', 'ui_signature', 'ui_fingerprint', 'target', 'query']) {
      assert.equal(Object.hasOwn(advice, forbidden), false);
    }
  }
  const get = bridge.requests.find(item => item.method === 'GET');
  assert.equal(get.target, '/coach/v1/events?since_event_id=&limit=20');
  assert.equal(get.headers['x-coach-timestamp'], String(clock.value));
  assert.match(get.headers['x-coach-nonce'], /^[a-f0-9]{32}$/);
  assert.match(get.headers['x-coach-signature'], /^[a-f0-9]{64}$/);
  assert.equal(get.headers['x-crew-coach-signature'], undefined);
  assert.equal(bridge.requests.filter(item => item.method === 'POST').every(item => !item.headers['x-crew-coach-signature']), true);
  assert.equal(createRequestSignature(secret, 'GET', '/coach/v1/events?since_event_id=x&limit=20', String(clock.value), '0123456789abcdef', Buffer.alloc(0)).length, 64);
  const snapshot = await store.snapshot();
  assert.equal(snapshot.bridgeCursor, 'helper-event-000004');
  assert.equal(snapshot.advice[mapsAdvice.event_id].status, 'queued', '202 means accepted/queued only');

  bridge.enqueue('coach_action_result', mapsId, actionResultFields(mapsAdvice));
  bridge.enqueue('task_outcome', mapsId, outcomeFields('com.google.android.apps.maps', {
    method: 'MAPS_NAVIGATION_ACTIVE_VERIFIED', evidence: 'MAPS_NAVIGATION_ACTIVE_VERIFIED'
  }));
  bridge.enqueue('coach_action_result', musicId, actionResultFields(musicAdvice));
  bridge.enqueue('task_outcome', musicId, outcomeFields('com.apple.android.music', {
    method: 'MEDIA_PLAYBACK_BECAME_ACTIVE', evidence: 'MEDIA_PLAYBACK_BECAME_ACTIVE'
  }));
  bridge.enqueue('task_outcome', searchId, outcomeFields('com.apple.android.music', {
    method: 'RUNTIME_VERIFIED', evidence: 'RUNTIME_VERIFIED'
  }));
  await service.pollBridge();
  const dashboard = await service.dashboard();
  const mapsTask = dashboard.tasks.find(task => task.taskId === mapsId);
  const searchTask = dashboard.tasks.find(task => task.taskId === searchId);
  assert.equal(mapsTask.outcome.verified, true);
  assert.equal(mapsTask.advice[0].status, 'executed');
  assert.equal(mapsTask.advice[0].runtimeActionSuccess, true);
  assert.equal(searchTask.outcome.verified, false, 'a Helper success without a Pocket verifier is not promoted to verified');
  assert.equal(searchTask.verificationStatus, 'no_verifier');
  assert.equal(dashboard.metrics.trackedTasks, 4, 'all observed GoalIntents are included in tracking');
  assert.equal(dashboard.metrics.receivedTasks, 0, 'task observations do not falsely claim a receipt event');
  assert.equal(dashboard.metrics.observedTasks, 4);
  assert.equal(dashboard.metrics.completedTasks, 3, 'terminal outcomes are counted across supported and unsupported coaching scopes');
  assert.equal(dashboard.metrics.verifiableOutcomes, 2);
  assert.equal(dashboard.metrics.verifiedSuccesses, 2);
  assert.equal(dashboard.metrics.failedOutcomes, 0, 'an outcome without a task verifier is not counted as a failure');
  assert.equal(dashboard.metrics.unverifiableOutcomes, 1);
  assert.equal(dashboard.metrics.successRate, 1, 'success rate uses only outcomes with an explicit task verifier');
  const searchCoverage = dashboard.coverage.find(item => item.appPackage === 'com.apple.android.music' && item.goal === 'SEARCH:RESULT');
  assert.equal(searchCoverage.taskCount, 1);
  assert.equal(searchCoverage.tasksWithOutcome, 1);
  assert.equal(searchCoverage.coachSupported, true);
  assert.equal(searchCoverage.verificationSupported, false);
  assert.equal(searchCoverage.unverifiableOutcomes, 1);
  const appOpenCoverage = dashboard.coverage.find(item => item.goal === 'APP:OPEN');
  assert.equal(appOpenCoverage.coachSupported, false, 'unsupported strategy combinations remain visible in coverage');
  assert.equal(dashboard.skills.every(skill => skill.status === 'candidate'), true, 'verified outcomes do not auto-activate Pocket skills');
  assert.equal(bridge.skills.length, 2, 'verified outcomes stage inactive candidates to Helper');
  assert.ok(bridge.skills.every(skill => skill.status === 'candidate' && skill.action_sequence.every(action => action === 'inspect_ui')));
  assert.ok(bridge.skills.some(skill => skill.postconditions.includes('NAVIGATION_TRANSITION_OBSERVED')));
  const learned = (await skills.list('role-helper-coach')).skills;
  assert.ok(learned.every(skill => skill.sourceConversationIds.length === 0 && skill.sourceEventIds.length > 0));
  assert.equal((await memory.readAll()).length, 2);
});

test('cursor paging, exclusive next_cursor, event deduplication, and stale observations are safe', async t => {
  const { bridge, store, service, clock } = await fixture(t);
  for (let index = 0; index < 25; index++) {
    bridge.enqueue('task_observation', `unclassified-${String(index).padStart(4, '0')}`,
      observationFields({ goal: 'APP:OPEN', result: 'unknown', retry: false }));
  }
  const first = await service.pollBridge();
  assert.equal(first.pages, 2);
  assert.equal(first.processed, 25);
  assert.equal(bridge.requests.filter(item => item.method === 'GET').length, 2);
  assert.equal(bridge.requests[1].target, '/coach/v1/events?since_event_id=helper-event-000020&limit=20');
  assert.equal(bridge.advice.length, 0);

  await store.mutate(state => { state.bridgeCursor = 'cursor-aged-out'; });
  const replay = await service.pollBridge();
  assert.equal(replay.processed, 0);
  assert.equal((await store.snapshot()).events.filter(item => item.kind === 'task_observation').length, 25);

  const staleId = 'stale-observation-001';
  bridge.enqueue('task_observation', staleId, observationFields({ result: 'failed' }), clock.value - 61_000);
  await service.pollBridge();
  const stale = (await service.dashboard()).tasks.find(task => task.taskId === staleId);
  assert.equal(stale.stage, 'stale_observation');
  assert.equal(bridge.advice.length, 0);

  const futureId = 'future-observation-001';
  bridge.enqueue('task_observation', futureId, observationFields(), clock.value + 61_000);
  await service.pollBridge();
  const future = (await service.dashboard()).tasks.find(task => task.taskId === futureId);
  assert.equal(future.stage, 'stale_observation');
  assert.equal(bridge.advice.length, 0);
});

test('privacy-safe task_received events let Pocket track accepted work before the first observation', async t => {
  const { bridge, service } = await fixture(t);
  const taskId = 'received-before-observation-001';
  bridge.enqueue('task_received', taskId, {
    app_package: 'com.google.android.apps.maps', goal: 'NAVIGATION:START'
  });

  const polled = await service.pollBridge();
  const dashboard = await service.dashboard();
  const task = dashboard.tasks.find(item => item.taskId === taskId);
  assert.equal(polled.processed, 1);
  assert.equal(task.stage, 'received');
  assert.equal(task.observationCount, 0);
  assert.equal(task.receivedAt, NOW);
  assert.equal(task.coachSupported, true);
  assert.equal(task.verificationSupported, true);
  assert.equal(dashboard.metrics.trackedTasks, 1);
  assert.equal(dashboard.metrics.receivedTasks, 1);
  assert.equal(dashboard.metrics.observedTasks, 0);
  assert.equal(dashboard.metrics.openTasks, 1);
  assert.equal(dashboard.coverage[0].taskCount, 1);
  assert.equal(dashboard.coverage[0].receivedTasks, 1);
  assert.equal(bridge.advice.length, 0, 'receipt alone never triggers an action');

  const base = {
    protocol_version: 1, event_id: 'received-event-001', task_id: 'received-task-001',
    timestamp: new Date(NOW).toISOString(), source: 'helper', kind: 'task_received',
    app_package: '', goal: ''
  };
  const { normalizeEvent } = require('../lib/helper-coach/protocol');
  assert.equal(normalizeEvent(base).goal, '');
  assert.throws(() => normalizeEvent({ ...base, message: 'private text' }), /Unexpected Helper protocol field/);
});

test('APP:OPEN can be verified from target-package transition evidence without enabling coaching advice', async t => {
  const { bridge, service } = await fixture(t);
  const taskId = 'app-open-verified-001';
  bridge.enqueue('task_received', taskId, { app_package: '', goal: 'APP:OPEN' });
  bridge.enqueue('task_outcome', taskId, outcomeFields('com.google.android.youtube', {
    method: 'APP_PACKAGE_TRANSITION_OBSERVED', evidence: 'APP_PACKAGE_TRANSITION_OBSERVED'
  }));

  await service.pollBridge();
  const dashboard = await service.dashboard();
  const task = dashboard.tasks.find(item => item.taskId === taskId);
  assert.equal(task.coachSupported, false, 'verifier coverage does not imply a coaching strategy');
  assert.equal(task.verificationSupported, true);
  assert.equal(task.outcome.verified, true);
  assert.equal(dashboard.metrics.verifiedSuccesses, 1);
  assert.equal(bridge.advice.length, 0, 'verification-only coverage never authorizes an app launch');
});

test('fixed-app outcomes cannot change task identity to bypass the task verifier', async t => {
  const { bridge, service } = await fixture(t);
  const taskId = 'maps-outcome-package-mismatch-001';
  bridge.enqueue('task_observation', taskId, observationFields({ result: 'unknown', retry: false }));
  await service.pollBridge();
  bridge.enqueue('task_outcome', taskId, outcomeFields('com.google.android.youtube', {
    method: 'MAPS_NAVIGATION_ACTIVE_VERIFIED', evidence: 'MAPS_NAVIGATION_ACTIVE_VERIFIED'
  }));

  await service.pollBridge();
  const dashboard = await service.dashboard();
  const task = dashboard.tasks.find(item => item.taskId === taskId);
  assert.equal(task.appPackage, 'com.google.android.apps.maps');
  assert.equal(task.verificationSupported, true);
  assert.equal(task.outcome.verified, false);
  assert.equal(task.lastFailureCause, 'OUTCOME_APP_MISMATCH');
});

test('expired queued advice is shown as unresolved and no longer blocks a fresh observation', async t => {
  const { bridge, store, service, clock } = await fixture(t);
  const taskId = 'expired-advice-task-001';
  bridge.enqueue('task_observation', taskId, observationFields());
  await service.pollBridge();
  assert.equal(bridge.advice.length, 1);

  clock.value += 61_000;
  bridge.enqueue('task_observation', taskId, observationFields({ result: 'unknown' }));
  await service.pollBridge();

  const state = await store.snapshot();
  const advice = Object.values(state.advice).filter(item => item.taskId === taskId);
  assert.equal(advice.length, 2);
  assert.equal(advice.find(item => item.adviceEventId === bridge.advice[0].event_id).status, 'expired_no_result');
  assert.equal(advice.find(item => item.adviceEventId === bridge.advice[0].event_id).errorCode, 'ADVICE_TTL_EXPIRED');
  assert.equal(advice.find(item => item.adviceEventId === bridge.advice[1].event_id).status, 'queued');
  assert.equal(bridge.advice[1].suggested_action_id, 'inspect_ui');
});

test('a successful inspect is not repeated without a fresh Helper safe-retry signal', async t => {
  const { bridge, store, service } = await fixture(t);
  const taskId = 'inspect-replan-task-001';
  bridge.enqueue('task_observation', taskId, observationFields({ retry: false }));
  await service.pollBridge();
  assert.equal(bridge.advice.length, 1);
  assert.equal(bridge.advice[0].suggested_action_id, 'inspect_ui');

  bridge.enqueue('coach_action_result', taskId, actionResultFields(bridge.advice[0], 'executed', true));
  bridge.enqueue('task_observation', taskId, observationFields({ retry: false }));
  await service.pollBridge();
  let state = await store.snapshot();
  assert.equal(bridge.advice.length, 1, 'Pocket abstains instead of repeating a successful inspect');
  assert.equal(state.tasks[taskId].stage, 'abstained');
  assert.equal(state.tasks[taskId].adviceCount, 1, 'abstaining does not consume the advice quota');
  assert.equal(state.tasks[taskId].successfulInspectCount, 1);
  assert.match(state.events.at(-1).summary, /Let Helper Runtime replan/);

  bridge.enqueue('task_observation', taskId, observationFields({ retry: true, result: 'failed' }));
  await service.pollBridge();
  state = await store.snapshot();
  assert.equal(bridge.advice.length, 2, 'a new Helper-advertised safe retry may still be suggested');
  assert.equal(bridge.advice[1].suggested_action_id, 'retry_previous_safe_tap');
  assert.equal(bridge.advice[1].expected_postcondition, 'NAVIGATION_ACTIVE');
  assert.equal(state.tasks[taskId].adviceCount, 2);
});

test('successful RUNTIME_VERIFIED observations wait for the terminal outcome without advice', async t => {
  const { bridge, store, service } = await fixture(t);
  const taskId = 'runtime-verified-observation-001';
  bridge.enqueue('task_observation', taskId, observationFields({
    app: 'com.apple.android.music', goal: 'MEDIA:PLAY', result: 'failed', retry: true
  }));
  for (let index = 0; index < 19; index++) {
    bridge.enqueue('task_observation', `runtime-verified-filler-${String(index).padStart(2, '0')}`, observationFields({
      goal: 'APP:OPEN', result: 'unknown', retry: false
    }));
  }
  const observation = observationFields({
    app: 'com.apple.android.music', goal: 'MEDIA:PLAY', result: 'success', retry: false
  });
  observation.error_code = 'RUNTIME_VERIFIED';
  observation.evidence_refs = ['RUNTIME_VERIFIED'];
  bridge.enqueue('task_observation', taskId, observation);

  const firstPoll = await service.pollBridge();
  assert.equal(firstPoll.pages, 2, 'successful marker is on the next feed page');
  let state = await store.snapshot();
  assert.equal(bridge.advice.length, 0);
  assert.equal(state.tasks[taskId].stage, 'awaiting_outcome');
  assert.equal(state.tasks[taskId].awaitingTerminalOutcome, true);
  assert.equal(state.tasks[taskId].adviceCount, 0);

  bridge.enqueue('task_observation', taskId, observationFields({
    app: 'com.apple.android.music', goal: 'MEDIA:PLAY', result: 'failed', retry: true
  }));
  await service.pollBridge();
  state = await store.snapshot();
  assert.equal(bridge.advice.length, 0, 'later observations remain suppressed while the outcome is pending');
  assert.equal(state.tasks[taskId].stage, 'awaiting_outcome');
  assert.equal(state.tasks[taskId].awaitingTerminalOutcome, true);

  bridge.enqueue('task_outcome', taskId, outcomeFields('com.apple.android.music', {
    method: 'MEDIA_PLAYBACK_BECAME_ACTIVE', evidence: 'MEDIA_PLAYBACK_BECAME_ACTIVE'
  }));
  await service.pollBridge();
  state = await store.snapshot();
  assert.equal(state.tasks[taskId].stage, 'outcome_verified');
  assert.equal(state.tasks[taskId].outcome.verified, true);
  assert.equal(state.tasks[taskId].awaitingTerminalOutcome, false);
  assert.equal(bridge.advice.length, 0);
});

test('an outcome already present in fetched feed pages suppresses earlier observation advice', async t => {
  const { bridge, store, service } = await fixture(t);
  const taskId = 'terminal-outcome-same-poll-001';
  bridge.enqueue('task_observation', taskId, observationFields({
    app: 'com.apple.android.music', goal: 'MEDIA:PLAY', result: 'failed', retry: true
  }));
  for (let index = 0; index < 19; index++) {
    bridge.enqueue('task_observation', `terminal-feed-filler-${String(index).padStart(2, '0')}`, observationFields({
      goal: 'APP:OPEN', result: 'unknown', retry: false
    }));
  }
  bridge.enqueue('task_outcome', taskId, outcomeFields('com.apple.android.music', {
    method: 'MEDIA_PLAYBACK_BECAME_ACTIVE', evidence: 'MEDIA_PLAYBACK_BECAME_ACTIVE'
  }));

  const poll = await service.pollBridge();
  assert.equal(poll.pages, 2, 'terminal outcome is on the next feed page');
  const state = await store.snapshot();
  assert.equal(bridge.advice.length, 0, 'terminal outcome is reconciled before any advice POST');
  assert.equal(state.tasks[taskId].stage, 'outcome_verified');
  assert.equal(state.tasks[taskId].outcome.verified, true);
  assert.equal(state.tasks[taskId].adviceCount || 0, 0);
});

test('422 Helper decision codes are retained in advice state and dashboard output', async t => {
  const { bridge, store, service } = await fixture(t);
  const taskId = 'advice-rejected-decision-001';
  bridge.adviceRejection = { status: 422, body: { decision: 'STALE_TASK' } };
  bridge.enqueue('task_observation', taskId, observationFields({ result: 'failed', retry: false }));

  await service.pollBridge();
  const state = await store.snapshot();
  const advice = Object.values(state.advice).find(item => item.taskId === taskId);
  assert.equal(advice.status, 'rejected');
  assert.equal(advice.errorCode, 'HTTP_422');
  assert.equal(advice.runtimeDecision, 'STALE_TASK');
  const dashboard = await service.dashboard();
  const task = dashboard.tasks.find(item => item.taskId === taskId);
  assert.equal(task.advice[0].runtimeDecision, 'STALE_TASK');
  assert.ok(dashboard.events.some(event => event.kind === 'coach_advice' && event.summary.includes('STALE_TASK')));
});

test('normalizer rejects old task fields and preserves only the Helper v1 allowlist', () => {
  const base = {
    protocol_version: 1, event_id: 'event-001', task_id: 'task-001',
    timestamp: new Date(NOW).toISOString(), source: 'helper', kind: 'task_observation',
    ...observationFields()
  };
  const event = normalizeEvent(base);
  assert.equal(event.goal, 'NAVIGATION:START');
  assert.deepEqual(event.available_actions, ['inspect_ui', 'retry_previous_safe_tap']);
  assert.throws(() => normalizeEvent({ ...base, task_type: 'maps.navigation' }), /Unexpected Helper protocol field/);
  assert.throws(() => normalizeEvent({ ...base, app_version: '1.0.0' }), /Unexpected Helper protocol field/);
  assert.throws(() => normalizeEvent({ ...base, ui_signature: 'screen-abc' }), /Unexpected Helper protocol field/);
  assert.throws(() => normalizeEvent({ ...base, ui_summary: 'search for 123 Fake Street' }), /structural UI counts/);
  assert.throws(() => normalizeEvent({ ...base, available_actions: ['maps.start_navigation'] }), /unknown coaching action/);
});

test('outcome success requires a task-specific verification value and trusted matching evidence', () => {
  const { isVerifiedOutcome } = require('../lib/helper-coach/protocol');
  const task = { appPackage: 'com.google.android.apps.maps', goal: 'NAVIGATION:START' };
  assert.equal(isVerifiedOutcome(task, { verified: true, result: 'success', verification_method: 'RUNTIME_VERIFIED', evidence_refs: ['RUNTIME_VERIFIED'] }), false);
  assert.equal(isVerifiedOutcome(task, { verified: true, result: 'success', verification_method: 'MAPS_NAVIGATION_ACTIVE_VERIFIED', evidence_refs: ['MAPS_NAVIGATION_ACTIVE_VERIFIED'] }), true);
  assert.equal(isVerifiedOutcome(task, { verified: true, result: 'success', verification_method: 'NAVIGATION_TRANSITION_OBSERVED', evidence_refs: ['NAVIGATION_TRANSITION_OBSERVED'] }), false);
  assert.equal(isVerifiedOutcome(task, { verified: true, result: 'success', verification_method: 'NAVIGATION_ACTIVE', evidence_refs: ['TAP_EFFECT_OBSERVED'] }), false);
  assert.equal(isVerifiedOutcome(task, { verified: true, result: 'unknown', verification_method: 'MAPS_NAVIGATION_ACTIVE_VERIFIED', evidence_refs: ['MAPS_NAVIGATION_ACTIVE_VERIFIED'] }), false);
  assert.equal(isVerifiedOutcome({ appPackage: 'com.spotify.music', goal: 'MEDIA:PLAY' }, {
    verified: true, result: 'success', verification_method: 'MEDIA_PLAYBACK_BECAME_ACTIVE', evidence_refs: ['MEDIA_PLAYBACK_BECAME_ACTIVE']
  }), true, 'task-level playback evidence applies to a valid target player package');
  assert.equal(isVerifiedOutcome({ appPackage: '', goal: 'APP:OPEN' }, {
    verified: true, result: 'success', verification_method: 'APP_PACKAGE_TRANSITION_OBSERVED', evidence_refs: ['APP_PACKAGE_TRANSITION_OBSERVED']
  }), false, 'a transition without a valid target package is not independently verifiable');
  assert.equal(isVerifiedOutcome({ appPackage: 'com.google.android.youtube', goal: 'APP:OPEN' }, {
    verified: true, result: 'success', verification_method: 'APP_PACKAGE_TRANSITION_OBSERVED', evidence_refs: ['APP_PACKAGE_TRANSITION_OBSERVED']
  }), true);
});

test('Runtime failures require explicit user attribution; code PR workflow stages only a GitHub reference to Helper', async t => {
  const { clock, bridge, service, store } = await fixture(t);
  const taskId = 'failed-maps-task-001';
  bridge.enqueue('task_observation', taskId, observationFields({ result: 'failed', retry: false }));
  await service.pollBridge();
  const inspectAdvice = bridge.advice.find(item => item.task_id === taskId);
  bridge.enqueue('coach_action_result', taskId, actionResultFields(inspectAdvice, 'failed', false));
  bridge.enqueue('task_outcome', taskId, outcomeFields('com.google.android.apps.maps', {
    verified: false, method: 'TASK_NOT_VERIFIED', evidence: 'TASK_NOT_VERIFIED'
  }));
  await service.pollBridge();
  const suggestion = (await service.dashboard()).codeProposals.find(item => item.taskId === taskId);
  assert.equal(suggestion.status, 'needs_code_review');
  await assert.rejects(() => service.recordCodeProposal({
    proposalId: suggestion.id, diagnosis: 'A possible runtime defect affects safe UI recovery.',
    reproductionSteps: ['Start a Maps task.', 'Observe the failed retry.'], testPlan: ['./gradlew testDebugUnitTest --no-daemon']
  }), /明確確認/);
  const proposal = await service.recordCodeProposal({
    proposalId: suggestion.id, runtimeDefectConfirmed: true,
    diagnosis: 'A possible runtime defect affects safe UI recovery.',
    reproductionSteps: ['Start a Maps task.', 'Observe the failed retry.'],
    testPlan: ['./gradlew testDebugUnitTest --no-daemon']
  });
  assert.equal(proposal.status, 'proposal_only');
  assert.equal(proposal.runtimeDefectConfirmedByUser, true);

  const patch = [
    'diff --git a/app/src/main/java/com/crewpocket/helper/Coach.java b/app/src/main/java/com/crewpocket/helper/Coach.java',
    'index 1111111..2222222 100644',
    '--- a/app/src/main/java/com/crewpocket/helper/Coach.java',
    '+++ b/app/src/main/java/com/crewpocket/helper/Coach.java',
    '@@ -1 +1 @@', '-class Coach {}', '+class Coach { int value = 1; }'
  ].join('\n');
  assert.equal(validateHelperPatch(patch).files.length, 1);
  assert.throws(() => validateHelperPatch(patch.replaceAll('app/src/main/java/com/crewpocket/helper/Coach.java', '.github/workflows/ci.yml')), /allowlist/);
  const calls = [];
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'helper-coach-pr-mock-'));
  const prService = new HelperCodePRService({
    store,
    makeTempDir: async () => tempRoot,
    run: async (command, args) => {
      calls.push([command, ...args]);
      return { stdout: command === 'gh' && args[0] === 'pr' && args[1] === 'create'
        ? 'https://github.com/magic76/crew-helper/pull/314\n' : '' };
    }
  });
  const pr = await prService.openPullRequest({ proposalId: proposal.id, title: 'Fix Maps recovery timeout', patch, confirmed: true });
  assert.equal(pr.prUrl, 'https://github.com/magic76/crew-helper/pull/314');
  assert.ok(calls.some(call => call[0] === './gradlew' && call[1] === 'testDebugUnitTest'));
  assert.ok(calls.some(call => call[0] === 'gh' && call[1] === 'pr' && call.includes('--draft')));
  assert.equal(calls.some(call => /merge|deploy|adb|install/i.test(call.join(' '))), false);
  const staged = await service.stageCodeChangeProposal({ proposalId: proposal.id, prUrl: pr.prUrl, title: 'Fix Maps recovery timeout' });
  assert.equal(staged.staged, true);
  assert.equal(bridge.codeProposals.length, 1);
  assert.equal(bridge.codeProposals[0].proposed_diff_ref, pr.prUrl);
  assert.equal(Object.hasOwn(bridge.codeProposals[0], 'patch'), false);
  assert.equal(Object.hasOwn(bridge.codeProposals[0], 'diff'), false);
  assert.equal(clock.value, NOW);
  await fs.rm(tempRoot, { recursive: true, force: true });
});

test('Helper Coach built-in Role is retained and default Pocket services share the local store', async t => {
  const service = new HelperCoachService();
  const codePRService = new HelperCodePRService();
  assert.equal(service.store, defaultHelperCoachStore);
  assert.equal(codePRService.store, defaultHelperCoachStore);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'helper-coach-role-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new RoleStore({ storagePath: path.join(dir, 'roles.json'), projectProvider: {
    listProjects: async () => [], getProject: async () => null
  } });
  const coach = await store.get(HELPER_COACH_ROLE_ID);
  assert.equal(coach.name, 'Helper Coach');
  assert.equal(coach.source, 'builtin');
  assert.match(coach.systemContext, /Runtime is the only component allowed to execute/);
  await assert.rejects(() => store.delete(HELPER_COACH_ROLE_ID), /Built-in Roles/);
});

test('Pocket local pairing route rejects remote, cross-origin, and legacy pushed-event requests', async t => {
  const { service, secret } = await fixture(t);
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    handleHelperCoachRoute(req, res, pathname, {
      service,
      codePRService: { openPullRequest: async () => ({ success: true }) },
      isLoopbackAddress: address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;
  const noOrigin = await fetch(`${url}/api/helper-coach/pair`, { method: 'POST', body: JSON.stringify({ secret }), headers: { 'Content-Type': 'application/json' } });
  assert.equal(noOrigin.status, 403);
  const wrongScheme = await fetch(`${url}/api/helper-coach/pair`, { method: 'POST', body: JSON.stringify({ secret }), headers: { 'Content-Type': 'application/json', Origin: `https://127.0.0.1:${port}` } });
  assert.equal(wrongScheme.status, 403);
  const paired = await fetch(`${url}/api/helper-coach/pair`, { method: 'POST', body: JSON.stringify({ secret }), headers: { 'Content-Type': 'application/json', Origin: url } });
  assert.equal(paired.status, 201);
  const pairBody = await paired.json();
  assert.equal(Object.hasOwn(pairBody, 'pairingSecret'), false, 'pair route does not echo the Helper key');
  const legacy = await fetch(`${url}/api/helper-coach/events`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json', Origin: url } });
  assert.equal(legacy.status, 404, 'Pocket no longer exposes the old inbound :8000 event protocol');
});
