const types = require('./types');
const estimator = require('./estimator');
const health = require('./health');
const compaction = require('./compaction');
const autoCompact = require('./auto-compact');

module.exports = {
  ...types,
  ...estimator,
  ...health,
  ...compaction,
  ...autoCompact,
  analyze: health.analyzeContext
};
