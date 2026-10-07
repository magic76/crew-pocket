class MemoryProvider {
  async retain(_memory) {
    throw new Error('MemoryProvider.retain() is not implemented');
  }

  async recall(_query) {
    throw new Error('MemoryProvider.recall() is not implemented');
  }

  async forget(_id) {
    throw new Error('MemoryProvider.forget() is not implemented');
  }

  async reflect(_query) {
    return null;
  }
}

module.exports = { MemoryProvider };
