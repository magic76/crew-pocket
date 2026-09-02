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
