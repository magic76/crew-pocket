const WRITE_MODES = new Set(['SURGICAL_EDIT', 'DEBUG', 'BUILD']);

function clampInteger(value, min, max, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function clampConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(1, numeric));
}

function normalizeExecutionIntent(raw = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const expectedFiles = clampInteger(
    raw.expected_files ?? raw.expectedFiles,
    0,
    50,
    0
  );
  const estimatedTools = clampInteger(
    raw.estimated_tools ?? raw.estimatedTools,
    0,
    100,
    0
  );

  return Object.freeze({
    summary: String(raw.summary || '').replace(/\s+/g, ' ').trim().slice(0, 240),
    expectedFiles,
    estimatedTools,
    needsBuild: Boolean(raw.needs_build ?? raw.needsBuild),
    needsDependencyChange: Boolean(raw.needs_dependency_change ?? raw.needsDependencyChange),
    destructive: Boolean(raw.destructive),
    broadRefactor: Boolean(raw.broad_refactor ?? raw.broadRefactor),
    confidence: clampConfidence(raw.confidence)
  });
}

function policyConflicts(intent, policy) {
  if (!intent || !policy) return [];
  const conflicts = [];
  if (!policy.allowWrite && intent.expectedFiles > 0) conflicts.push('write_not_allowed');
  if (intent.expectedFiles > policy.maxFilesChanged) conflicts.push('file_scope');
  if (intent.estimatedTools > policy.hardToolExecutions) conflicts.push('tool_budget');
  if (intent.needsBuild && !policy.allowBuild) conflicts.push('build_not_allowed');
  if (intent.needsDependencyChange && !policy.allowDependencyChanges) conflicts.push('dependency_change');
  if (intent.destructive) conflicts.push('destructive_action');
  if (intent.broadRefactor && policy.mode !== 'BUILD') conflicts.push('broad_refactor');
  return conflicts;
}

function shouldCreateExecutionIntent({
  provider,
  model,
  executionPolicy,
  explicitExecutionMode,
  continuation
} = {}) {
  if (provider !== 'codex' || model !== 'gpt-5.6-luna') return false;
  if (explicitExecutionMode || continuation) return false;
  return WRITE_MODES.has(executionPolicy?.mode);
}

function buildApprovedIntent(intent, policy, review = null) {
  if (!intent || !policy) return null;
  const conflicts = policyConflicts(intent, policy);
  return Object.freeze({
    ...intent,
    approvedMode: policy.mode,
    policyConflicts: conflicts,
    reviewDecision: review?.decision || null,
    reviewReason: review?.reason || null
  });
}

module.exports = {
  WRITE_MODES,
  buildApprovedIntent,
  normalizeExecutionIntent,
  policyConflicts,
  shouldCreateExecutionIntent
};
