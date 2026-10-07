const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  MemoryScope,
  MemorySourceType,
  MemoryDerivationType,
  MemoryStatus,
  normalizeMemoryRecord
} = require('../lib/memory/types');
const { LocalMemoryProvider } = require('../lib/memory/local-memory-provider');
const {
  OpenVikingMemoryProvider
} = require('../lib/memory/openviking-adapter');
const { formatMemoryEvidence } = require('../lib/context-builder');

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-pocket-provenance-'));
  const storagePath = path.join(tempDir, 'records.json');

  try {
    // 1. Legacy memory without provenance/lifecycle still loads safely.
    await fs.writeFile(storagePath, JSON.stringify({
      version: 1,
      records: [{
        id: 'old-memory',
        text: 'Legacy memory still works.',
        scope: 'ROLE',
        roleId: 'role-helper',
        kind: 'experience',
        tags: [],
        importance: 0.5,
        source: 'manual',
        createdAt: 100,
        updatedAt: 100
      }]
    }, null, 2) + '\n', 'utf8');

    const legacyProvider = new LocalMemoryProvider({ storagePath });
    const legacy = await legacyProvider.readAll();
    assert.equal(legacy.length, 1);
    assert.equal(legacy[0].id, 'old-memory');
    assert.equal(legacy[0].provenance, null);
    assert.equal(legacy[0].confidence, null);
    assert.equal(legacy[0].status, MemoryStatus.ACTIVE);
    assert.deepEqual(legacy[0].supersedes, []);
    assert.equal(legacy[0].source, 'manual');

    // Acceptance-style content alias is accepted but canonicalized to text.
    const aliasRecord = normalizeMemoryRecord({
      id: 'memory-alias',
      content: 'Crew Helper uses a hybrid action architecture.',
      scope: MemoryScope.ROLE,
      roleId: 'crew-helper-developer'
    }, 1000);
    assert.equal(aliasRecord.text, 'Crew Helper uses a hybrid action architecture.');

    const provider = new LocalMemoryProvider({
      storagePath: path.join(tempDir, 'round-trip.json')
    });

    const provenance = {
      sources: [
        {
          type: MemorySourceType.GIT,
          id: 'abc123',
          uri: 'https://example.invalid/commit/abc123',
          timestamp: 123456789
        },
        {
          type: MemorySourceType.MESSAGE,
          id: 'msg-123'
        }
      ],
      derivedFrom: ['memory-accessibility', 'memory-deeplink'],
      derivation: MemoryDerivationType.MODEL_INFERRED
    };

    // 2-7. Full provenance/lifecycle round trip preserves all semantic metadata.
    const created = await provider.retain({
      id: 'memory-hybrid',
      text: 'Crew Helper uses a hybrid action architecture.',
      scope: MemoryScope.ROLE,
      roleId: 'crew-helper-developer',
      provenance,
      confidence: 0.86,
      status: MemoryStatus.ACTIVE,
      supersedes: ['memory-conversation-centric'],
      importance: 0.9
    });

    assert.deepEqual(created.provenance, provenance);
    assert.deepEqual(created.provenance.sources, provenance.sources);
    assert.deepEqual(created.provenance.derivedFrom, provenance.derivedFrom);
    assert.equal(created.provenance.derivation, MemoryDerivationType.MODEL_INFERRED);
    assert.equal(created.confidence, 0.86);
    assert.equal(created.status, MemoryStatus.ACTIVE);
    assert.deepEqual(created.supersedes, ['memory-conversation-centric']);

    const persisted = JSON.parse(await fs.readFile(provider.storagePath, 'utf8'));
    const rawCreated = persisted.records.find(record => record.id === 'memory-hybrid');
    assert.deepEqual(rawCreated.provenance, provenance);
    assert.equal(rawCreated.confidence, 0.86);
    assert.equal(rawCreated.status, MemoryStatus.ACTIVE);
    assert.deepEqual(rawCreated.supersedes, ['memory-conversation-centric']);

    const loaded = await provider.readAll();
    const loadedCreated = loaded.find(record => record.id === 'memory-hybrid');
    assert.deepEqual(loadedCreated.provenance, provenance);
    assert.equal(loadedCreated.confidence, 0.86);
    assert.equal(loadedCreated.status, MemoryStatus.ACTIVE);
    assert.deepEqual(loadedCreated.supersedes, ['memory-conversation-centric']);

    // Explicit supersede preserves the old claim, but removes it from default recall.
    await provider.retain({
      id: 'memory-old-architecture',
      text: 'Crew Pocket uses conversation-centric memory.',
      scope: MemoryScope.ROLE,
      roleId: 'crew-helper-developer',
      provenance: {
        sources: [{ type: MemorySourceType.CONVERSATION, id: 'conv-old' }],
        derivation: MemoryDerivationType.USER_EXPLICIT
      },
      confidence: 0.95
    });

    await provider.retain({
      id: 'memory-role-centric',
      text: 'Crew Pocket uses role-centric memory.',
      scope: MemoryScope.ROLE,
      roleId: 'crew-helper-developer',
      provenance: {
        sources: [{ type: MemorySourceType.MESSAGE, id: 'msg-role-centric' }],
        derivation: MemoryDerivationType.USER_EXPLICIT
      },
      confidence: 0.99,
      supersedes: ['memory-old-architecture']
    });

    const allAfterSupersede = await provider.readAll();
    const superseded = allAfterSupersede.find(record => record.id === 'memory-old-architecture');
    const replacement = allAfterSupersede.find(record => record.id === 'memory-role-centric');
    assert.equal(superseded.status, MemoryStatus.SUPERSEDED);
    assert.deepEqual(replacement.supersedes, ['memory-old-architecture']);

    const activeRecall = await provider.recall({
      text: 'memory',
      scopes: [MemoryScope.ROLE],
      roleId: 'crew-helper-developer',
      limit: 20
    });
    assert.equal(activeRecall.some(hit => hit.record.id === 'memory-old-architecture'), false);
    assert.equal(activeRecall.some(hit => hit.record.id === 'memory-role-centric'), true);

    const historicalRecall = await provider.recall({
      text: 'conversation-centric',
      scopes: [MemoryScope.ROLE],
      statuses: [MemoryStatus.SUPERSEDED],
      roleId: 'crew-helper-developer'
    });
    assert.equal(historicalRecall.length, 1);
    assert.equal(historicalRecall[0].record.id, 'memory-old-architecture');

    // Read-path formatting exposes why the claim is believed without expanding a graph.
    const formatted = formatMemoryEvidence(loadedCreated);
    assert.match(formatted, /MODEL_INFERRED/);
    assert.match(formatted, /confidence=0\.86/);
    assert.match(formatted, /git:abc123/);
    assert.match(formatted, /derivedFrom=memory-accessibility,memory-deeplink/);

    // 8. OpenViking adapter carries canonical Crew metadata and can reconstruct
    // it from a sidecar envelope even if backend-native records are stripped.
    let retainedPayload = null;
    const transport = {
      capabilities: { crewMemoryMetadata: true },
      async retain(payload) {
        retainedPayload = payload;
      },
      async recall() {
        return [{
          score: 1,
          record: {
            id: retainedPayload.record.id,
            text: retainedPayload.record.text,
            scope: retainedPayload.record.scope,
            roleId: retainedPayload.record.roleId,
            projectId: retainedPayload.record.projectId,
            conversationId: retainedPayload.record.conversationId,
            kind: retainedPayload.record.kind,
            tags: retainedPayload.record.tags,
            importance: retainedPayload.record.importance,
            source: retainedPayload.record.source,
            createdAt: retainedPayload.record.createdAt,
            updatedAt: retainedPayload.record.updatedAt
          },
          metadata: retainedPayload.metadata
        }];
      },
      async forget() {
        return true;
      }
    };
    const openViking = new OpenVikingMemoryProvider({ transport });
    const ovRecord = await openViking.retain({
      id: 'memory-openviking',
      text: 'Role Memory Kernel exists.',
      scope: MemoryScope.ROLE,
      roleId: 'role-helper',
      provenance: {
        sources: [{ type: MemorySourceType.GIT, id: 'commit-xyz' }],
        derivation: MemoryDerivationType.TOOL_OBSERVED
      },
      confidence: 0.97,
      status: MemoryStatus.DISPUTED,
      supersedes: ['memory-older-kernel']
    });

    assert.deepEqual(retainedPayload.metadata.provenance, ovRecord.provenance);
    assert.equal(retainedPayload.metadata.confidence, 0.97);
    assert.equal(retainedPayload.metadata.status, MemoryStatus.DISPUTED);
    assert.deepEqual(retainedPayload.metadata.supersedes, ['memory-older-kernel']);

    const ovHits = await openViking.recall({
      text: 'Role Memory Kernel',
      scopes: [MemoryScope.ROLE],
      statuses: [MemoryStatus.DISPUTED],
      roleId: 'role-helper'
    });
    assert.equal(ovHits.length, 1);
    assert.deepEqual(ovHits[0].record.provenance, ovRecord.provenance);
    assert.equal(ovHits[0].record.confidence, 0.97);
    assert.equal(ovHits[0].record.status, MemoryStatus.DISPUTED);
    assert.deepEqual(ovHits[0].record.supersedes, ['memory-older-kernel']);

    // 9. A backend that explicitly cannot preserve semantic metadata fails
    // loudly instead of silently corrupting Crew Pocket's canonical record.
    const lossyOpenViking = new OpenVikingMemoryProvider({
      transport: {
        capabilities: { crewMemoryMetadata: false },
        async retain() {},
        async recall() { return []; },
        async forget() { return true; }
      }
    });
    await assert.rejects(
      () => lossyOpenViking.retain({
        id: 'memory-lossy',
        text: 'This claim has evidence.',
        scope: MemoryScope.ROLE,
        roleId: 'role-helper',
        provenance: {
          sources: [{ type: MemorySourceType.TOOL, id: 'tool-1' }],
          derivation: MemoryDerivationType.TOOL_OBSERVED
        },
        confidence: 0.9
      }),
      /metadata sidecar/
    );

    // Invalid provider-specific source types are rejected at the Crew domain boundary.
    assert.throws(
      () => normalizeMemoryRecord({
        text: 'Bad provider-specific source.',
        scope: MemoryScope.ROLE,
        roleId: 'role-helper',
        provenance: {
          sources: [{ type: 'openviking-node', id: 'x' }],
          derivation: MemoryDerivationType.TOOL_OBSERVED
        }
      }),
      /Invalid memory source type/
    );

    console.log('memory-provenance tests: ok');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
