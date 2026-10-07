const { MemoryProvider } = require('./provider');
const { MemoryScope, MemoryState } = require('./types');
const { LocalMemoryProvider } = require('./local-memory-provider');
const { OpenVikingMemoryProvider } = require('./openviking-adapter');
const { AgyMemoryReflectionEngine } = require('./agy-reflection-engine');
const { reflectTurn } = require('./reflection-service');

const defaultMemoryProvider = new LocalMemoryProvider();
const defaultMemoryReflectionEngine = new AgyMemoryReflectionEngine();

module.exports = {
  MemoryProvider,
  MemoryScope,
  MemoryState,
  LocalMemoryProvider,
  OpenVikingMemoryProvider,
  AgyMemoryReflectionEngine,
  defaultMemoryProvider,
  defaultMemoryReflectionEngine,
  reflectTurn
};
