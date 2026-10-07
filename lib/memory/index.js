const { MemoryProvider } = require('./provider');
const { MemoryScope } = require('./types');
const { LocalMemoryProvider } = require('./local-memory-provider');
const { OpenVikingMemoryProvider } = require('./openviking-adapter');

const defaultMemoryProvider = new LocalMemoryProvider();

module.exports = {
  MemoryProvider,
  MemoryScope,
  LocalMemoryProvider,
  OpenVikingMemoryProvider,
  defaultMemoryProvider
};
