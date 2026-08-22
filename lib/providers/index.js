const antigravity = require('./antigravity');
const codex = require('./codex');

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
}

function normalizeProviderId(providerId) {
  return providers.has(providerId) ? providerId : 'antigravity';
}

function getProvider(providerId) {
  return providers.get(normalizeProviderId(providerId));
}

function listProviders() {
  return [...providers.values()];
}

function listProviderMetadata() {
  return listProviders().map(provider => provider.metadata);
}

module.exports = { getProvider, normalizeProviderId, listProviders, listProviderMetadata };
