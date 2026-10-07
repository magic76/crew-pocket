const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const context = require('../lib/context');
const {
  ContextSourceType,
  ContextPriority,
  ContextHealthStatus,
  ContextWarningCode,
  HeuristicContextEstimator
} = context;
const { LocalMemoryProvider } = require('../lib/memory/local-memory-provider');
const { MemoryScope } = require('../lib/memory/types');
const { buildAgentContext } = require('../lib/context-builder');

async function run() {
  const estimator = new HeuristicContextEstimator({ charsPerToken: 4 });
  assert.equal(estimator.estimateText('12345'), 2);
  assert.equal(estimator.exact, false);

  const grouped = context.groupContextContributions([
    { id: 'r1', type: 'role', estimatedTokens: 100 },
    { id: 'r2', type: 'role', estimatedTokens: 50 },
    { id: 't1', type: 'tool', estimatedTokens: 300 }
  ]);
  assert.equal(grouped.role.estimatedTokens, 150);
  assert.equal(grouped.tool.estimatedTokens, 300);

  const healthy = context.analyze({
    budget: { maxTokens: 100000 },
    totalUsage: { value: 50000, exact: true, source: 'provider' },
    contributions: [{ id: 'conversation', type: 'conversation', estimatedTokens: 48000 }]
  });
  assert.equal(healthy.status, ContextHealthStatus.HEALTHY);
  assert.equal(healthy.totalUsage.value, 50000);
  assert.equal(healthy.totalUsage.exact, true);
  assert.equal(healthy.totalUsage.source, 'provider');
  assert.equal(healthy.breakdownEstimate.exact, false);
  assert.equal(healthy.unattributedTokens, 2000);

  const warning = context.analyze({
    budget: { maxTokens: 100000 },
    totalUsage: { value: 80000, exact: true, source: 'provider' },
    contributions: [{ id: 'conversation', type: 'conversation', estimatedTokens: 80000 }]
  });
  assert.equal(warning.status, ContextHealthStatus.WARNING);
  assert.ok(warning.warnings.some(item => item.code === ContextWarningCode.NEAR_CONTEXT_LIMIT));

  const critical = context.analyze({
    budget: { maxTokens: 100000 },
    totalUsage: { value: 95000, exact: true, source: 'provider' },
    contributions: [{ id: 'conversation', type: 'conversation', estimatedTokens: 95000 }]
  });
  assert.equal(critical.status, ContextHealthStatus.CRITICAL);

  const unknown = context.analyze({
    totalUsage: { value: 12000, exact: false, source: 'heuristic' },
    contributions: [{ id: 'conversation', type: 'conversation', estimatedTokens: 12000 }]
  });
  assert.equal(unknown.status, ContextHealthStatus.UNKNOWN);
  assert.equal(Object.prototype.hasOwnProperty.call(unknown, 'usageRatio'), false);
  assert.equal(unknown.totalUsage.exact, false);
  assert.ok(unknown.warnings.some(item => item.code === ContextWarningCode.UNKNOWN_MODEL_BUDGET));

  const pinned = context.analyze({
    contributions: [{
      id: 'role-core',
      type: ContextSourceType.ROLE,
      estimatedTokens: 1200,
      priority: ContextPriority.REQUIRED,
      compactable: false,
      pinned: true
    }]
  });
  assert.equal(pinned.contributions[0].pinned, true);
  assert.equal(pinned.contributions[0].compactable, false);

  const largest = context.analyze({
    contributions: [
      { id: 'role', type: 'role', estimatedTokens: 30000, pinned: true, compactable: false },
      { id: 'conversation', type: 'conversation', estimatedTokens: 22000, compactable: true },
      { id: 'tools', type: 'tool', estimatedTokens: 10000, compactable: true }
    ]
  });
  assert.equal(largest.largestContribution.id, 'role');
  assert.equal(largest.largestCompactableContribution.id, 'conversation');

  const memoryAndLow = context.analyze({
    budget: { maxTokens: 100000 },
    totalUsage: { value: 40000, exact: true, source: 'provider' },
    contributions: [
      { id: 'memories', type: 'memory', estimatedTokens: 12000 },
      { id: 'low-old', type: 'other', estimatedTokens: 11000, priority: 'low', compactable: true },
      { id: 'conversation', type: 'conversation', estimatedTokens: 17000 }
    ]
  });
  assert.ok(memoryAndLow.warnings.some(item => item.code === ContextWarningCode.MEMORY_OVERFETCH));
  assert.ok(memoryAndLow.warnings.some(item => item.code === ContextWarningCode.LOW_PRIORITY_CONTEXT_LARGE));

  // Provider total remains authoritative while Crew estimates attribution.
  const providerHistory = {
    conversation_id: 'conversation-1',
    context_stats: {
      active_tokens: 42138,
      active_tokens_exact: true,
      active_tokens_source: 'provider',
      context_window: 128000
    },
    messages: [
      { role: 'user', content: 'visual archive that is not necessarily active' }
    ],
    active_messages: [
      { role: 'user', content: 'recent active task' },
      {
        role: 'assistant',
        content: 'Result\n\n```js\nconsole.log("ok");\n```',
        tools: [{ name: 'read_file', output: 'x'.repeat(8000) }]
      }
    ]
  };
  const historyHealth = context.analyzeConversationContext(providerHistory, {
    additionalContributions: [
      { id: 'role-core', type: 'role', estimatedTokens: 2000, priority: 'required', compactable: false, pinned: true },
      { id: 'memory:m1', type: 'memory', estimatedTokens: 4000, priority: 'high', compactable: true },
      { id: 'task-current', type: 'task', estimatedTokens: 1000, priority: 'required', compactable: false, pinned: true }
    ]
  });
  assert.equal(historyHealth.totalUsage.value, 42138);
  assert.equal(historyHealth.totalUsage.exact, true);
  assert.equal(historyHealth.budget.maxTokens, 128000);
  assert.ok(historyHealth.breakdown.conversation);
  assert.ok(historyHealth.breakdown.code);
  assert.ok(historyHealth.breakdown.tool);
  assert.equal(historyHealth.breakdown.memory.estimatedTokens, 4000);
  assert.equal(historyHealth.breakdown.task.estimatedTokens, 1000);

  // Heuristic provider totals remain visibly approximate.
  const heuristicHistory = context.analyzeConversationContext({
    conversation_id: 'agy-1',
    context_stats: {
      active_tokens: 39000,
      active_tokens_exact: false,
      active_tokens_source: 'heuristic'
    },
    messages: [{ role: 'user', content: 'hello' }]
  });
  assert.equal(heuristicHistory.totalUsage.value, 39000);
  assert.equal(heuristicHistory.totalUsage.exact, false);
  assert.equal(heuristicHistory.status, ContextHealthStatus.UNKNOWN);

  // Recent tail is distinct and never compactable.
  const longMessages = Array.from({ length: 14 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `message-${index} ${'x'.repeat(40)}`
  }));
  const historyContributions = context.buildHistoryContextContributions({
    conversation_id: 'tail-test',
    messages: longMessages
  });
  assert.ok(historyContributions.some(item => item.id === 'conversation-history' && item.compactable));
  assert.ok(historyContributions.some(item => item.id === 'conversation-recent' && item.compactable === false));

  const empty = context.analyze();
  assert.equal(empty.status, ContextHealthStatus.UNKNOWN);
  assert.equal(empty.totalUsage.value, 0);
  assert.equal(empty.largestCompactableContribution, null);

  // Existing Role / Memory retrieval flow remains intact.
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-pocket-context-health-'));
  try {
    const memoryProvider = new LocalMemoryProvider({ storagePath: path.join(tempDir, 'records.json') });
    await memoryProvider.retain({
      id: 'memory-terminal-evidence',
      text: 'Crew Helper completion requires terminal evidence.',
      scope: MemoryScope.ROLE,
      roleId: 'role-helper'
    });
    const role = {
      id: 'role-helper',
      name: 'Crew Helper Developer',
      description: 'Builds Crew Helper.',
      projectId: 'project-helper',
      systemContext: '',
      skills: ['Android']
    };
    const project = {
      id: 'project-helper',
      name: 'Crew Helper',
      workspace: '/tmp/crew-helper',
      systemContext: ''
    };
    const agentContext = await buildAgentContext({
      roleId: role.id,
      projectId: project.id,
      currentPrompt: 'terminal evidence',
      memoryProvider,
      roleResolver: async id => id === role.id ? role : null,
      projectResolver: async id => id === project.id ? project : null
    });
    assert.equal(agentContext.memories.length, 1);
    assert.ok(agentContext.contributions.some(item => item.type === ContextSourceType.ROLE && item.pinned));
    assert.ok(agentContext.contributions.some(item => item.type === ContextSourceType.PROJECT && item.pinned));
    assert.ok(agentContext.contributions.some(item => item.type === ContextSourceType.MEMORY));
    assert.ok(agentContext.contributions.some(item => item.type === ContextSourceType.TASK && item.pinned));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  console.log('context-health tests: ok');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
