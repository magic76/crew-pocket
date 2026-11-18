'use strict';

const crypto = require('node:crypto');
const { TASKS, actionAllowedForTask } = require('./protocol');

const MAX_ADVICE_PER_TASK = 8;
const ADVICE_TTL_MS = 30 * 1000;

const RECOVERY_ACTIONS = Object.freeze({
  APP_NOT_FOREGROUND: 'common.return_to_target_app',
  ACTION_TIMEOUT: 'common.retry_last_action',
  FOCUS_FAILED: 'common.focus_visible_control',
  PERMISSION_REQUIRED: 'common.request_user_confirmation',
  NAVIGATION_NOT_ACTIVE: 'maps.start_navigation',
  PLAYBACK_NOT_ACTIVE: 'apple_music.play_selected',
  NO_RESULTS: null
});

function chooseAction(event, taskState) {
  const task = TASKS[event.task_type];
  const failed = event.previous_action?.result === 'failed' || event.result === 'failed';
  let actionId = failed ? RECOVERY_ACTIONS[event.error_code || event.previous_action?.error_code] : null;
  if (!actionId && !failed && event.step_index < task.actions.length) actionId = task.actions[event.step_index];
  if (event.error_code === 'NO_RESULTS') actionId = task.actions[Math.max(0, event.step_index - 1)];
  if (actionId && (!actionAllowedForTask(event.task_type, actionId) || !event.available_actions.includes(actionId))) {
    actionId = null;
  }
  if (actionId && taskState.lastSuggestedAction === actionId && failed &&
      !['common.retry_last_action', 'common.request_user_confirmation'].includes(actionId)) actionId = null;
  return actionId;
}

function diagnoseObservation(event, taskState, now = Date.now()) {
  const definition = TASKS[event.task_type];
  if (event.step_index >= definition.actions.length) {
    return { stage: 'awaiting_verification', advice: null, reason: 'All task steps are complete; waiting for an independent postcondition check.' };
  }
  if ((taskState.adviceCount || 0) >= MAX_ADVICE_PER_TASK) {
    return { stage: 'aborted', advice: null, reason: 'Retry limit reached; collect a fresh task observation before coaching again.' };
  }

  const actionId = chooseAction(event, taskState);
  let diagnosis = 'The current screen and task step need a fresh, Runtime-advertised action.';
  let postcondition = 'The expected control or task state is visible in a new Helper observation.';
  let requiresUserConfirmation = false;
  let confidence = 0.68;

  if (event.error_code === 'APP_NOT_FOREGROUND') {
    diagnosis = 'The target app is not in the foreground; return to the selected app and observe it again.';
    postcondition = 'The expected app is foregrounded and its current screen has a new UI signature.';
  } else if (event.error_code === 'ACTION_TIMEOUT') {
    diagnosis = 'The previous action did not return before its deadline; retry it once if the Runtime still advertises that action.';
    postcondition = 'The previous action reports success or the Runtime returns a new observation.';
  } else if (event.error_code === 'FOCUS_FAILED') {
    diagnosis = 'The intended input control did not receive focus; use the currently visible focusable control and re-observe.';
    postcondition = 'The search or destination input is focused.';
  } else if (event.error_code === 'PERMISSION_REQUIRED') {
    diagnosis = 'Android is asking for a permission. The user must approve or decline the system prompt.';
    postcondition = 'The user has made a permission choice and the target app reports its resulting screen.';
    requiresUserConfirmation = true;
  } else if (event.error_code === 'NO_RESULTS') {
    diagnosis = 'The search returned no matches. The user should review the query before the Runtime retries.';
    postcondition = 'A relevant destination or track result is visible.';
    requiresUserConfirmation = true;
  } else if (event.error_code === 'PLAYBACK_NOT_ACTIVE') {
    diagnosis = 'The selected Apple Music item is not playing; ask the Runtime to retry playback and verify playback state.';
    postcondition = 'The player reports active playback and the expected track.';
  } else if (event.error_code === 'NAVIGATION_NOT_ACTIVE') {
    diagnosis = 'Maps has not entered active navigation; retry the advertised start-navigation action and verify the route state.';
    postcondition = 'Maps independently reports active navigation or the visible active route.';
  } else if (event.previous_action?.result === 'failed' || event.result === 'failed') {
    diagnosis = `The previous Runtime action failed${event.error_code ? ` (${event.error_code})` : ''}. Re-observe before trying an advertised recovery action.`;
    confidence = 0.56;
  } else if (event.task_type === 'maps.navigation') {
    diagnosis = 'Continue the navigation flow from the current Maps step; verify that active navigation is shown before reporting completion.';
    postcondition = event.step_index >= 3
      ? 'Maps reports an active route or destination with navigation controls.'
      : 'The next Maps navigation control is visible and the current step is complete.';
    confidence = 0.78;
  } else {
    diagnosis = 'Continue the Apple Music search flow from the current step; opening the app is not sufficient evidence of playback.';
    postcondition = event.step_index >= 3
      ? 'The player reports active playback for the selected track.'
      : 'The next Apple Music search or selection control is visible and the current step is complete.';
    confidence = 0.78;
  }

  if (!actionId) {
    return {
      stage: 'diagnosed',
      advice: null,
      reason: 'No matching safe action was advertised by Helper Runtime; re-observe or ask the user to act.'
    };
  }

  return {
    stage: 'advice_proposed',
    advice: {
      protocol_version: 1,
      event_id: `coach_${crypto.randomUUID().replace(/-/g, '')}`,
      task_id: event.task_id,
      timestamp: new Date(now).toISOString(),
      source: 'pocket',
      kind: 'coach_advice',
      observation_event_id: event.event_id,
      ui_signature: event.ui_signature,
      diagnosis,
      suggested_action_id: actionId,
      expected_postcondition: postcondition,
      confidence,
      expires_at: new Date(now + ADVICE_TTL_MS).toISOString(),
      requires_user_confirmation: requiresUserConfirmation
    }
  };
}

function isVerifiedOutcome(taskType, outcome) {
  const definition = TASKS[taskType];
  return Boolean(definition && outcome.verified === true &&
    definition.verificationMethods.includes(outcome.verification_method) &&
    Array.isArray(outcome.evidence_refs) && outcome.evidence_refs.length > 0);
}

module.exports = {
  ADVICE_TTL_MS,
  MAX_ADVICE_PER_TASK,
  diagnoseObservation,
  isVerifiedOutcome
};
