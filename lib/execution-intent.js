const { isLunaModel } = require('./model-runtime');

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

function isHighRiskExecutionPrompt(prompt) {
  const text = String(prompt || '').trim();
  if (!text) return false;
  return /(?:\b(?:build|release|deploy|publish|migration|migrate|dependency|dependencies|refactor|rewrite|restructure|upgrade|downgrade|delete|remove|multi[- ]?(?:file|module|repo)|whole project|entire project)\b|建置|打包|發布|發佈|上架|部署|遷移|移轉|依賴|相依|重構|重寫|全面|整個專案|多檔|多模組|刪除|移除)/i.test(text);
}

function shouldCreateExecutionIntent({
  provider,
  model,
  executionPolicy,
  explicitExecutionMode,
  continuation,
  prompt
} = {}) {
  if (provider !== 'codex' || !isLunaModel(model)) return false;
  if (explicitExecutionMode || continuation) return false;
  if (!WRITE_MODES.has(executionPolicy?.mode)) return false;
  return isHighRiskExecutionPrompt(prompt);
}

function buildApprovedIntent(intent, policy, review = null) {
  if (!intent || !policy) return null;
  const conflicts = policyConflicts(intent, policy);
  const rejected = review?.decision === 'REJECT_SCOPE';
  const buildApproved = Boolean(policy.allowBuild) && !rejected;
  const dependencyApproved = Boolean(policy.allowDependencyChanges) && !rejected;
  const broadScopeApproved = policy.mode === 'BUILD' && !rejected;

  return Object.freeze({
    summary: intent.summary,
    expectedFiles: policy.allowWrite
      ? Math.min(intent.expectedFiles, Math.max(0, policy.maxFilesChanged))
      : 0,
    estimatedTools: Math.min(intent.estimatedTools, Math.max(0, policy.hardToolExecutions)),
    needsBuild: Boolean(intent.needsBuild && buildApproved),
    needsDependencyChange: Boolean(intent.needsDependencyChange && dependencyApproved),
    destructive: Boolean(intent.destructive && broadScopeApproved),
    broadRefactor: Boolean(intent.broadRefactor && broadScopeApproved),
    confidence: intent.confidence,
    approvedMode: policy.mode,
    policyConflicts: conflicts,
    reviewDecision: review?.decision || null,
    reviewReason: review?.reason || null
  });
}

module.exports = {
  WRITE_MODES,
  buildApprovedIntent,
  isHighRiskExecutionPrompt,
  normalizeExecutionIntent,
  policyConflicts,
  shouldCreateExecutionIntent
};
