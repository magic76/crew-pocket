// Reliable, per-Role queue delivery. The caller owns the durable queue and
// acknowledges removal only after the provider has accepted a turn.
(function (root) {
  'use strict';

  const BUSY_RETRY_DELAYS_MS = Object.freeze([300, 600, 1100, 1900, 3200, 5000]);

  function createQueuedMessageDelivery({ getScope, list, hydrate, isBusy, deliver, onState = () => {}, schedule = setTimeout, cancel = clearTimeout }) {
    const active = new Set();
    const timers = new Map();
    const failed = new Set();
    const attempts = new Map();

    function cancelRetry(roleId) {
      if (timers.has(roleId)) {
        cancel(timers.get(roleId));
        timers.delete(roleId);
      }
    }

    function matches(message, scope) {
      return message?.roleId === scope.roleId &&
        message.providerId === scope.providerId &&
        (message.conversationId || null) === (scope.conversationId || null);
    }

    function kick(roleId = getScope().roleId) {
      if (!roleId || active.has(roleId) || timers.has(roleId)) return;
      active.add(roleId);
      let drainNext = false;
      Promise.resolve().then(async () => {
        await hydrate(roleId);
        const scope = getScope();
        if (scope.roleId !== roleId || isBusy(roleId)) return;
        const message = list(roleId)[0];
        // FIFO, and never deliver a message into a different conversation.
        if (!message || !matches(message, scope) || failed.has(message.id)) return;
        onState(message, 'sending');
        let result;
        try { result = await deliver(message); }
        catch (error) { result = { accepted: false, retryable: false, error: String(error?.message || error) }; }
        if (result?.accepted) {
          attempts.delete(message.id);
          failed.delete(message.id);
          onState(message, 'accepted');
          drainNext = true;
          return;
        }
        const count = (attempts.get(message.id) || 0) + 1;
        attempts.set(message.id, count);
        if (result?.retryable && count <= BUSY_RETRY_DELAYS_MS.length) {
          onState(message, 'waiting');
          const delay = BUSY_RETRY_DELAYS_MS[count - 1];
          cancelRetry(roleId);
          timers.set(roleId, schedule(() => {
            timers.delete(roleId);
            kick(roleId);
          }, delay));
        } else {
          failed.add(message.id);
          onState(message, 'failed', result?.error || '發送未被接受');
        }
      }).catch(error => {
        console.warn('[Role Queue] Delivery failed:', error?.message || error);
      }).finally(() => {
        active.delete(roleId);
        if (drainNext) kick(roleId);
      });
    }

    function retry(roleId, messageId) {
      if (!roleId || !messageId) return;
      failed.delete(messageId);
      attempts.delete(messageId);
      cancelRetry(roleId);
      kick(roleId);
    }

    function forget(roleId, messageId) {
      failed.delete(messageId);
      attempts.delete(messageId);
      cancelRetry(roleId);
    }

    return { kick, retry, forget, isFailed: id => failed.has(id), isSending: roleId => active.has(roleId) };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createQueuedMessageDelivery, BUSY_RETRY_DELAYS_MS };
  }
  root.createQueuedMessageDelivery = createQueuedMessageDelivery;
})(typeof window !== 'undefined' ? window : globalThis);
