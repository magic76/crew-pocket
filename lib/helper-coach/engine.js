'use strict';

const crypto = require('node:crypto');
const { ACTIONS, MAX_OBSERVATION_AGE_MS, taskProfile } = require('./protocol');

const MAX_ADVICE_PER_TASK = 3;
const ADVICE_TTL_MS = 30 * 1000;

function diagnoseObservation(event, taskState = {}, now = Date.now()) {
  const profile = taskProfile(event.app_package, event.goal);
  if (!profile) {
    return { stage: 'abstained', advice: null, reason: 'This app and GoalIntent are outside the supported coaching scope.' };
  }
  const observationAge = now - event.timestamp_ms;
  if (observationAge < -MAX_OBSERVATION_AGE_MS || observationAge >= MAX_OBSERVATION_AGE_MS) {
    return { stage: 'stale_observation', advice: null, reason: 'The Helper observation is outside its 60-second validity window.' };
  }
  if (event.result === 'success' && event.error_code === 'RUNTIME_VERIFIED') {
    return {
      stage: 'awaiting_outcome',
      advice: null,
      reason: 'Helper Runtime already verified this step; wait for the terminal task_outcome before offering more coaching.'
    };
  }
  if ((taskState.adviceCount || 0) >= MAX_ADVICE_PER_TASK) {
    return { stage: 'retry_limit_reached', advice: null, reason: 'The coaching attempt reached its advice limit; wait for a new task.' };
  }

  const advertised = new Set(event.available_actions);
  let actionId = null;
  let expectedPostcondition = null;
  let diagnosis = '';

  const safeRetryAvailable = profile.retryPostcondition &&
    advertised.has('retry_previous_safe_tap') && event.result === 'failed' && Boolean(event.previous_action);
  if (safeRetryAvailable) {
    actionId = 'retry_previous_safe_tap';
    expectedPostcondition = profile.retryPostcondition;
    diagnosis = 'Helper marked the previous TAP as safe to retry. Retry it once, then verify the task postcondition.';
  } else if ((taskState.successfulInspectCount || 0) > 0) {
    return {
      stage: 'abstained',
      advice: null,
      reason: 'Pocket already requested a successful inspect_ui for this task, and Helper has not advertised a fresh safe retry. Let Helper Runtime replan through its normal flow.'
    };
  } else if (advertised.has('inspect_ui')) {
    actionId = 'inspect_ui';
    expectedPostcondition = 'FRESH_OBSERVATION';
    diagnosis = event.result === 'failed'
      ? 'The last operation failed or did not complete. Refresh the semantic UI observation before choosing another step.'
      : 'Refresh the semantic UI observation and let Helper verify the current task state.';
  }

  if (!actionId || !ACTIONS.has(actionId)) {
    return { stage: 'abstained', advice: null, reason: 'Helper did not advertise an allowed coaching action.' };
  }

  const expiresAtMs = Math.min(now + ADVICE_TTL_MS, event.timestamp_ms + MAX_OBSERVATION_AGE_MS);
  if (expiresAtMs <= now) {
    return { stage: 'stale_observation', advice: null, reason: 'The observation expired before advice could be sent.' };
  }

  return {
    stage: 'advice_submitting',
    advice: {
      protocol_version: 1,
      event_id: crypto.randomUUID(),
      task_id: event.task_id,
      timestamp: new Date(now).toISOString(),
      source: 'pocket',
      kind: 'coach_advice',
      observation_event_id: event.event_id,
      diagnosis,
      suggested_action_id: actionId,
      parameters: {},
      expected_postcondition: expectedPostcondition,
      confidence: 0.78,
      expires_at: new Date(expiresAtMs).toISOString(),
      requires_user_confirmation: false
    }
  };
}

module.exports = { ADVICE_TTL_MS, MAX_ADVICE_PER_TASK, diagnoseObservation };
