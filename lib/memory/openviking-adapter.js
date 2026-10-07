const { MemoryProvider } = require('./provider');
const { MemoryScope, normalizeMemoryRecord, normalizeMemoryQuery } = require('./types');

function openVikingPathFor(recordOrQuery = {}) {
  const scope = recordOrQuery.scope || recordOrQuery.scopes?.[0];
  if (scope === MemoryScope.ROLE && recordOrQuery.roleId) {
    return `viking://roles/${encodeURIComponent(recordOrQuery.roleId)}/`;
  }
  if (scope === MemoryScope.PROJECT && recordOrQuery.projectId) {
    return `viking://projects/${encodeURIComponent(recordOrQuery.projectId)}/`;
  }
  if (scope === MemoryScope.SESSION && recordOrQuery.conversationId) {
    return `viking://sessions/${encodeURIComponent(recordOrQuery.conversationId)}/`;
  }
  return 'viking://users/me/';
}

// This adapter intentionally depends on a tiny injected transport owned by
// Crew Pocket, not on any OpenViking SDK shape. A future integration only has
// to implement { retain, recall, forget } behind this boundary.
class OpenVikingMemoryProvider extends MemoryProvider {
  constructor({ transport }) {
    super();
    if (!transport) throw new Error('OpenViking adapter requires a transport');
    this.transport = transport;
  }

  async retain(memory) {
    const record = normalizeMemoryRecord(memory);
    await this.transport.retain({
      path: openVikingPathFor(record),
      record
    });
    return record;
  }

  async recall(query) {
    const normalized = normalizeMemoryQuery(query);
    const paths = normalized.scopes.map(scope => openVikingPathFor({ ...normalized, scope }));
    const hits = await this.transport.recall({ paths, query: normalized });
    return Array.isArray(hits) ? hits : [];
  }

  async forget(id) {
    return Boolean(await this.transport.forget({ id: String(id || '') }));
  }
}

module.exports = { OpenVikingMemoryProvider, openVikingPathFor };
