const PROVIDER_DEFAULT_MODELS = Object.freeze({
  antigravity: 'gemini-3.7-flash',
  codex: 'gpt-5.6-terra'
});

function isLunaModel(model) {
  return /^gpt-[0-9]+(?:\.[0-9]+)?-luna$/i.test(String(model || '').trim());
}

function getDefaultModel(provider) {
  return PROVIDER_DEFAULT_MODELS[provider] || null;
}

module.exports = {
  PROVIDER_DEFAULT_MODELS,
  getDefaultModel,
  isLunaModel
};
