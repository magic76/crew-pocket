const antigravity = require('./antigravity');
const codex = require('./codex');
const { sessionManager } = require('../session');

const providers = new Map([
  [antigravity.id, antigravity],
  [codex.id, codex]
]);

const REQUIRED_METHODS = ['startTurn', 'getStatus', 'stop', 'prewarm'];
const CAPABILITY_METHODS = {
  models: ['listModels'],
  history: ['listConversations', 'getHistory'],
  rename: ['renameConversation'],
  delete: ['deleteConversation'],
  rewind: ['rewindConversation'],
  compact: ['compactConversation']
};

function busyTurnError(providerId, conversationId) {
  const error = new Error(`Conversation ${conversationId} already has an active ${providerId} turn`);
  error.statusCode = 409;
  error.code = 'CONVERSATION_BUSY';
  return error;
}

function guardProviderTurns(provider) {
  const locks = new Map();
  const rawStartTurn = provider.startTurn.bind(provider);
  const rawGetStatus = provider.getStatus.bind(provider);
  const rawStop = provider.stop.bind(provider);

  function rawIsBusy(conversationId) {
    if (!conversationId) return false;
    try { return Boolean(rawGetStatus(conversationId)?.isBusy); }
    catch (_) { return false; }
  }

  provider.startTurn = async function startGuardedTurn(args = {}) {
    const requestedId = args.conversationId ? String(args.conversationId) : '';
    const token = Symbol(`${provider.id}:${requestedId || 'new'}`);
    let lockedId = '';
    let released = false;
    let providerAbort = null;

    const release = () => {
      if (released) return;
      released = true;
      if (lockedId && locks.get(lockedId) === token) locks.delete(lockedId);
    };

    const claim = (conversationId) => {
      const nextId = conversationId ? String(conversationId) : '';
      if (!nextId) return true;
      const holder = locks.get(nextId);
      if (holder && holder !== token) return false;
      if (lockedId && lockedId !== nextId && locks.get(lockedId) === token) locks.delete(lockedId);
      locks.set(nextId, token);
      lockedId = nextId;
      return true;
    };

    if (requestedId) {
      if (locks.has(requestedId) || rawIsBusy(requestedId)) throw busyTurnError(provider.id, requestedId);
      claim(requestedId);
    }

    const originalOnEvent = typeof args.onEvent === 'function' ? args.onEvent : () => {};
    const originalOnAbort = typeof args.onAbort === 'function' ? args.onAbort : () => {};

    const guardedArgs = {
      ...args,
      onAbort(handler) {
        providerAbort = typeof handler === 'function' ? handler : null;
        originalOnAbort(() => {
          try {
            return providerAbort ? providerAbort() : undefined;
          } finally {
            release();
          }
        });
      },
      onEvent(event) {
        if (event?.type === 'session_started' && event.conversationId) {
          if (!claim(event.conversationId)) {
            try { if (providerAbort) providerAbort(); } catch (_) {}
            const error = busyTurnError(provider.id, event.conversationId);
            originalOnEvent({ type: 'error', message: error.message, code: error.code });
            release();
            return;
          }
        }

        originalOnEvent(event);

        if (event?.type === 'turn_completed') {
          release();
        } else if (event?.type === 'error') {
          // Some providers emit an error before their final completion/close
          // event. Only release once the provider itself no longer reports the
          // thread busy, otherwise a retry could overlap the failing turn.
          setTimeout(() => {
            if (!lockedId || !rawIsBusy(lockedId)) release();
          }, 0);
        }
      }
    };

    try {
      const result = await rawStartTurn(guardedArgs);
      if (result?.conversationId && !claim(result.conversationId)) {
        try { if (providerAbort) await providerAbort(); } catch (_) {}
        throw busyTurnError(provider.id, result.conversationId);
      }
      return result;
    } catch (err) {
      release();
      throw err;
    }
  };

  provider.getStatus = function getGuardedStatus(conversationId) {
    const raw = rawGetStatus(conversationId) || {};
    const id = conversationId ? String(conversationId) : '';
    return { ...raw, isBusy: Boolean(raw.isBusy || (id && locks.has(id))) };
  };

  provider.stop = async function stopGuardedTurn(conversationId = null) {
    const id = conversationId ? String(conversationId) : '';
    if (!id) {
      try { return await rawStop(); }
      finally { locks.clear(); }
    }

    if (provider.id === 'antigravity') {
      sessionManager.closeSession(id);
      locks.delete(id);
      return { stopped: true, conversationId: id };
    }

    if (provider.id === 'codex') {
      const active = provider.turns?.get(id);
      if (!active) {
        locks.delete(id);
        return { stopped: false, conversationId: id };
      }
      if (active.turnId && typeof provider.interrupt === 'function') {
        await provider.interrupt(id, active.turnId);
      }
      return { stopped: true, conversationId: id };
    }

    try { return await rawStop(id); }
    finally { locks.delete(id); }
  };

  provider.__turnLocks = locks;
  return provider;
}

for (const provider of providers.values()) {
  if (!provider.id || !provider.metadata) throw new Error('Provider id and metadata are required');
  for (const method of REQUIRED_METHODS) {
    if (typeof provider[method] !== 'function') throw new Error(`Provider ${provider.id} is missing ${method}()`);
  }
  for (const [capability, methods] of Object.entries(CAPABILITY_METHODS)) {
    if (!provider.metadata.capabilities?.[capability]) continue;
    for (const method of methods) {
      if (typeof provider[method] !== 'function') throw new Error(`Provider ${provider.id} declares ${capability} but is missing ${method}()`);
    }
  }
  guardProviderTurns(provider);
}

function getAvailableProviders() {
  const all = [...providers.values()];
  const available = all.filter(p => typeof p.isAvailable !== 'function' || p.isAvailable());
  return available.length > 0 ? available : all;
}

function normalizeProviderId(providerId) {
  const available = getAvailableProviders();
  if (providerId && available.some(p => p.id === providerId)) return providerId;
  return available[0]?.id || 'antigravity';
}

function getProvider(providerId) {
  return providers.get(normalizeProviderId(providerId)) || providers.get('antigravity');
}

function listProviders() {
  return getAvailableProviders();
}

function listProviderMetadata() {
  return listProviders().map(provider => provider.metadata);
}

module.exports = { getProvider, normalizeProviderId, listProviders, listProviderMetadata };
