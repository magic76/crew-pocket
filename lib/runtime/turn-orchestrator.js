const { resolveExecutionPolicy } = require('../execution-policy');
const {
  buildApprovedIntent,
  isHighRiskExecutionPrompt,
  normalizeExecutionIntent,
  policyConflicts,
  shouldCreateExecutionIntent
} = require('../execution-intent');
const { isLunaModel } = require('../model-runtime');

const EXECUTION_MODES = new Set(['CHAT', 'INSPECT', 'SURGICAL_EDIT', 'DEBUG', 'BUILD']);

function looksLikeContinuation(prompt) {
  const text = String(prompt || '').trim().toLowerCase();
  if (!text || text.length > 24) return false;
  return /^(好|好啊|可以|做吧|繼續|继续|再來|再来|開始|开始|go|go ahead|ok|okay|continue|proceed|merge|合併|合并)[!！。.]?$/.test(text);
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

function inferPromptExecutionMode(prompt) {
  const text = String(prompt || '').trim();
  if (!text) return 'CHAT';
  if (isHighRiskExecutionPrompt(text)) return 'BUILD';

  if (/(?:\b(?:bug|error|crash|failure|failing|broken|regression|debug)\b|錯誤|失敗|閃退|崩潰|異常|卡住|卡死|無法|不能|變笨)/i.test(text)) {
    return 'DEBUG';
  }

  if (/(?:\b(?:fix|change|edit|update|implement|add|remove|adjust|modify)\b|修(?:一下|下)?|修改|改掉|調整|新增|加入|刪除|移除|實作|處理)/i.test(text)) {
    return 'SURGICAL_EDIT';
  }

  if (/(?:\b(?:review|inspect|analyze|check|explain|investigate|audit|compare)\b|review(?:一下|下)?|看(?:一下|下)?|檢查|分析|確認|解釋|研究|比較|建議)/i.test(text)) {
    return 'INSPECT';
  }

  return 'CHAT';
}

function candidateScopeScore(intent) {
  if (!intent) return Number.POSITIVE_INFINITY;
  return (
    Math.max(0, Number(intent.expectedFiles) || 0) * 100 +
    Math.max(0, Number(intent.estimatedTools) || 0) * 10 +
    (intent.needsBuild ? 5 : 0) +
    (intent.needsDependencyChange ? 20 : 0) +
    (intent.broadRefactor ? 30 : 0) +
    (intent.destructive ? 1000 : 0)
  );
}

function selectPolicyCompatibleCandidate(candidateEntries, executionPolicy) {
  return candidateEntries
    .map(candidate => ({
      ...candidate,
      conflicts: policyConflicts(candidate.intent, executionPolicy)
    }))
    .filter(candidate => candidate.conflicts.length === 0)
    .sort((a, b) => candidateScopeScore(a.intent) - candidateScopeScore(b.intent))[0] || null;
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
  } else if (!routedExecutionMode && providerId === 'codex' && isLunaModel(effectiveModel)) {
    routedExecutionMode = inferPromptExecutionMode(prompt);
    executionSource = 'local-intent';
  }

  let executionPolicy = resolveExecutionPolicy({
    provider: providerId,
    model: effectiveModel,
    executionMode: routedExecutionMode,
    executionPolicy: body.execution_policy || body.executionPolicy,
    executionSource
  });

  const isContinuation = Boolean(reusableContinuationMode);
  if (!shouldCreateExecutionIntent({
    provider: providerId,
    model: effectiveModel,
    executionPolicy,
    explicitExecutionMode,
    continuation: isContinuation,
    prompt
  })) {
    return {
      routedExecutionMode,
      executionSource,
      executionPolicy,
      executionIntent,
      intentReview,
      approvedExecutionIntent,
      planningOutcome
    };
  }

  const planningProvider = getProvider(providerId);
  if (typeof planningProvider.planExecutionIntent !== 'function') {
    return {
      routedExecutionMode,
      executionSource,
      executionPolicy,
      executionIntent,
      intentReview,
      approvedExecutionIntent,
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

    const selectedCandidate = selectPolicyCompatibleCandidate(candidateEntries, executionPolicy);
    if (selectedCandidate) {
      executionIntent = selectedCandidate.intent;
      intentReview = {
        accepted: true,
        decision: 'LOCAL_POLICY_ACCEPT',
        candidateId: selectedCandidate.id,
        mode: executionPolicy?.mode || null,
        reason: 'policy_compatible',
        conflicts: []
      };
      approvedExecutionIntent = buildApprovedIntent(executionIntent, executionPolicy, intentReview);
      planningOutcome = 'ACCEPT';
    } else {
      const conflicts = candidateEntries.map(candidate => ({
        candidateId: candidate.id,
        conflicts: policyConflicts(candidate.intent, executionPolicy)
      }));
      intentReview = {
        accepted: false,
        decision: 'POLICY_REJECT',
        candidateId: null,
        mode: executionPolicy?.mode || null,
        reason: 'policy_conflict',
        conflicts
      };
      planningOutcome = 'POLICY_REJECT';
    }
  } catch (error) {
    intentReview = {
      accepted: false,
      decision: 'PREFLIGHT_ERROR',
      candidateId: null,
      mode: executionPolicy?.mode || null,
      reason: 'preflight_error',
      error: String(error.message || error).slice(0, 600)
    };
    planningOutcome = 'SKIP';
    console.warn('[ExecutionIntent] preflight skipped:', error.message || error);
  }

  return {
    routedExecutionMode,
    executionSource,
    executionPolicy,
    executionIntent,
    intentReview,
    approvedExecutionIntent,
    planningOutcome
  };
}

module.exports = {
  inferExecutionMode,
  inferPromptExecutionMode,
  looksLikeContinuation,
  normalizeCandidates,
  prepareTurnExecution,
  selectPolicyCompatibleCandidate
};
