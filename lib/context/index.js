const types = require('./types');
const estimator = require('./estimator');
const health = require('./health');
const compaction = require('./compaction');

module.exports = {
  ...types,
  ...estimator,
  ...health,
  ...compaction,
  analyze: health.analyzeContext
};
