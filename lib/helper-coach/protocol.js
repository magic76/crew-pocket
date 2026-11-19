'use strict';

const MAX_EVENT_BYTES = 32 * 1024;
const MAX_CLOCK_SKEW_MS = 60 * 1000;
const MAX_OBSERVATION_AGE_MS = 60 * 1000;
const EVENT_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const PACKAGE_ID = /^[A-Za-z0-9._]{1,180}$/;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;
const EVIDENCE_REF = /^[A-Za-z0-9._:-]{1,120}$/;
const GOALS = new Set([
  '', 'MEDIA:PAUSE', 'MEDIA:NEXT', 'MEDIA:PREVIOUS', 'NAVIGATION:START',
  'MEDIA:PLAY', 'MESSAGE:SEND', 'TEXT:TYPE_ONLY', 'SEARCH:RESULT', 'APP:OPEN'
]);
const ACTIONS = new Set(['inspect_ui', 'retry_previous_safe_tap']);
const VERIFICATION_METHODS = new Set([
  'NAVIGATION_ACTIVE', 'NAVIGATION_TRANSITION_OBSERVED', 'MAPS_NAVIGATION_ACTIVE_VERIFIED',
  'PLAYBACK_ACTIVE_AND_TRACK_MATCHES', 'MEDIA_PLAYBACK_BECAME_ACTIVE',
  'RUNTIME_VERIFIED', 'TAP_EFFECT_OBSERVED', 'APP_PACKAGE_TRANSITION_OBSERVED',
  'TASK_NOT_VERIFIED', 'RUNTIME_UNVERIFIED', 'UNKNOWN'
]);
const TASKS = Object.freeze({
  mapsNavigation: Object.freeze({
    appPackage: 'com.google.android.apps.maps',
    goal: 'NAVIGATION:START',
    label: 'Google Maps 導航',
    retryPostcondition: 'NAVIGATION_ACTIVE',
    skillPostcondition: 'NAVIGATION_TRANSITION_OBSERVED',
    verificationMethods: ['NAVIGATION_TRANSITION_OBSERVED'],
    trustedEvidence: ['NAVIGATION_TRANSITION_OBSERVED'],
    skillId: 'helper-maps-navigation-safe-coaching-v1',
    skillName: 'Google Maps 安全導航觀察'
  }),
  appleMusicPlay: Object.freeze({
    appPackage: 'com.apple.android.music',
    goal: 'MEDIA:PLAY',
    label: 'Apple Music 搜尋並播放',
    retryPostcondition: 'MEDIA_PLAYBACK_BECAME_ACTIVE',
    skillPostcondition: 'MEDIA_PLAYBACK_BECAME_ACTIVE',
    verificationMethods: ['MEDIA_PLAYBACK_BECAME_ACTIVE'],
    trustedEvidence: ['MEDIA_PLAYBACK_BECAME_ACTIVE'],
    skillId: 'helper-apple-music-play-safe-coaching-v1',
    skillName: 'Apple Music 安全播放觀察'
  }),
  appleMusicSearch: Object.freeze({
    appPackage: 'com.apple.android.music',
    goal: 'SEARCH:RESULT',
    label: 'Apple Music 搜尋',
    retryPostcondition: null,
    verificationMethods: null,
    trustedEvidence: null,
    skillPostcondition: null,
    skillId: 'helper-apple-music-search-safe-coaching-v1',
    skillName: 'Apple Music 搜尋結果觀察'
  })
});

const EVENT_KEYS = Object.freeze({
  task_received: new Set([
    'protocol_version', 'event_id', 'task_id', 'timestamp', 'source', 'kind',
    'app_package', 'goal'
  ]),
  task_observation: new Set([
    'protocol_version', 'event_id', 'task_id', 'timestamp', 'source', 'kind',
    'app_package', 'goal', 'step_index', 'ui_summary', 'available_actions',
    'active_skills', 'previous_action', 'result', 'error_code', 'evidence_refs'
  ]),
  task_outcome: new Set([
    'protocol_version', 'event_id', 'task_id', 'timestamp', 'source', 'kind',
    'app_package', 'verified', 'verification_method', 'duration_ms', 'result',
    'error_code', 'evidence_refs'
  ]),
  coach_action_result: new Set([
    'protocol_version', 'event_id', 'task_id', 'timestamp', 'source', 'kind',
    'observation_event_id', 'advice_event_id', 'suggested_action_id', 'status',
    'runtime_action_success', 'error_code', 'evidence_refs'
  ])
});

function boundedString(value, max, pattern, label, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const result = value.trim();
  if ((!allowEmpty && !result) || result.length > max || (result && pattern && !pattern.test(result))) {
    throw new Error(`Invalid ${label}`);
  }
  return result;
}

function assertAllowedKeys(input, keys) {
  for (const key of Object.keys(input)) {
    if (!keys.has(key)) throw new Error(`Unexpected Helper protocol field: ${key}`);
  }
}

function normalizeRefs(value, { required = false } = {}) {
  if (!Array.isArray(value) || value.length > 12 || (required && value.length === 0)) {
    throw new Error('evidence_refs must be a bounded array');
  }
  return [...new Set(value.map(item => boundedString(item, 120, EVIDENCE_REF, 'evidence reference')))];
}

function normalizeCode(value) {
  if (value === undefined || value === null || value === '') return null;
  const code = boundedString(value, 80, SAFE_CODE, 'error_code');
  return code;
}

function normalizeUiSummary(value) {
  const summary = boundedString(value, 180, null, 'ui_summary');
  const match = summary.match(/^accessibility=(available|unknown);elements=(\d{1,5});clickable=(\d{1,5});editable=(\d{1,5});scrollable=(\d{1,5})$/);
  if (!match) throw new Error('ui_summary must contain structural UI counts only');
  return `accessibility=${match[1]};elements=${Number(match[2])};clickable=${Number(match[3])};editable=${Number(match[4])};scrollable=${Number(match[5])}`;
}

function normalizeActiveSkills(value) {
  if (!Array.isArray(value) || value.length > 16) throw new Error('active_skills must be a bounded array');
  return value.map(skill => {
    if (!skill || typeof skill !== 'object' || Array.isArray(skill)) throw new Error('Invalid active skill summary');
    assertAllowedKeys(skill, new Set(['skill_id', 'version', 'action_sequence']));
    const actions = skill.action_sequence;
    if (!Array.isArray(actions) || actions.length > 5 || actions.some(action => !ACTIONS.has(action))) {
      throw new Error('Invalid active skill actions');
    }
    const version = Number(skill.version);
    if (!Number.isInteger(version) || version < 1 || version > 10000) throw new Error('Invalid active skill version');
    return {
      skill_id: boundedString(skill.skill_id, 120, EVENT_ID, 'skill_id'),
      version,
      action_sequence: [...new Set(actions)]
    };
  });
}

function normalizeEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid event envelope');
  if (input.protocol_version !== 1 || input.source !== 'helper') throw new Error('Unsupported Helper protocol envelope');
  const eventId = boundedString(input.event_id, 128, EVENT_ID, 'event_id');
  const taskId = boundedString(input.task_id, 128, EVENT_ID, 'task_id');
  const timestampMs = Date.parse(input.timestamp);
  if (!Number.isFinite(timestampMs)) throw new Error('Invalid event timestamp');
  const kind = boundedString(input.kind, 40, /^[a-z_]+$/, 'event kind');
  const keys = EVENT_KEYS[kind];
  if (!keys) throw new Error('Unsupported Helper event kind');
  assertAllowedKeys(input, keys);

  const common = {
    protocol_version: 1,
    event_id: eventId,
    task_id: taskId,
    timestamp: new Date(timestampMs).toISOString(),
    timestamp_ms: timestampMs,
    source: 'helper',
    kind
  };

  if (kind === 'task_received') {
    const appPackage = boundedString(input.app_package, 180, PACKAGE_ID, 'app_package', { allowEmpty: true });
    const goal = boundedString(input.goal, 40, /^[A-Z:]*$/, 'goal', { allowEmpty: true });
    if (!GOALS.has(goal)) throw new Error('Unknown GoalIntent value');
    return { ...common, app_package: appPackage, goal };
  }

  if (kind === 'task_observation') {
    const appPackage = boundedString(input.app_package, 180, PACKAGE_ID, 'app_package');
    const goal = boundedString(input.goal, 40, /^[A-Z:]*$/, 'goal', { allowEmpty: true });
    if (!GOALS.has(goal)) throw new Error('Unknown GoalIntent value');
    const stepIndex = Number(input.step_index);
    if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex > 10000) throw new Error('Invalid step_index');
    if (!Array.isArray(input.available_actions) || input.available_actions.length > 8 ||
        input.available_actions.some(action => typeof action !== 'string' || !ACTIONS.has(action))) {
      throw new Error('Runtime advertised an unknown coaching action');
    }
    if (!['success', 'failed', 'unknown'].includes(input.result)) throw new Error('Invalid observation result');
    const previousAction = input.previous_action === ''
      ? '' : boundedString(input.previous_action, 120, /^[A-Za-z0-9._:/-]+$/, 'previous_action', { allowEmpty: true });
    return {
      ...common,
      app_package: appPackage,
      goal,
      step_index: stepIndex,
      ui_summary: normalizeUiSummary(input.ui_summary),
      available_actions: [...new Set(input.available_actions)],
      active_skills: normalizeActiveSkills(input.active_skills),
      previous_action: previousAction,
      result: input.result,
      error_code: normalizeCode(input.error_code),
      evidence_refs: normalizeRefs(input.evidence_refs)
    };
  }

  if (kind === 'task_outcome') {
    const appPackage = boundedString(input.app_package, 180, PACKAGE_ID, 'app_package');
    if (typeof input.verified !== 'boolean') throw new Error('verified must be boolean');
    const verificationMethodRaw = boundedString(input.verification_method, 80, /^[A-Za-z][A-Za-z0-9_]*$/, 'verification_method').toUpperCase();
    const verificationMethod = VERIFICATION_METHODS.has(verificationMethodRaw) ? verificationMethodRaw : 'UNKNOWN';
    const durationMs = Number(input.duration_ms);
    if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 24 * 60 * 60 * 1000) throw new Error('Invalid duration_ms');
    const result = boundedString(input.result, 40, /^(success|failed|unknown)$/i, 'result', { allowEmpty: true }).toLowerCase();
    return {
      ...common,
      app_package: appPackage,
      verified: input.verified,
      verification_method: verificationMethod,
      duration_ms: durationMs,
      result,
      error_code: normalizeCode(input.error_code),
      evidence_refs: normalizeRefs(input.evidence_refs)
    };
  }

  if (!['executed', 'failed', 'cancelled'].includes(input.status)) throw new Error('Invalid coach action result status');
  if (typeof input.runtime_action_success !== 'boolean') throw new Error('runtime_action_success must be boolean');
  const actionId = boundedString(input.suggested_action_id, 80, /^[a-z_]+$/, 'suggested_action_id');
  if (!ACTIONS.has(actionId)) throw new Error('Unexpected coaching action result');
  return {
    ...common,
    observation_event_id: boundedString(input.observation_event_id, 128, EVENT_ID, 'observation_event_id'),
    advice_event_id: boundedString(input.advice_event_id, 128, EVENT_ID, 'advice_event_id'),
    suggested_action_id: actionId,
    status: input.status,
    runtime_action_success: input.runtime_action_success,
    error_code: normalizeCode(input.error_code),
    evidence_refs: normalizeRefs(input.evidence_refs)
  };
}

function normalizeFeedPage(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.protocol_version !== 1 ||
      !Array.isArray(input.events) || input.events.length > 20 || typeof input.has_more !== 'boolean') {
    throw new Error('Invalid Helper event feed page');
  }
  const nextCursor = input.next_cursor === null || input.next_cursor === undefined
    ? '' : boundedString(input.next_cursor, 128, EVENT_ID, 'next_cursor', { allowEmpty: true });
  return { protocol_version: 1, events: input.events, has_more: input.has_more, next_cursor: nextCursor };
}

function taskProfile(appPackage, goal) {
  return Object.values(TASKS).find(task => task.appPackage === appPackage && task.goal === goal) || null;
}

function taskVerifier(appPackage, goal) {
  const profile = taskProfile(appPackage, goal);
  return profile?.verificationMethods?.length && profile?.trustedEvidence?.length ? profile : null;
}

function isVerifiedOutcome(task, outcome) {
  const profile = taskVerifier(task?.appPackage, task?.goal);
  return Boolean(profile?.verificationMethods?.includes(outcome?.verification_method) && outcome?.verified === true &&
    outcome?.result === 'success' && Array.isArray(outcome.evidence_refs) &&
    profile.trustedEvidence.includes(outcome.verification_method) && outcome.evidence_refs.includes(outcome.verification_method));
}

module.exports = {
  ACTIONS,
  EVENT_ID,
  GOALS,
  MAX_CLOCK_SKEW_MS,
  MAX_EVENT_BYTES,
  MAX_OBSERVATION_AGE_MS,
  PACKAGE_ID,
  TASKS,
  VERIFICATION_METHODS,
  isVerifiedOutcome,
  normalizeEvent,
  normalizeFeedPage,
  normalizeUiSummary,
  taskProfile,
  taskVerifier
};
