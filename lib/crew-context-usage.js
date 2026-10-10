'use strict';

// Read-only and deliberately bounded. Do not return conversation history, memory,
// project details, workspace, titles or provider tool traces to the roster.
function projectContextUsage(health) {
  const used = Number(health?.totalUsage?.value);
  const capacity = Number(health?.budget?.availableInputTokens);
  const ratio = Number(health?.usageRatio);
  // Null is not zero. In particular Number(null) === 0 must not mean "0%".
  if (!health || health.usageRatio == null || health.budget?.availableInputTokens == null ||
      health.totalUsage?.value == null || !Number.isFinite(used) || used < 0 ||
      !Number.isFinite(capacity) || capacity <= 0 || !Number.isFinite(ratio) || ratio < 0 ||
      (used === 0 && health.totalUsage?.exact !== true)) return null;
  const exact = health.totalUsage.exact === true;
  return {
    usedTokens: Math.round(used), capacityTokens: Math.round(capacity),
    ratio: Math.round(ratio * 10000) / 10000,
    percent: Math.round(ratio * 100),
    exact, source: exact ? 'provider' : 'estimate',
    status: ratio >= .9 ? 'critical' : ratio >= .7 ? 'warning' : 'healthy'
  };
}

function createCrewContextUsage({
  listRoleRuntimes, getConversationSettings, getContextHealth,
  now = () => Date.now(), ttlMs = 30000, concurrency = 3
}) {
  const cache = new Map(), inFlight = new Map();
  const allowedConcurrency = Math.max(1, Math.min(4, Math.floor(concurrency)));
  async function readOne(runtime) {
    if (!runtime?.roleId || !runtime.providerId || !runtime.conversationId) return null;
    const {roleId, providerId, conversationId} = runtime;
    const key = JSON.stringify([roleId, providerId, conversationId]);
    const current = now(), hit = cache.get(key);
    if (hit && current - hit.at < ttlMs) return hit.value;
    if (inFlight.has(key)) return inFlight.get(key);
    const task = (async () => {
      let value = null;
      try {
        const settings = await getConversationSettings(providerId, conversationId);
        // A Role must never receive the summary of another Role's conversation.
        if (settings?.roleId === roleId) {
          const result = await getContextHealth(providerId, conversationId);
          value = projectContextUsage(result?.contextHealth || result);
        }
      } catch (_) { /* independent failure: never break the rest of the roster */ }
      cache.set(key, {at: now(), value});
      return value;
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, task);
    return task;
  }
  return async function readCrewContextUsage() {
    const runtimes = await listRoleRuntimes();
    const unique = new Map();
    for (const runtime of runtimes || []) {
      if (runtime?.roleId && !unique.has(runtime.roleId)) unique.set(runtime.roleId, runtime);
    }
    const items = [...unique.values()];
    // Prune obsolete entries and protect long-running installations from cache growth.
    const valid = new Set(items.filter(x => x.providerId && x.conversationId)
      .map(x => JSON.stringify([x.roleId, x.providerId, x.conversationId])));
    for (const key of cache.keys()) if (!valid.has(key)) cache.delete(key);
    const result = {};
    let cursor = 0;
    await Promise.all(Array.from({length: Math.min(items.length, allowedConcurrency)}, async () => {
      while (cursor < items.length) {
        const runtime = items[cursor++];
        result[runtime.roleId] = await readOne(runtime);
      }
    }));
    return {generatedAt:now(), roles:result};
  };
}
module.exports = {projectContextUsage, createCrewContextUsage};
