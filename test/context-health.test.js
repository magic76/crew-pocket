const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const contextHealth = require('../lib/context');
const {
  ContextSourceType,
  ContextPriority,
  ContextHealthStatus,
  ContextWarningCode,
  HeuristicContextEstimator
} = contextHealth;
const { LocalMemoryProvider } = require('../lib/memory/local-memory-provider');
const { MemoryScope } = require('../lib/memory/types');
const { buildAgentContext } = require('../lib/context-builder');

async function run() {
  // 1. Heuristic estimator is replaceable and deliberately approximate.
  const estimator = new HeuristicContextEstimator({ charsPerToken: 4 });
  assert.equal(estimator.estimateText(''), 0);
  assert.equal(estimator.estimateText('1234'), 1);
  assert.equal(estimator.estimateText('12345'), 2);
  assert.equal(estimator.exact, false);
  assert.equal(estimator.kind, 'heuristic');

  // 2. Contribution aggregation.
  const grouped = contextHealth.groupContextContributions([
    { id: 'r1', type: 'role', estimatedTokens: 100 },
    { id: 'r2', type: 'role', estimatedTokens: 50 },
    { id: 't1', type: 'tool', estimatedTokens: 300 }
  ]);
  assert.equal(grouped.role.estimatedTokens, 150);
  assert.equal(grouped.role.count, 2);
  assert.equal(grouped.tool.estimatedTokens, 300);

  // 3. Healthy threshold.
  const healthy = contextHealth.analyze({
    budget: { maxTokens: 100000, estimatedInputTokens: 50000 },
    contributions: [{ id: 'conversation', type: 'conversation', estimatedTokens: 50000 }]
  });
  assert.equal(healthy.status, ContextHealthStatus.HEALTHY);
  assert.equal(healthy.usageRatio, 0.5);

  // 4. Warning threshold.
  const warning = contextHealth.analyze({
    budget: { maxTokens: 100000, estimatedInputTokens: 80000 },
    contributions: [{ id: 'conversation', type: 'conversation', estimatedTokens: 80000 }]
  });
  assert.equal(warning.status, ContextHealthStatus.WARNING);
  assert.ok(warning.warnings.some(item => item.code === ContextWarningCode.NEAR_CONTEXT_LIMIT));

  // 5. Critical threshold.
  const critical = contextHealth.analyze({
    budget: { maxTokens: 100000, estimatedInputTokens: 95000 },
    contributions: [{ id: 'conversation', type: 'conversation', estimatedTokens: 95000 }]
  });
  assert.equal(critical.status, ContextHealthStatus.CRITICAL);

  // Reserved output/reasoning reduce the available input budget.
  const reserved = contextHealth.analyze({
    budget: {
      maxTokens: 128000,
      reservedOutputTokens: 8000,
      reservedReasoningTokens: 4000,
      estimatedInputTokens: 81200
    },
    contributions: [{ id: 'conversation', type: 'conversation', estimatedTokens: 81200 }]
  });
  assert.equal(reserved.budget.availableInputTokens, 116000);
  assert.ok(Math.abs(reserved.usageRatio - (81200 / 116000)) < 0.000001);

  // 6. Unknown model budget is honest rather than inventing a context window.
  const unknown = contextHealth.analyze({
    budget: { estimatedInputTokens: 12000 },
    contributions: [{ id: 'conversation', type: 'conversation', estimatedTokens: 12000 }]
  });
  assert.equal(unknown.status, ContextHealthStatus.UNKNOWN);
  assert.equal(Object.prototype.hasOwnProperty.call(unknown, 'usageRatio'), false);
  assert.ok(unknown.warnings.some(item => item.code === ContextWarningCode.UNKNOWN_MODEL_BUDGET));

  // 7. Pinned / non-compactable metadata survives normalization.
  const pinned = contextHealth.analyze({
    budget: { maxTokens: 100000 },
    contributions: [{
      id: 'role-core',
      type: ContextSourceType.ROLE,
      label: 'Crew Helper Developer',
      estimatedTokens: 1200,
      priority: ContextPriority.REQUIRED,
      compactable: false,
      pinned: true,
      sourceRef: 'role:crew-helper-developer'
    }]
  });
  assert.equal(pinned.contributions[0].pinned, true);
  assert.equal(pinned.contributions[0].compactable, false);
  assert.equal(pinned.contributions[0].priority, ContextPriority.REQUIRED);

  // 8. Largest contribution and largest compactable contribution are distinct.
  const largest = contextHealth.analyze({
    budget: { maxTokens: 200000 },
    contributions: [
      { id: 'role', type: 'role', estimatedTokens: 30000, pinned: true, compactable: false },
      { id: 'conversation', type: 'conversation', estimatedTokens: 22000, compactable: true },
      { id: 'tools', type: 'tool', estimatedTokens: 10000, compactable: true }
    ]
  });
  assert.equal(largest.largestContribution.id, 'role');
  assert.equal(largest.largestCompactableContribution.id, 'conversation');

  // 9. Conversation-too-large warning.
  const conversationLarge = contextHealth.analyze({
    budget: { maxTokens: 128000, estimatedInputTokens: 80000 },
    contributions: [
      { id: 'conversation-current', type: 'conversation', estimatedTokens: 50000, compactable: true },
      { id: 'other', type: 'other', estimatedTokens: 30000 }
    ]
  });
  const conversationWarning = conversationLarge.warnings.find(item => item.code === ContextWarningCode.CONVERSATION_LARGE);
  assert.ok(conversationWarning);
  assert.equal(conversationWarning.contributionId, 'conversation-current');

  // 10. Tool-output-too-large warning.
  const toolLarge = contextHealth.analyze({
    budget: { maxTokens: 128000, estimatedInputTokens: 50000 },
    contributions: [
      { id: 'tools-current', type: 'tool', estimatedTokens: 18000, compactable: true },
      { id: 'conversation-current', type: 'conversation', estimatedTokens: 32000, compactable: true }
    ]
  });
  const toolWarning = toolLarge.warnings.find(item => item.code === ContextWarningCode.TOOL_OUTPUT_LARGE);
  assert.ok(toolWarning);
  assert.equal(toolWarning.contributionId, 'tools-current');

  // Memory and low-priority warnings are available without a rule-engine framework.
  const memoryAndLow = contextHealth.analyze({
    budget: { maxTokens: 100000, estimatedInputTokens: 40000 },
    contributions: [
      { id: 'memories', type: 'memory', estimatedTokens: 12000 },
      { id: 'low-old', type: 'other', estimatedTokens: 11000, priority: 'low', compactable: true },
      { id: 'conversation', type: 'conversation', estimatedTokens: 17000 }
    ]
  });
  assert.ok(memoryAndLow.warnings.some(item => item.code === ContextWarningCode.MEMORY_OVERFETCH));
  assert.ok(memoryAndLow.warnings.some(item => item.code === ContextWarningCode.LOW_PRIORITY_CONTEXT_LARGE));

  // 11. Empty context never crashes.
  const empty = contextHealth.analyze();
  assert.equal(empty.estimatedInputTokens, 0);
  assert.equal(empty.contributions.length, 0);
  assert.equal(empty.status, ContextHealthStatus.UNKNOWN);
  assert.equal(empty.largestContribution, null);
  assert.equal(empty.largestCompactableContribution, null);

  // Normalized provider history can be analyzed without provider-specific message schemas.
  const history = {
    conversation_id: 'conversation-1',
    context_stats: {
      active_tokens: 42000,
      context_window: 128000
    },
    messages: [
      { role: 'user', content: 'Please inspect the runtime.' },
      {
        role: 'assistant',
        content: 'Result follows.\n\n\`\`\`js\nconsole.log("ok");\n\`\`\`',
        tools: [{ name: 'read_file', args: { path: 'server.js' }, output: 'x'.repeat(12000) }]
      }
    ]
  };
  const historyHealth = contextHealth.analyzeConversationContext(history);
  assert.equal(historyHealth.estimatedInputTokens, 42000);
  assert.equal(historyHealth.budget.maxTokens, 128000);
  assert.ok(historyHealth.breakdown.conversation);
  assert.ok(historyHealth.breakdown.code);
  assert.ok(historyHealth.breakdown.tool);
  assert.ok(historyHealth.unattributedTokens >= 0);

  // Acceptance-style example produces a reasonable breakdown and warnings.
  const acceptance = contextHealth.analyze({
    budget: {
      maxTokens: 128000,
      reservedOutputTokens: 8000,
      estimatedInputTokens: 81200
    },
    contributions: [
      {
        id: 'role',
        type: 'role',
        estimatedTokens: 1200,
        pinned: true,
        compactable: false,
        priority: 'required'
      },
      {
        id: 'conversation',
        type: 'conversation',
        estimatedTokens: 62000,
        compactable: true
      },
      {
        id: 'tools',
        type: 'tool',
        estimatedTokens: 18000,
        compactable: true
      }
    ]
  });
  assert.equal(acceptance.estimatedInputTokens, 81200);
  assert.equal(acceptance.breakdown.conversation.estimatedTokens, 62000);
  assert.equal(acceptance.largestCompactableContribution.id, 'conversation');
  assert.ok(acceptance.warnings.some(item => item.code === ContextWarningCode.CONVERSATION_LARGE));
  assert.ok(acceptance.warnings.some(item => item.code === ContextWarningCode.TOOL_OUTPUT_LARGE));

  // 12. Existing Role / Memory retrieval flow still works and now exposes
  // contribution metadata without changing what gets recalled.
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-pocket-context-health-'));
  try {
    const memoryProvider = new LocalMemoryProvider({
      storagePath: path.join(tempDir, 'records.json')
    });
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
