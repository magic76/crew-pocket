// Antigravity Web UI - Device Adapter Types & Factory Functions

function createActionResult(action, method, success, reason = '', extra = {}) {
  return {
    success: Boolean(success),
    action: String(action),
    method: method || 'accessibility',
    reason: String(reason || (success ? '執行成功' : '執行失敗')),
    screenChanged: extra.screenChanged !== undefined ? Boolean(extra.screenChanged) : undefined,
    retryable: extra.retryable !== undefined ? Boolean(extra.retryable) : !success,
    data: extra.data || undefined
  };
}

module.exports = {
  createActionResult
};
