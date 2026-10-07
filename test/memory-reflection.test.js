const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { LocalMemoryProvider } = require('../lib/memory/local-memory-provider');
const { MemoryScope, MemoryState } = require('../lib/memory/types');
const {
  reflectTurn,
  shouldReflectTurn,
  memorySimilarity
} = require('../lib/memory/reflection-service');
const {
  buildReflectionPrompt,
  parseReflectionOutput,
  sanitizeEvidenceText
} = require('../lib/memory/agy-reflection-engine');
const { buildAgentContext } = require('../lib/context-builder');

class FakeReflectionEngine {
  constructor(outputs = []) {
    this.outputs = outputs;
    this.calls = [];
  }

  async extract(input) {
    this.calls.push(input);
    return this.outputs.length ? this.outputs.shift() : [];
  }
}

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-pocket-reflection-'));
  const memory = new LocalMemoryProvider({
    storagePath: path.join(tempDir, 'records.json')
  });

  const helperRole = {
    id: 'role-crew-helper',
    name: 'Crew Helper Developer',
    projectId: 'project-crew-helper',
    description: '',
    systemContext: '',
    skills: []
  };
  const helperProject = {
    id: 'project-crew-helper',
    name: 'Crew Helper',
    workspace: '/tmp/crew-helper',
    systemContext: ''
  };

  try {
    // Short routine chat does not trigger automatic reflection.
    assert.equal(shouldReflectTurn({
      prompt: 'hi',
      response: 'hello there, how can I help you today?',
      executionMode: 'CHAT',
      status: 'completed'
    }), false);

    // Stable user rules can trigger reflection even in CHAT mode.
    assert.equal(shouldReflectTurn({
      prompt: 'Remember: always require terminal evidence before marking Crew Helper complete.',
      response: 'Understood. Future completion checks will require terminal evidence.',
      executionMode: 'CHAT',
      status: 'completed'
    }), true);

    // First medium-confidence observation is only a CANDIDATE.
    const firstEngine = new FakeReflectionEngine([[
      {
        text: 'Crew Helper completion requires terminal evidence.',
        scope: 'PROJECT',
        kind: 'constraint',
        importance: 0.86,
        confidence: 0.84,
        tags: ['completion', 'terminal']
      }
    ]]);
    const first = await reflectTurn({
      memoryProvider: memory,
      reflectionEngine: firstEngine,
      roleId: helperRole.id,
      roleName: helperRole.name,
      projectId: helperProject.id,
      projectName: helperProject.name,
      conversationId: 'conv-1',
      prompt: 'Fix completion verification and keep terminal evidence as the rule.',
      response: 'Updated completion verification to require terminal evidence before success.',
      executionMode: 'SURGICAL_EDIT',
      changedFiles: ['server.js']
    });
    assert.equal(first.retained.length, 1);
    assert.equal(first.retained[0].state, MemoryState.CANDIDATE);
    assert.equal(first.retained[0].confirmations, 1);

    const normalRecallBeforePromotion = await memory.recall({
      text: 'terminal evidence',
      scopes: [MemoryScope.PROJECT],
      roleId: helperRole.id,
      projectId: helperProject.id
    });
    assert.equal(normalRecallBeforePromotion.length, 0);

    const candidateRecall = await memory.recall({
      text: 'terminal evidence',
      scopes: [MemoryScope.PROJECT],
      states: [MemoryState.CANDIDATE],
      roleId: helperRole.id,
      projectId: helperProject.id
    });
    assert.equal(candidateRecall.length, 1);

    const contextBeforePromotion = await buildAgentContext({
      roleId: helperRole.id,
      projectId: helperProject.id,
      currentPrompt: 'completion terminal evidence',
      memoryProvider: memory,
      roleResolver: async () => helperRole,
      projectResolver: async () => helperProject
    });
    assert.equal(contextBeforePromotion.memories.length, 0);

    // A compatible second observation promotes the same record instead of
    // creating another memory.
    const secondEngine = new FakeReflectionEngine([[
      {
        text: 'Crew Helper completion must include terminal evidence.',
        scope: 'PROJECT',
        kind: 'constraint',
        importance: 0.88,
        confidence: 0.86,
        tags: ['terminal', 'verification']
      }
    ]]);
    const second = await reflectTurn({
      memoryProvider: memory,
      reflectionEngine: secondEngine,
      roleId: helperRole.id,
      roleName: helperRole.name,
      projectId: helperProject.id,
      projectName: helperProject.name,
      conversationId: 'conv-2',
      prompt: 'Keep the terminal evidence requirement when completing helper work.',
      response: 'The completion path still requires terminal evidence.',
      executionMode: 'INSPECT'
    });
    assert.equal(second.retained.length, 1);
    assert.equal(second.retained[0].id, first.retained[0].id);
    assert.equal(second.retained[0].state, MemoryState.ACTIVE);
    assert.equal(second.retained[0].confirmations, 2);

    const normalRecallAfterPromotion = await memory.recall({
      text: 'terminal evidence',
      scopes: [MemoryScope.PROJECT],
      roleId: helperRole.id,
      projectId: helperProject.id
    });
    assert.equal(normalRecallAfterPromotion.length, 1);

    const contextAfterPromotion = await buildAgentContext({
      roleId: helperRole.id,
      projectId: helperProject.id,
      currentPrompt: 'completion terminal evidence',
      memoryProvider: memory,
      roleResolver: async () => helperRole,
      projectResolver: async () => helperProject
    });
    assert.equal(contextAfterPromotion.memories.length, 1);

    // High-confidence durable memories can activate immediately.
    const highConfidenceEngine = new FakeReflectionEngine([[
      {
        text: 'Crew Helper uses Android Runtime as the source of truth for device execution.',
        scope: 'ROLE',
        kind: 'architecture',
        importance: 0.9,
        confidence: 0.96,
        tags: ['android', 'runtime']
      }
    ]]);
    const high = await reflectTurn({
      memoryProvider: memory,
      reflectionEngine: highConfidenceEngine,
      roleId: helperRole.id,
      roleName: helperRole.name,
      projectId: helperProject.id,
      projectName: helperProject.name,
      conversationId: 'conv-3',
      prompt: 'Document the Android Runtime source-of-truth rule.',
      response: 'The architecture now treats Android Runtime as the source of truth for device execution.',
      executionMode: 'INSPECT'
    });
    assert.equal(high.retained[0].state, MemoryState.ACTIVE);
    assert.equal(high.retained[0].confirmations, 1);

    // Role scope remains isolated after the lifecycle changes.
    const teacherRecall = await memory.recall({
      text: 'Android Runtime source of truth',
      scopes: [MemoryScope.ROLE],
      roleId: 'role-crew-teacher',
      projectId: 'project-crew-teacher'
    });
    assert.equal(teacherRecall.length, 0);

    // Sensitive model output is discarded instead of being persisted.
    const secretEngine = new FakeReflectionEngine([[
      {
        text: 'Use api_key=sk-abcdefghijklmnop123456 for deployment.',
        scope: 'PROJECT',
        kind: 'workflow',
        importance: 1,
        confidence: 0.99
      }
    ]]);
    const secret = await reflectTurn({
      memoryProvider: memory,
      reflectionEngine: secretEngine,
      roleId: helperRole.id,
      projectId: helperProject.id,
      prompt: 'Update deployment.',
      response: 'Deployment configuration updated successfully.',
      executionMode: 'BUILD',
      force: true
    });
    assert.equal(secret.accepted, 0);
    assert.equal(secret.retained.length, 0);

    // Reflection evidence is redacted before reaching the one-shot model.
    assert.equal(
      sanitizeEvidenceText('api_key=sk-abcdefghijklmnop123456'),
      'api_key=[REDACTED]'
    );
    const prompt = buildReflectionPrompt({
      roleId: helperRole.id,
      projectId: helperProject.id,
      prompt: 'Authorization=super-secret-token',
      response: 'done'
    });
    assert.equal(prompt.includes('super-secret-token'), false);

    // Parser accepts both direct JSON and AGY stream-json output.
    const direct = parseReflectionOutput('{"memories":[{"text":"A","scope":"ROLE"}]}');
    assert.equal(direct.length, 1);
    const streamed = parseReflectionOutput([
      JSON.stringify({ step_update: { text_delta: '{"memories":[' } }),
      JSON.stringify({ step_update: { text_delta: '{"text":"B","scope":"ROLE"}]}' } })
    ].join('\n'));
    assert.equal(streamed.length, 1);
    assert.equal(streamed[0].text, 'B');

    assert.ok(memorySimilarity(
      'Crew Helper completion requires terminal evidence.',
      'Crew Helper completion must include terminal evidence.'
    ) >= 0.60);

    console.log('memory-reflection tests: ok');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
