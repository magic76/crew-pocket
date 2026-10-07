const { MemoryProvider } = require('./provider');
const {
  MemoryScope,
  MemorySourceType,
  MemoryDerivationType,
  MemoryStatus
} = require('./types');
const { LocalMemoryProvider } = require('./local-memory-provider');
const { OpenVikingMemoryProvider } = require('./openviking-adapter');

const defaultMemoryProvider = new LocalMemoryProvider();

module.exports = {
  MemoryProvider,
  MemoryScope,
  MemorySourceType,
  MemoryDerivationType,
  MemoryStatus,
  LocalMemoryProvider,
  OpenVikingMemoryProvider,
  defaultMemoryProvider
};
