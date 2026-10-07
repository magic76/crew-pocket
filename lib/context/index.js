const types = require('./types');
const estimator = require('./estimator');
const health = require('./health');

module.exports = {
  ...types,
  ...estimator,
  ...health,
  analyze: health.analyzeContext
};
