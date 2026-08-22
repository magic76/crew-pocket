const antigravity = require('./antigravity');
const codex = require('./codex');

const providers = new Map([
  [antigravity.id, antigravity],
  [codex.id, codex]
]);

function normalizeProviderId(providerId) {
  return providers.has(providerId) ? providerId : 'antigravity';
}

function getProvider(providerId) {
  return providers.get(normalizeProviderId(providerId));
}

module.exports = { getProvider, normalizeProviderId };
