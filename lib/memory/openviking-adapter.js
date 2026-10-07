const { MemoryProvider } = require('./provider');
const {
  MemoryScope,
  MemoryStatus,
  normalizeMemoryRecord,
  normalizeMemoryQuery
} = require('./types');

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

function crewMemoryMetadata(record = {}) {
  return {
    provenance: record.provenance || null,
    confidence: record.confidence ?? null,
    status: record.status || MemoryStatus.ACTIVE,
    supersedes: Array.isArray(record.supersedes) ? record.supersedes : []
  };
}

function hasExtendedSemanticMetadata(record = {}) {
  return Boolean(
    record.provenance ||
    record.confidence !== null && record.confidence !== undefined ||
    record.status && record.status !== MemoryStatus.ACTIVE ||
    Array.isArray(record.supersedes) && record.supersedes.length
  );
}

function mergeCrewMemoryMetadata(record = {}, metadata = null) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return record;
  return {
    ...record,
    ...(metadata.provenance !== undefined ? { provenance: metadata.provenance } : {}),
    ...(metadata.confidence !== undefined ? { confidence: metadata.confidence } : {}),
    ...(metadata.status !== undefined ? { status: metadata.status } : {}),
    ...(metadata.supersedes !== undefined ? { supersedes: metadata.supersedes } : {})
  };
}

// This adapter intentionally depends on a tiny injected transport owned by
// Crew Pocket, not on any OpenViking SDK shape. The Crew semantic record is
// canonical. A transport that cannot preserve extended semantic metadata must
// provide a sidecar layer rather than silently dropping provenance/lifecycle.
class OpenVikingMemoryProvider extends MemoryProvider {
  constructor({ transport }) {
    super();
    if (!transport) throw new Error('OpenViking adapter requires a transport');
    this.transport = transport;
  }

  assertMetadataSupport(record) {
    if (!hasExtendedSemanticMetadata(record)) return;
    if (this.transport.capabilities?.crewMemoryMetadata === false) {
      throw new Error('OpenViking transport cannot preserve Crew memory metadata; configure a Crew Pocket metadata sidecar');
    }
  }

  async retain(memory) {
    const record = normalizeMemoryRecord(memory);
    this.assertMetadataSupport(record);
    await this.transport.retain({
      path: openVikingPathFor(record),
      record,
      metadata: crewMemoryMetadata(record)
    });
    return record;
  }

  async recall(query) {
    const normalized = normalizeMemoryQuery(query);
    const paths = normalized.scopes.map(scope => openVikingPathFor({ ...normalized, scope }));
    const hits = await this.transport.recall({ paths, query: normalized });
    if (!Array.isArray(hits)) return [];

    return hits.map(hit => {
      if (!hit || typeof hit !== 'object') return hit;
      if (hit.record && typeof hit.record === 'object') {
        return {
          ...hit,
          record: normalizeMemoryRecord(
            mergeCrewMemoryMetadata(hit.record, hit.metadata),
            hit.record.updatedAt || Date.now()
          )
        };
      }
      return hit;
    });
  }

  async forget(id) {
    return Boolean(await this.transport.forget({ id: String(id || '') }));
  }
}

module.exports = {
  OpenVikingMemoryProvider,
  crewMemoryMetadata,
  hasExtendedSemanticMetadata,
  mergeCrewMemoryMetadata,
  openVikingPathFor
};
