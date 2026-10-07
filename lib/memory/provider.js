// MemoryProvider is the persistence boundary only. Crew Pocket's semantic
// model (provenance, derivation, lifecycle, admission) lives above any
// third-party backend. retain() means "commit this canonical MemoryRecord";
// future propose()/verify() admission stages should sit above this interface.
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

  async forgetRole(_roleId) {
    throw new Error('MemoryProvider.forgetRole() is not implemented');
  }

  async reflect(_query) {
    return null;
  }
}

module.exports = { MemoryProvider };
