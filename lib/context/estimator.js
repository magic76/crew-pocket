class ContextEstimator {
  estimateText(_text) {
    throw new Error('ContextEstimator.estimateText() is not implemented');
  }
}

class HeuristicContextEstimator extends ContextEstimator {
  constructor({ charsPerToken = 4 } = {}) {
    super();
    const ratio = Number(charsPerToken);
    if (!Number.isFinite(ratio) || ratio <= 0) throw new Error('charsPerToken must be positive');
    this.charsPerToken = ratio;
    this.kind = 'heuristic';
    this.exact = false;
  }

  estimateText(text) {
    const value = String(text || '');
    if (!value) return 0;
    return Math.max(1, Math.ceil(value.length / this.charsPerToken));
  }
}

const defaultContextEstimator = new HeuristicContextEstimator();

function contributionFromText({
  id,
  type,
  text,
  label,
  priority,
  compactable,
  pinned,
  sourceRef,
  estimator = defaultContextEstimator
} = {}) {
  return {
    id,
    type,
    ...(label ? { label } : {}),
    estimatedTokens: estimator.estimateText(text),
    ...(priority ? { priority } : {}),
    ...(compactable !== undefined ? { compactable } : {}),
    ...(pinned !== undefined ? { pinned } : {}),
    ...(sourceRef ? { sourceRef } : {})
  };
}

module.exports = {
  ContextEstimator,
  HeuristicContextEstimator,
  defaultContextEstimator,
  contributionFromText
};
