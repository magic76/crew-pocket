'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { HelperCoachService, createSignature } = require('../lib/helper-coach/service');
const { HelperCoachStore, defaultHelperCoachStore } = require('../lib/helper-coach/store');
const { HelperCodePRService, validateHelperPatch } = require('../lib/helper-coach/code-pr');
const { handleHelperCoachRoute } = require('../lib/helper-coach/http');
const { SkillRegistry } = require('../lib/skills/registry');
const { LocalMemoryProvider } = require('../lib/memory/local-memory-provider');
const { RoleStore, HELPER_COACH_ROLE_ID } = require('../lib/roles');
const { normalizeEvent, redactUiSummary } = require('../lib/helper-coach/protocol');

const NOW = Date.parse('2026-11-18T03:00:00.000Z');

class MockHelperRuntime {
  constructor(service, secret, clock) {
    this.service = service;
    this.secret = secret;
    this.clock = clock;
    this.sequence = 0;
    this.executedActions = [];
  }

  async send(fields) {
    const event = {
      protocol_version: 1,
      event_id: `event_${String(++this.sequence).padStart(6, '0')}`,
      timestamp: new Date(this.clock.value).toISOString(),
      source: 'helper',
      ...fields
    };
    const rawBody = Buffer.from(JSON.stringify(event));
    const timestamp = String(this.clock.value);
    const nonce = `mock_nonce_${String(this.sequence).padStart(8, '0')}`;
    const signature = createSignature(this.secret, timestamp, nonce, rawBody);
    return this.service.receiveSignedEvent({ rawBody, timestamp, nonce, signature });
  }

  async runVerifiedTask(taskType, taskId, packageName, method) {
    const actions = taskType === 'maps.navigation'
      ? ['maps.focus_search', 'maps.enter_destination', 'maps.select_destination', 'maps.start_navigation']
      : ['apple_music.focus_search', 'apple_music.search_catalog', 'apple_music.select_track', 'apple_music.play_selected'];
    let previous = null;
    let advice = null;
    let response;
    for (let step = 0; step <= actions.length; step++) {
      response = await this.send({
        kind: 'task_observation', task_id: taskId, task_type: taskType,
        app_package: packageName, app_version: '1.0.4', ui_signature: `${taskType.replaceAll('.', '_')}_screen_${step}`,
        step_index: step, ui_summary: `step ${step} visible`, available_actions: [...actions, 'common.retry_last_action'],
        previous_action: previous, result: previous?.result || 'unknown', error_code: null
      });
      if (step === actions.length) {
        assert.equal(response.stage, 'awaiting_verification');
        assert.equal(response.advice, null);
        break;
      }
      advice = response.advice;
      assert.ok(advice, 'the Coach should suggest a bounded next action');
      assert.ok(actions.includes(advice.suggested_action_id));
      const validation = await this.send({
        kind: 'advice_validation', task_id: taskId,
        observation_event_id: advice.observation_event_id,
        advice_event_id: advice.event_id,
        suggested_action_id: advice.suggested_action_id,
        accepted: true,
        user_confirmed: false,
        ui_signature: advice.ui_signature,
        rejection_code: null
      });
      assert.equal(validation.stage, 'runtime_validated');
      // The mock Runtime alone executes; Pocket has only returned an action ID.
      this.executedActions.push(validation.action_id);
      previous = { action_id: validation.action_id, result: 'success', error_code: null };
    }
    return this.send({
      kind: 'task_outcome', task_id: taskId, verified: true,
      verification_method: method, duration_ms: 8200,
      evidence_refs: [`evidence_${taskId}`]
    });
  }
}

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'helper-coach-v1-'));
  const clock = { value: NOW };
  const store = new HelperCoachStore({ storagePath: path.join(dir, 'coach.json') });
  const skills = new SkillRegistry({ storagePath: path.join(dir, 'skills.json'), now: () => clock.value });
  const memory = new LocalMemoryProvider({ storagePath: path.join(dir, 'memory.json') });
  const service = new HelperCoachService({ store, skillRegistry: skills, memoryProvider: memory, now: () => clock.value, logger: { warn() {} } });
  const pairing = await service.pair();
  const runtime = new MockHelperRuntime(service, pairing.pairingSecret, clock);
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return { dir, clock, store, skills, memory, service, runtime, pairing };
}

test('Mock Helper Runtime completes Maps and Apple Music coaching, and learning needs independent task IDs', async t => {
  const { clock, service, runtime, skills, memory } = await fixture(t);
  const emptyDashboard = await service.dashboard();
  assert.equal(emptyDashboard.status, 'waiting_for_helper_runtime');
  assert.equal(emptyDashboard.runtimeProtocolAvailable, false);
  assert.equal(emptyDashboard.metrics.successRate, null, 'an empty ledger cannot display a fabricated success rate');
  const mapsOne = await runtime.runVerifiedTask('maps.navigation', 'maps_task_0001', 'com.google.android.apps.maps', 'navigation_active');
  assert.equal(mapsOne.stage, 'outcome_verified');
  assert.equal(mapsOne.skill.status, 'candidate');

  const mapsTwo = await runtime.runVerifiedTask('maps.navigation', 'maps_task_0002', 'com.google.android.apps.maps', 'navigation_active');
  assert.equal(mapsTwo.skill.status, 'active');
  const music = await runtime.runVerifiedTask('apple_music.search_play', 'music_task_0001', 'com.apple.android.music', 'playback_active_and_track_matches');
  assert.equal(music.skill.status, 'candidate');
  assert.equal(runtime.executedActions.length, 12, 'only the Mock Runtime executed Runtime-validated actions');

  const dashboard = await service.dashboard();
  assert.equal(dashboard.metrics.observedTasks, 3);
  assert.equal(dashboard.metrics.completedTasks, 3);
  assert.equal(dashboard.metrics.verifiedSuccesses, 3);
  assert.equal(dashboard.metrics.successRate, 1);
  assert.equal(dashboard.runtimeProtocolAvailable, true);
  const mapsSkill = dashboard.skills.find(skill => skill.appPackage === 'com.google.android.apps.maps');
  assert.equal(mapsSkill.status, 'active');
  assert.equal(mapsSkill.successRate, 1);
  assert.equal(mapsSkill.outcomeCount, 2);
  assert.ok(mapsSkill.preconditions.length >= 3);
  assert.equal(mapsSkill.steps.length, 4);
  assert.ok(mapsSkill.sourceEventIds.length > 0);
  const storedMapsSkill = (await skills.list('role-helper-coach')).skills.find(skill => skill.id === mapsSkill.id);
  assert.deepEqual(storedMapsSkill.sourceConversationIds, [], 'Helper event IDs are not mislabeled as conversations');
  assert.ok(storedMapsSkill.sourceEventIds.length > 0);
  assert.equal(dashboard.skills.find(skill => skill.appPackage === 'com.apple.android.music').status, 'candidate');
  const learnedMemory = await memory.readAll();
  assert.equal(learnedMemory.length, 3);
  assert.equal(learnedMemory[0].provenance.derivation, 'SYSTEM_OBSERVED');
  assert.equal(learnedMemory[0].provenance.sources[0].type, 'tool');
  assert.match(redactUiSummary('token=secret-value; user@example.test; 0912-345-678'), /token: \[redacted\]/);
  assert.doesNotMatch(redactUiSummary('Search query: secret-value; destination: 123 Example Road; https://example.test/?token=abc'),
    /secret-value|123 Example Road|example\.test|token=abc/);
  assert.doesNotMatch(redactUiSummary('user@example.test 0912-345-678 4111 1111 1111 1111'),
    /user@example|0912|4111/);
  assert.equal((await service.dashboard()).runtimeLastSeenAt, clock.value);
  await service.revoke();
  const revokedDashboard = await service.dashboard();
  assert.equal(revokedDashboard.runtimeProtocolAvailable, false);
  assert.equal(revokedDashboard.status, 'not_paired');
});

test('signed event ingress rejects bad auth, stale timestamps, unexpected action IDs, and replays', async t => {
  const { clock, pairing, service } = await fixture(t);
  const event = {
    protocol_version: 1, event_id: 'auth_event_001', task_id: 'auth_task_001',
    timestamp: new Date(clock.value).toISOString(), source: 'helper', kind: 'task_observation',
    task_type: 'maps.navigation', app_package: 'com.google.android.apps.maps', app_version: '1.0.4',
    ui_signature: 'maps_screen_0', step_index: 0, ui_summary: 'search view',
    available_actions: ['maps.focus_search'], previous_action: null, result: 'unknown', error_code: null
  };
  const rawBody = Buffer.from(JSON.stringify(event));
  const base = { rawBody, timestamp: String(clock.value), nonce: 'invalid_auth_nonce_0001' };
  await assert.rejects(() => service.receiveSignedEvent({ ...base, signature: '0'.repeat(64) }), /signature/);
  await assert.rejects(() => service.receiveSignedEvent({ ...base, timestamp: String(clock.value - 130_000), signature: createSignature(pairing.pairingSecret, String(clock.value - 130_000), base.nonce, rawBody) }), /Stale/);

  const badAction = { ...event, event_id: 'auth_event_002', available_actions: ['maps.tap_anything'] };
  const badRaw = Buffer.from(JSON.stringify(badAction));
  await assert.rejects(() => service.receiveSignedEvent({
    rawBody: badRaw, timestamp: String(clock.value), nonce: 'invalid_action_nonce_0002',
    signature: createSignature(pairing.pairingSecret, String(clock.value), 'invalid_action_nonce_0002', badRaw)
  }), /unknown.*action/);

  const crossTask = { ...event, event_id: 'auth_event_003', available_actions: ['apple_music.play_selected'] };
  const crossTaskRaw = Buffer.from(JSON.stringify(crossTask));
  await assert.rejects(() => service.receiveSignedEvent({
    rawBody: crossTaskRaw, timestamp: String(clock.value), nonce: 'cross_task_nonce_00003',
    signature: createSignature(pairing.pairingSecret, String(clock.value), 'cross_task_nonce_00003', crossTaskRaw)
  }), /cross-task action/);

  const rawSensitiveCode = { ...event, event_id: 'auth_event_004', error_code: 'PRIVATE_TOKEN_VALUE' };
  const rawSensitiveCodeBody = Buffer.from(JSON.stringify(rawSensitiveCode));
  await service.receiveSignedEvent({
    rawBody: rawSensitiveCodeBody, timestamp: String(clock.value), nonce: 'safe_error_nonce_000004',
    signature: createSignature(pairing.pairingSecret, String(clock.value), 'safe_error_nonce_000004', rawSensitiveCodeBody)
  });
  const safeEvent = (await service.dashboard()).events.find(item => item.eventId === 'auth_event_004');
  assert.match(safeEvent.summary, /UNKNOWN/);
  assert.doesNotMatch(safeEvent.summary, /PRIVATE_TOKEN_VALUE/);

  const signed = {
    ...base,
    nonce: 'replay_nonce_00000001',
    signature: createSignature(pairing.pairingSecret, base.timestamp, 'replay_nonce_00000001', rawBody)
  };
  await service.receiveSignedEvent(signed);
  await assert.rejects(() => service.receiveSignedEvent(signed), /Replayed/);
  const duplicate = { ...signed, nonce: 'replay_nonce_00000002', signature: createSignature(pairing.pairingSecret, base.timestamp, 'replay_nonce_00000002', rawBody) };
  await assert.rejects(() => service.receiveSignedEvent(duplicate), /Duplicate/);
  assert.equal((await service.dashboard()).metrics.observedTasks, 1);
});

test('unrecognized Runtime error, rejection, and verification strings never reach the ledger', () => {
  const common = {
    protocol_version: 1,
    timestamp: new Date(NOW).toISOString(),
    source: 'helper'
  };
  const rejection = normalizeEvent({
    ...common,
    event_id: 'safe_reject_01', task_id: 'safe_task_0001', kind: 'advice_validation',
    observation_event_id: 'safe_observe_01', advice_event_id: 'safe_advice_001',
    suggested_action_id: null, accepted: false, user_confirmed: false,
    ui_signature: 'maps_ui_safe', rejection_code: 'PRIVATE_TOKEN_VALUE'
  }, NOW);
  assert.equal(rejection.rejection_code, 'UNKNOWN');

  const outcome = normalizeEvent({
    ...common,
    event_id: 'safe_outcome_01', task_id: 'safe_task_0001', kind: 'task_outcome',
    verified: false, verification_method: 'private_token_value', duration_ms: 0, evidence_refs: []
  }, NOW);
  assert.equal(outcome.verification_method, 'unknown');
});

test('expired and mismatched UI advice is aborted; retry budget is bounded', async t => {
  const { clock, runtime, service } = await fixture(t);
  const first = await runtime.send({
    kind: 'task_observation', task_id: 'expired_task_0001', task_type: 'maps.navigation',
    app_package: 'com.google.android.apps.maps', app_version: '1.0.4', ui_signature: 'maps_ui_0',
    step_index: 0, ui_summary: 'search', available_actions: ['maps.focus_search'], previous_action: null,
    result: 'unknown', error_code: null
  });
  clock.value += 31_000;
  const expired = await runtime.send({
    kind: 'advice_validation', task_id: 'expired_task_0001', observation_event_id: first.advice.observation_event_id,
    advice_event_id: first.advice.event_id, suggested_action_id: first.advice.suggested_action_id,
    accepted: true, user_confirmed: false, ui_signature: 'maps_ui_0', rejection_code: null
  });
  assert.equal(expired.stage, 'aborted');

  clock.value += 1;
  const mismatch = await runtime.send({
    kind: 'task_observation', task_id: 'mismatch_task_0001', task_type: 'maps.navigation',
    app_package: 'com.google.android.apps.maps', app_version: '1.0.4', ui_signature: 'maps_ui_current',
    step_index: 0, ui_summary: 'search', available_actions: ['maps.focus_search'], previous_action: null,
    result: 'unknown', error_code: null
  });
  const mismatchedValidation = await runtime.send({
    kind: 'advice_validation', task_id: 'mismatch_task_0001',
    observation_event_id: mismatch.advice.observation_event_id,
    advice_event_id: mismatch.advice.event_id,
    suggested_action_id: mismatch.advice.suggested_action_id,
    accepted: true, user_confirmed: false, ui_signature: 'maps_ui_changed', rejection_code: null
  });
  assert.equal(mismatchedValidation.stage, 'aborted');

  clock.value += 1;
  const retryTask = 'retry_task_0001';
  let observation = await runtime.send({
    kind: 'task_observation', task_id: retryTask, task_type: 'maps.navigation',
    app_package: 'com.google.android.apps.maps', app_version: '1.0.4', ui_signature: 'retry_ui_0',
    step_index: 0, ui_summary: 'search', available_actions: ['maps.focus_search', 'common.retry_last_action'],
    previous_action: null, result: 'unknown', error_code: null
  });
  let previous = null;
  for (let failure = 0; failure < 4; failure++) {
    const advice = observation.advice;
    const validated = await runtime.send({
      kind: 'advice_validation', task_id: retryTask, observation_event_id: advice.observation_event_id,
      advice_event_id: advice.event_id, suggested_action_id: advice.suggested_action_id,
      accepted: true, user_confirmed: false, ui_signature: advice.ui_signature, rejection_code: null
    });
    previous = { action_id: validated.action_id, result: 'failed', error_code: 'ACTION_TIMEOUT' };
    observation = await runtime.send({
      kind: 'task_observation', task_id: retryTask, task_type: 'maps.navigation',
      app_package: 'com.google.android.apps.maps', app_version: '1.0.4', ui_signature: `retry_ui_${failure + 1}`,
      step_index: 0, ui_summary: 'action timed out', available_actions: ['maps.focus_search', 'common.retry_last_action'],
      previous_action: previous, result: 'failed', error_code: 'ACTION_TIMEOUT'
    });
    if (failure < 3) assert.ok(observation.advice);
    else assert.equal(observation.stage, 'aborted');
  }
  const task = (await service.dashboard()).tasks.find(item => item.taskId === retryTask);
  assert.equal(task.retryCount, 3);
  assert.equal(task.stage, 'aborted');
});

test('Apple Music opening is not success unless playback and track are independently verified', async t => {
  const { runtime } = await fixture(t);
  const result = await runtime.runVerifiedTask('apple_music.search_play', 'music_unverified_01', 'com.apple.android.music', 'navigation_active');
  assert.equal(result.verified, false);
  assert.equal(result.skill, null);
});

test('Helper Coach Role is built in and cannot be deleted', async t => {
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

test('actual HTTP event route is loopback-only and Mock Runtime can use HMAC protocol over HTTP', async t => {
  const { service, pairing, clock } = await fixture(t);
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
  const event = {
    protocol_version: 1, event_id: 'http_event_001', task_id: 'http_task_001', timestamp: new Date(clock.value).toISOString(),
    source: 'helper', kind: 'task_observation', task_type: 'apple_music.search_play',
    app_package: 'com.apple.android.music', app_version: '1.0.4', ui_signature: 'music_ui_0', step_index: 0,
    ui_summary: 'search field visible', available_actions: ['apple_music.focus_search'], previous_action: null, result: 'unknown', error_code: null
  };
  const rawBody = Buffer.from(JSON.stringify(event));
  const timestamp = String(clock.value);
  const nonce = 'http_nonce_000000001';
  const signature = createSignature(pairing.pairingSecret, timestamp, nonce, rawBody);
  const response = await fetch(`http://127.0.0.1:${port}/api/helper-coach/events`, {
    method: 'POST', body: rawBody,
    headers: {
      'Content-Type': 'application/json',
      'X-Crew-Coach-Timestamp': timestamp,
      'X-Crew-Coach-Nonce': nonce,
      'X-Crew-Coach-Signature': signature
    }
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).advice.suggested_action_id, 'apple_music.focus_search');
});

test('pairing settings reject non-loopback callers and same-phone requests without a browser origin', async () => {
  const capture = () => ({
    status: 0, body: null,
    writeHead(status) { this.status = status; },
    end(value) { this.body = JSON.parse(value); }
  });
  const options = {
    service: { pair: async () => ({ pairingSecret: 'must-not-be-created' }) },
    codePRService: {},
    isLoopbackAddress: address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)
  };
  const remote = capture();
  await handleHelperCoachRoute({ method: 'GET', headers: {}, socket: { remoteAddress: '192.168.1.20' } }, remote,
    '/api/helper-coach/dashboard', options);
  assert.equal(remote.status, 403);

  const noOrigin = capture();
  await handleHelperCoachRoute({ method: 'POST', headers: { host: '127.0.0.1:8000' }, socket: { remoteAddress: '127.0.0.1' } },
    noOrigin, '/api/helper-coach/pair', options);
  assert.equal(noOrigin.status, 403);
  assert.doesNotMatch(JSON.stringify(noOrigin.body), /must-not-be-created/);

  const wrongScheme = capture();
  await handleHelperCoachRoute({ method: 'POST', headers: {
    host: '127.0.0.1:8000', origin: 'https://127.0.0.1:8000'
  }, socket: { remoteAddress: '127.0.0.1' } }, wrongScheme, '/api/helper-coach/pair', options);
  assert.equal(wrongScheme.status, 403, 'a matching host and port with a different scheme is cross-origin');
});

test('default coaching services share one serialized local store', () => {
  const service = new HelperCoachService();
  const codePRService = new HelperCodePRService();
  assert.equal(service.store, defaultHelperCoachStore);
  assert.equal(codePRService.store, defaultHelperCoachStore);
});

test('code proposal patch allowlist prevents workflows/manifests and requires confirmation before commands', async t => {
  const patch = [
    'diff --git a/app/src/main/java/com/crewpocket/helper/Coach.java b/app/src/main/java/com/crewpocket/helper/Coach.java',
    'index 1111111..2222222 100644',
    '--- a/app/src/main/java/com/crewpocket/helper/Coach.java',
    '+++ b/app/src/main/java/com/crewpocket/helper/Coach.java',
    '@@ -1 +1 @@',
    '-class Coach {}',
    '+class Coach { int value = 1; }'
  ].join('\n');
  assert.equal(validateHelperPatch(patch).files.length, 1);
  assert.throws(() => validateHelperPatch(patch.replaceAll('app/src/main/java/com/crewpocket/helper/Coach.java', '.github/workflows/ci.yml')), /allowlist/);
  assert.throws(() => validateHelperPatch(patch.replaceAll('Coach.java', '../settings.gradle')), /allowlist/);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coach-pr-confirm-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new HelperCoachStore({ storagePath: path.join(dir, 'coach.json') });
  let commandCalls = 0;
  const prService = new HelperCodePRService({ store, run: async () => { commandCalls++; return { stdout: '' }; } });
  await assert.rejects(() => prService.openPullRequest({ proposalId: 'coach-code-123456abcdef', title: 'A safe test title', patch }), /Explicit confirmation/);
  assert.equal(commandCalls, 0);
});

test('runtime-attributed failure creates a provenance-backed code proposal and mocked workflow opens only a Draft PR', async t => {
  const { runtime, service } = await fixture(t);
  const taskId = 'runtime_bug_0001';
  let observation = await runtime.send({
    kind: 'task_observation', task_id: taskId, task_type: 'maps.navigation',
    app_package: 'com.google.android.apps.maps', app_version: '1.0.4', ui_signature: 'maps_bug_0',
    step_index: 0, ui_summary: 'search control visible', available_actions: ['maps.focus_search', 'common.retry_last_action'],
    previous_action: null, result: 'unknown', error_code: null
  });
  for (let failure = 0; failure < 4; failure++) {
    const advice = observation.advice;
    const validation = await runtime.send({
      kind: 'advice_validation', task_id: taskId, observation_event_id: advice.observation_event_id,
      advice_event_id: advice.event_id, suggested_action_id: advice.suggested_action_id,
      accepted: true, user_confirmed: false, ui_signature: advice.ui_signature, rejection_code: null
    });
    observation = await runtime.send({
      kind: 'task_observation', task_id: taskId, task_type: 'maps.navigation',
      app_package: 'com.google.android.apps.maps', app_version: '1.0.4', ui_signature: `maps_bug_${failure + 1}`,
      step_index: 0, ui_summary: 'action failed', available_actions: ['maps.focus_search', 'common.retry_last_action'],
      previous_action: { action_id: validation.action_id, result: 'failed', error_code: 'ACTION_TIMEOUT' },
      result: 'failed', error_code: 'ACTION_TIMEOUT', failure_attribution: 'runtime_defect'
    });
  }
  assert.equal(observation.stage, 'aborted');
  const autoSuggestion = (await service.dashboard()).codeProposals.find(item => item.taskId === taskId);
  assert.equal(autoSuggestion.status, 'needs_code_review');
  const proposal = await service.recordCodeProposal({
    taskId,
    diagnosis: 'The Runtime focus action times out while the Maps search field is visible.',
    reproductionSteps: ['Open Maps.', 'Focus destination search.', 'Observe ACTION_TIMEOUT.'],
    testPlan: ['Add a focused action timeout regression.', 'Run the Helper Android unit test suite.']
  });
  assert.equal(proposal.repository, 'magic76/crew-helper');
  assert.equal(proposal.id, autoSuggestion.id, 'review refines the Runtime-generated evidence suggestion');

  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'helper-coach-pr-mock-'));
  const store = new HelperCoachStore({ storagePath: path.join(temp, 'coach.json') });
  await store.mutate(state => { state.codeProposals.push(proposal); });
  const calls = [];
  const fakeRun = async (command, args) => {
    calls.push([command, ...args]);
    return { stdout: command === 'gh' && args[0] === 'pr' ? 'https://github.com/magic76/crew-helper/pull/314\n' : '' };
  };
  const prService = new HelperCodePRService({ store, run: fakeRun, makeTempDir: async () => temp });
  const patch = [
    'diff --git a/app/src/main/java/com/crewpocket/helper/Coach.java b/app/src/main/java/com/crewpocket/helper/Coach.java',
    'index 1111111..2222222 100644',
    '--- a/app/src/main/java/com/crewpocket/helper/Coach.java',
    '+++ b/app/src/main/java/com/crewpocket/helper/Coach.java',
    '@@ -1 +1 @@', '-class Coach {}', '+class Coach { int value = 1; }'
  ].join('\n');
  const result = await prService.openPullRequest({ proposalId: proposal.id, title: 'Fix Maps focus action timeout', patch, confirmed: true });
  assert.equal(result.prUrl, 'https://github.com/magic76/crew-helper/pull/314');
  assert.ok(calls.some(call => call[0] === './gradlew' && call[1] === 'testDebugUnitTest'));
  assert.ok(calls.some(call => call[0] === 'gh' && call[1] === 'pr' && call.includes('--draft')));
  assert.equal(calls.some(call => /merge|deploy|adb|install/i.test(call.join(' '))), false);
  await fs.rm(temp, { recursive: true, force: true });
});
