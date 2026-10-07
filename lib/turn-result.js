const EXECUTION_RESULT_MODES = new Set(['SURGICAL_EDIT', 'DEBUG', 'BUILD']);

function normalizeToolMetrics(toolMetrics = {}) {
  const changedFiles = Array.isArray(toolMetrics.changed_files)
    ? [...new Set(toolMetrics.changed_files.map(value => String(value || '').trim()).filter(Boolean))].slice(0, 80)
    : [];
  return {
    events: Math.max(0, Number(toolMetrics.events) || 0),
    unique_tools: Math.max(0, Number(toolMetrics.unique_tools) || 0),
    executions: Math.max(0, Number(toolMetrics.executions) || 0),
    polls: Math.max(0, Number(toolMetrics.polls) || 0),
    changed_files: changedFiles
  };
}

function hasStructuredExecutionActivity(mode, metrics) {
  if (EXECUTION_RESULT_MODES.has(mode)) return true;
  return metrics.executions > 0 || metrics.unique_tools > 0 || metrics.changed_files.length > 0;
}

function normalizeResultStatus({ error, status } = {}) {
  if (error) return 'failed';
  const value = String(status || '').toLowerCase();
  if (['failed', 'error', 'cancelled', 'canceled', 'interrupted'].includes(value)) return 'failed';
  return 'completed';
}

function buildTurnResult({
  requestId,
  executionPolicy,
  toolMetrics,
  elapsedMs,
  error,
  status
} = {}) {
  const mode = String(executionPolicy?.mode || '').toUpperCase() || null;
  const metrics = normalizeToolMetrics(toolMetrics);
  if (!hasStructuredExecutionActivity(mode, metrics)) return null;

  const durationMs = Number(elapsedMs);
  return {
    version: 1,
    kind: 'execution',
    status: normalizeResultStatus({ error, status }),
    request_id: requestId ? String(requestId) : null,
    execution_mode: mode,
    duration_ms: Number.isFinite(durationMs) && durationMs >= 0 ? Math.round(durationMs) : null,
    tool_count: metrics.unique_tools,
    executions: metrics.executions,
    polls: metrics.polls,
    changed_files: metrics.changed_files
  };
}

module.exports = {
  buildTurnResult,
  hasStructuredExecutionActivity,
  normalizeToolMetrics
};
