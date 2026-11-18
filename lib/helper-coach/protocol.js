'use strict';

const MAX_EVENT_BYTES = 16 * 1024;
const MAX_CLOCK_SKEW_MS = 2 * 60 * 1000;
const EVENT_ID = /^[A-Za-z0-9_-]{8,100}$/;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,120}$/;
const APP_VERSION = /^[A-Za-z0-9._+-]{1,80}$/;
const UI_SIGNATURE = /^[A-Za-z0-9._:-]{1,120}$/;

const TASKS = Object.freeze({
  'maps.navigation': Object.freeze({
    appPackage: 'com.google.android.apps.maps',
    label: 'Google Maps 導航',
    actions: ['maps.focus_search', 'maps.enter_destination', 'maps.select_destination', 'maps.start_navigation'],
    verificationMethods: ['navigation_active']
  }),
  'apple_music.search_play': Object.freeze({
    appPackage: 'com.apple.android.music',
    label: 'Apple Music 搜尋並播放',
    actions: ['apple_music.focus_search', 'apple_music.search_catalog', 'apple_music.select_track', 'apple_music.play_selected'],
    verificationMethods: ['playback_active_and_track_matches']
  })
});

const ACTIONS = new Set([
  ...Object.values(TASKS).flatMap(task => task.actions),
  'common.return_to_target_app',
  'common.retry_last_action',
  'common.focus_visible_control',
  'common.request_user_confirmation'
]);

const EVENT_KEYS = Object.freeze({
  task_observation: new Set([
    'protocol_version', 'event_id', 'task_id', 'timestamp', 'source', 'kind',
    'task_type', 'app_package', 'app_version', 'ui_signature', 'step_index',
    'ui_summary', 'available_actions', 'previous_action', 'result', 'error_code',
    'failure_attribution', 'evidence_refs'
  ]),
  advice_validation: new Set([
    'protocol_version', 'event_id', 'task_id', 'timestamp', 'source', 'kind',
    'observation_event_id', 'advice_event_id', 'suggested_action_id', 'accepted',
    'user_confirmed', 'ui_signature', 'rejection_code'
  ]),
  task_outcome: new Set([
    'protocol_version', 'event_id', 'task_id', 'timestamp', 'source', 'kind',
    'verified', 'verification_method', 'duration_ms', 'evidence_refs'
  ])
});

function boundedString(value, max, pattern, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const result = value.trim();
  if (result.length > max || (result && pattern && !pattern.test(result))) throw new Error(`Invalid ${label}`);
  return result;
}

function redactUiSummary(value) {
  if (typeof value !== 'string') throw new Error('ui_summary must be a string');
  return value.trim().slice(0, 500)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\b(?:password|passcode|otp|one.?time code|token|api.?key|credit.?card|cvv)\s*[:=]\s*[^\s,;]+/gi, '[redacted sensitive field]')
    .replace(/\b(?:\+?\d[\d ()-]{7,}\d)\b/g, '[redacted number]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted token]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .slice(0, 320);
}

function normalizeRefs(value) {
  if (!Array.isArray(value) || value.length > 8) throw new Error('evidence_refs must be a bounded array');
  return [...new Set(value.map(item => boundedString(item, 120, SAFE_ID, 'evidence reference')))];
}

function assertAllowedKeys(input, keys) {
  for (const key of Object.keys(input)) {
    if (!keys.has(key)) throw new Error(`Unexpected protocol field: ${key}`);
  }
}

function normalizeEvent(input, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid event envelope');
  if (input.protocol_version !== 1 || input.source !== 'helper') throw new Error('Unsupported protocol envelope');
  if (!EVENT_ID.test(String(input.event_id || '')) || !EVENT_ID.test(String(input.task_id || ''))) {
    throw new Error('Invalid event_id or task_id');
  }
  const timestamp = Date.parse(input.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > MAX_CLOCK_SKEW_MS) throw new Error('Stale event timestamp');
  const kind = String(input.kind || '');
  const allowedKeys = EVENT_KEYS[kind];
  if (!allowedKeys) throw new Error('Unsupported Helper event kind');
  assertAllowedKeys(input, allowedKeys);

  const common = {
    protocol_version: 1,
    event_id: input.event_id,
    task_id: input.task_id,
    timestamp: new Date(timestamp).toISOString(),
    source: 'helper',
    kind
  };

  if (kind === 'task_observation') {
    const taskType = String(input.task_type || '');
    const task = TASKS[taskType];
    if (!task) throw new Error('Unsupported Helper task type');
    const appPackage = boundedString(input.app_package, 160, /^[A-Za-z0-9._]+$/, 'app_package');
    const availableActions = Array.isArray(input.available_actions) ? input.available_actions : [];
    if (availableActions.length > 32 || availableActions.some(action => typeof action !== 'string' || !ACTIONS.has(action))) {
      throw new Error('Runtime advertised an unknown action');
    }
    const result = String(input.result || 'unknown');
    if (!['success', 'failed', 'unknown'].includes(result)) throw new Error('Invalid observation result');
    const previous = input.previous_action;
    let previousAction = null;
    if (previous !== undefined && previous !== null) {
      if (!previous || typeof previous !== 'object' || Array.isArray(previous) ||
          Object.keys(previous).some(key => !['action_id', 'result', 'error_code'].includes(key))) {
        throw new Error('Invalid previous_action');
      }
      if (!ACTIONS.has(previous.action_id) || !['success', 'failed'].includes(previous.result)) {
        throw new Error('Invalid previous action result');
      }
      previousAction = {
        action_id: previous.action_id,
        result: previous.result,
        error_code: boundedString(previous.error_code || '', 64, /^[A-Z][A-Z0-9_]*$/, 'previous action error code') || null
      };
    }
    const stepIndex = Number(input.step_index);
    if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex > task.actions.length) throw new Error('Invalid step_index');
    return {
      ...common,
      task_type: taskType,
      app_package: appPackage,
      app_version: boundedString(input.app_version, 80, APP_VERSION, 'app_version'),
      ui_signature: boundedString(input.ui_signature, 120, UI_SIGNATURE, 'ui_signature'),
      step_index: stepIndex,
      ui_summary: redactUiSummary(input.ui_summary || ''),
      available_actions: [...new Set(availableActions)],
      previous_action: previousAction,
      result,
      error_code: boundedString(input.error_code || '', 64, /^[A-Z][A-Z0-9_]*$/, 'error_code') || null,
      failure_attribution: ['runtime_defect', 'interaction_issue', 'unknown'].includes(input.failure_attribution)
        ? input.failure_attribution : 'unknown',
      evidence_refs: input.evidence_refs === undefined ? [] : normalizeRefs(input.evidence_refs)
    };
  }

  if (kind === 'advice_validation') {
    const accepted = input.accepted;
    if (typeof accepted !== 'boolean') throw new Error('accepted must be boolean');
    const actionId = input.suggested_action_id;
    if (actionId !== null && actionId !== undefined && !ACTIONS.has(actionId)) throw new Error('Unexpected action id');
    return {
      ...common,
      observation_event_id: boundedString(input.observation_event_id, 100, EVENT_ID, 'observation event id'),
      advice_event_id: boundedString(input.advice_event_id, 100, EVENT_ID, 'advice event id'),
      suggested_action_id: actionId || null,
      accepted,
      user_confirmed: input.user_confirmed === true,
      ui_signature: boundedString(input.ui_signature, 120, UI_SIGNATURE, 'ui_signature'),
      rejection_code: boundedString(input.rejection_code || '', 64, /^[A-Z][A-Z0-9_]*$/, 'rejection code') || null
    };
  }

  if (typeof input.verified !== 'boolean') throw new Error('verified must be boolean');
  const verificationMethod = boundedString(input.verification_method || '', 80, /^[a-z][a-z0-9_]*$/, 'verification_method');
  const durationMs = Number(input.duration_ms);
  if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 24 * 60 * 60 * 1000) throw new Error('Invalid duration_ms');
  return {
    ...common,
    verified: input.verified,
    verification_method: verificationMethod,
    duration_ms: durationMs,
    evidence_refs: normalizeRefs(input.evidence_refs)
  };
}

module.exports = {
  ACTIONS,
  APP_VERSION,
  EVENT_ID,
  MAX_CLOCK_SKEW_MS,
  MAX_EVENT_BYTES,
  TASKS,
  UI_SIGNATURE,
  normalizeEvent,
  redactUiSummary
};
