const { resolveExecutionPolicy } = require('../execution-policy');
const {
  buildApprovedIntent,
  normalizeExecutionIntent,
  policyConflicts,
  shouldCreateExecutionIntent
} = require('../execution-intent');
const { looksLikeContinuation, reviewExecutionIntentWithJev } = require('../jev-router');
const { isLunaModel } = require('../model-runtime');

const EXECUTION_MODES = new Set(['CHAT', 'INSPECT', 'SURGICAL_EDIT', 'DEBUG', 'BUILD']);

function summarizeForJev(prompt) {
  return String(prompt || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(["']?(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret|password|authorization)["']?\s*[:=]\s*)[^,\s"']+/gi, '$1[REDACTED]')
    .replace(/\b[A-Z][A-Z0-9_]{2,}\s*=\s*\S+/g, '[ENV_REDACTED]')
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED]')
    .slice(0, 160);
}

function normalizeCandidates(rawIntent) {
  const rawCandidates = Array.isArray(rawIntent?.candidates)
    ? rawIntent.candidates.slice(0, 3)
    : [rawIntent];
  const used = new Set();
  return rawCandidates.map((candidate, index) => {
    const intent = normalizeExecutionIntent(candidate);
    if (!intent) return null;
    const baseId = String(candidate?.id || candidate?.candidate_id || `candidate_${index + 1}`)
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .slice(0, 48) || `candidate_${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (used.has(id)) id = `${baseId}_${suffix++}`;
    used.add(id);
    return { id, intent };
  }).filter(Boolean);
}

function inferExecutionMode(candidateEntries) {
  const hasWriteCandidate = candidateEntries.some(({ intent }) =>
    intent.expectedFiles > 0 ||
    intent.needsBuild ||
    intent.needsDependencyChange ||
    intent.destructive ||
    intent.broadRefactor);
  if (hasWriteCandidate) return 'SURGICAL_EDIT';
  if (candidateEntries.some(({ intent }) => intent.estimatedTools > 0)) return 'INSPECT';
  return 'CHAT';
}

function reviewOutcome(review, selectedCandidate) {
  if (selectedCandidate && review?.accepted && review?.decision !== 'REJECT_SCOPE') return 'ACCEPT';
  if (review?.decision === 'REJECT_SCOPE') return 'REPLAN';
  return 'BLOCK';
}

async function prepareTurnExecution({
  providerId,
  effectiveModel,
  explicitExecutionMode,
  savedSettings,
  prompt,
  workspace,
  body,
  getProvider,
  turnTiming
}) {
  let routedExecutionMode = explicitExecutionMode;
  let executionSource = explicitExecutionMode ? 'request' : null;
  let jevRoute = null;
  let executionIntent = null;
  let intentReview = null;
  let approvedExecutionIntent = null;
  let planningOutcome = 'SKIP';

  const conversationExecutionMode = providerId === 'codex' &&
    isLunaModel(effectiveModel) &&
    !explicitExecutionMode &&
    EXECUTION_MODES.has(savedSettings?.executionMode)
    ? savedSettings.executionMode
    : null;

  const reusableContinuationMode = conversationExecutionMode && looksLikeContinuation(prompt)
    ? conversationExecutionMode
    : null;

  if (!routedExecutionMode && reusableContinuationMode) {
    routedExecutionMode = reusableContinuationMode;
    executionSource = 'conversation';
    jevRoute = {
      accepted: true,
      outcome: 'ACCEPT',
      mode: reusableContinuationMode,
      source: 'conversation',
      reason: 'continuation_reuse',
      confidence: null,
      latencyMs: 0
    };
  } else if (!routedExecutionMode && conversationExecutionMode) {
    routedExecutionMode = conversationExecutionMode;
    executionSource = 'conversation';
  }

  let executionPolicy = resolveExecutionPolicy({
    provider: providerId,
    model: effectiveModel,
    executionMode: routedExecutionMode,
    executionPolicy: body.execution_policy || body.executionPolicy,
    executionSource
  });

  const isContinuation = Boolean(conversationExecutionMode);
  if (!shouldCreateExecutionIntent({
    provider: providerId,
    model: effectiveModel,
    executionPolicy,
    explicitExecutionMode,
    continuation: isContinuation,
    prompt
  })) {
    return {
      jevInputSummary: summarizeForJev(prompt),
      routedExecutionMode,
      executionSource,
      executionPolicy,
      executionIntent,
      intentReview,
      approvedExecutionIntent,
      jevRoute,
      planningOutcome
    };
  }

  const planningProvider = getProvider(providerId);
  if (typeof planningProvider.planExecutionIntent !== 'function') {
    return {
      jevInputSummary: summarizeForJev(prompt),
      routedExecutionMode,
      executionSource,
      executionPolicy,
      executionIntent,
      intentReview,
      approvedExecutionIntent,
      jevRoute,
      planningOutcome
    };
  }

  try {
    const intentStartedAt = Date.now();
    const rawIntent = await planningProvider.planExecutionIntent({
      model: effectiveModel,
      prompt,
      workspace,
      executionPolicy
    });
    turnTiming.intent_ms = Date.now() - intentStartedAt;

    const candidateEntries = normalizeCandidates(rawIntent);
    if (!candidateEntries.length) throw new Error('Execution intent preflight returned no candidates');

    if (!routedExecutionMode && !conversationExecutionMode) {
      routedExecutionMode = inferExecutionMode(candidateEntries);
      executionSource = 'luna-intent';
      executionPolicy = resolveExecutionPolicy({
        provider: providerId,
        model: effectiveModel,
        executionMode: routedExecutionMode,
        executionPolicy: body.execution_policy || body.executionPolicy,
        executionSource
      });
    }

    const reviewStartedAt = Date.now();
    intentReview = await reviewExecutionIntentWithJev({
      task: prompt,
      candidates: candidateEntries.map(candidate => ({
        id: candidate.id,
        intent: candidate.intent,
        conflicts: policyConflicts(candidate.intent, executionPolicy)
      })),
      currentMode: executionPolicy.mode
    });
    turnTiming.intent_review_ms = Date.now() - reviewStartedAt;
    turnTiming.jev_ms = turnTiming.intent_review_ms;

    const selectedCandidate = candidateEntries.find(candidate => candidate.id === intentReview?.candidateId);
    planningOutcome = reviewOutcome(intentReview, selectedCandidate);
    const suggestedMode = intentReview?.mode || executionPolicy?.mode || null;

    if (planningOutcome === 'ACCEPT') {
      executionIntent = selectedCandidate.intent;
      if (intentReview.mode && intentReview.mode !== executionPolicy.mode) {
        routedExecutionMode = intentReview.mode;
        executionSource = 'jev-intent';
        executionPolicy = resolveExecutionPolicy({
          provider: providerId,
          model: effectiveModel,
          executionMode: routedExecutionMode,
          executionPolicy: body.execution_policy || body.executionPolicy,
          executionSource
        });
      }
      approvedExecutionIntent = buildApprovedIntent(executionIntent, executionPolicy, intentReview);
    } else if (planningOutcome === 'REPLAN') {
      // Keep the narrow execution policy inferred from the original request, but
      // discard the rejected candidate. The provider can re-plan within policy
      // instead of silently degrading an edit/build request into CHAT.
      executionIntent = null;
    } else {
      // A missing/invalid review is a safety block, not a chat classification.
      routedExecutionMode = 'CHAT';
      executionSource = 'jev-intent-block';
      executionPolicy = resolveExecutionPolicy({
        provider: providerId,
        model: effectiveModel,
        executionMode: 'CHAT',
        executionPolicy: body.execution_policy || body.executionPolicy,
        executionSource
      });
    }

    jevRoute = {
      accepted: planningOutcome === 'ACCEPT',
      outcome: planningOutcome,
      mode: executionPolicy?.mode || null,
      suggestedMode,
      candidateId: intentReview?.candidateId || null,
      confidence: intentReview?.confidence ?? null,
      reason: intentReview?.reason || intentReview?.decision || null,
      latencyMs: intentReview?.latencyMs ?? turnTiming.intent_review_ms,
      source: 'jev-intent'
    };
  } catch (error) {
    planningOutcome = 'BLOCK';
    intentReview = {
      accepted: false,
      decision: null,
      mode: executionPolicy?.mode || null,
      reason: 'preflight_error',
      error: String(error.message || error).slice(0, 600)
    };
    routedExecutionMode = 'CHAT';
    executionSource = 'luna-intent-block';
    executionPolicy = resolveExecutionPolicy({
      provider: providerId,
      model: effectiveModel,
      executionMode: 'CHAT',
      executionPolicy: body.execution_policy || body.executionPolicy,
      executionSource
    });
    jevRoute = {
      accepted: false,
      outcome: planningOutcome,
      mode: executionPolicy.mode,
      suggestedMode: intentReview.mode,
      confidence: null,
      reason: 'preflight_error',
      latencyMs: turnTiming.intent_review_ms,
      source: 'jev-intent'
    };
    console.warn('[ExecutionIntent] preflight skipped:', error.message || error);
  }

  return {
    jevInputSummary: summarizeForJev(prompt),
    routedExecutionMode,
    executionSource,
    executionPolicy,
    executionIntent,
    intentReview,
    approvedExecutionIntent,
    jevRoute,
    planningOutcome
  };
}

module.exports = {
  inferExecutionMode,
  normalizeCandidates,
  prepareTurnExecution,
  reviewOutcome,
  summarizeForJev
};
