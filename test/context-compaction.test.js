const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { analyzeContext } = require('../lib/context/health');
const {
  CompactionAction,
  CONTEXT_COMPACTION_CONFIG,
  planContextCompaction
} = require('../lib/context/compaction');

const root = path.join(__dirname, '..');
const chat = fs.readFileSync(path.join(root, 'public', 'js', 'chat.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const compactSource = fs.readFileSync(path.join(root, 'lib', 'compact.js'), 'utf8');

// 1-6. Header UX: healthy hidden, warning visible, critical stronger,
// unknown budget has no fake %, exact/estimated totals remain distinguishable.
assert.ok(chat.includes("['warning', 'critical'].includes(health.status)"));
assert.ok(chat.includes("button.textContent = critical ? 'Compact now' : 'Compact'"));
assert.ok(chat.includes("status === 'critical'"));
assert.ok(chat.includes("Context limit unknown"));
assert.equal(chat.includes('|| 80000'), false);
assert.ok(chat.includes("formatContextTokens(total.value, total.exact !== true)"));

// 7. Breakdown supports provider-total remainder without pretending it is exact.
const healthWithOther = analyzeContext({
  budget: { maxTokens: 128000 },
  totalUsage: { value: 42000, exact: true, source: 'provider' },
  contributions: [
    { id: 'conversation', type: 'conversation', estimatedTokens: 19000 },
    { id: 'tools', type: 'tool', estimatedTokens: 8000 },
    { id: 'memory', type: 'memory', estimatedTokens: 4000 }
  ]
});
assert.equal(healthWithOther.unattributedTokens, 11000);
assert.ok(chat.includes('Other / system'));

// Planner fixture for 8-15.
const health = analyzeContext({
  budget: { maxTokens: 128000 },
  totalUsage: { value: 94000, exact: true, source: 'provider' },
  contributions: [
    { id: 'role-core', type: 'role', estimatedTokens: 2000, priority: 'required', compactable: false, pinned: true },
    { id: 'project-core', type: 'project', estimatedTokens: 2000, priority: 'high', compactable: false, pinned: true },
    { id: 'task-current', type: 'task', estimatedTokens: 1000, priority: 'required', compactable: false, pinned: true },
    { id: 'conversation-recent', type: 'conversation', estimatedTokens: 7000, priority: 'high', compactable: false },
    { id: 'conversation-history', type: 'conversation', estimatedTokens: 34000, priority: 'normal', compactable: true },
    { id: 'tools-history', type: 'tool', estimatedTokens: 14000, priority: 'normal', compactable: true },
    { id: 'memory:m1', type: 'memory', estimatedTokens: 8000, priority: 'high', compactable: true },
    { id: 'code-history', type: 'code', estimatedTokens: 6000, priority: 'normal', compactable: true }
  ]
});
const plan = planContextCompaction({ health });

// 8. pinned never becomes a compaction candidate.
assert.ok(plan.keep.some(item => item.id === 'project-core'));
assert.equal([...plan.summarize, ...plan.drop, ...plan.reretrieve].some(item => item.id === 'project-core'), false);

// 9. non-compactable recent tail stays.
assert.ok(plan.keep.some(item => item.id === 'conversation-recent'));

// 10. Memory is re-retrieved, not deleted.
assert.ok(plan.reretrieve.some(item => item.id === 'memory:m1'));
assert.equal(plan.drop.some(item => item.id === 'memory:m1'), false);

// 11. Old conversation is summarized.
assert.equal(plan.summarize.find(item => item.id === 'conversation-history')?.action, CompactionAction.SUMMARIZE);

// 12. Normal/low raw tool output can be dropped.
assert.equal(plan.drop.find(item => item.id === 'tools-history')?.action, CompactionAction.DROP);

// 13-14. Current task and Role always keep.
assert.ok(plan.keep.some(item => item.id === 'task-current'));
assert.ok(plan.keep.some(item => item.id === 'role-core'));

// 15. Preview savings math is internally consistent.
assert.equal(plan.estimatedBeforeTokens, 94000);
assert.equal(plan.estimatedAfterTokens, plan.estimatedBeforeTokens - plan.estimatedSavingsTokens);
assert.ok(plan.estimatedSavingsTokens > 0);
assert.equal(plan.policy.recentTailMessages, CONTEXT_COMPACTION_CONFIG.recentTailMessages);

// 16. Safe runtime re-analyzes after provider compaction.
assert.ok(server.includes('const afterBundle = await getConversationContextHealth(providerId, conversationId)'));
assert.ok(server.includes('after_health: afterBundle.contextHealth'));
assert.ok(chat.includes('await loadConversationHistory(targetConversationId, { preserveComposer: true })'));

// 17. Compact does not delete Role Memory; it marks it for re-retrieval.
assert.ok(server.includes('markContextMemoryReretrieve(providerId, conversationId)'));
assert.ok(server.includes('[Refreshed Long-Term Memory]'));

// 18. Safe compact does not delete Role Memory or original conversation history.
const safeStart = server.indexOf('async function handleSafeContextCompact');
const safeEnd = server.indexOf('async function handleProviderHistory', safeStart);
const safeBlock = server.slice(safeStart, safeEnd);
assert.equal(safeBlock.includes('defaultMemoryProvider.forget('), false);
assert.equal(safeBlock.includes('deleteConversation'), false);
assert.ok(compactSource.includes('archiveActiveTranscript(logContent, logFullPath)'));

// 19. Unknown provider budget is valid and does not crash the planner.
const unknown = analyzeContext({
  totalUsage: { value: 42000, exact: false, source: 'heuristic' },
  contributions: [{ id: 'old', type: 'conversation', estimatedTokens: 30000, compactable: true }]
});
assert.equal(unknown.status, 'unknown');
assert.doesNotThrow(() => planContextCompaction({ health: unknown }));

// 20. Existing conversation/context routes remain, while safe flow is additive.
assert.ok(server.includes("pathname === '/api/history'"));
assert.ok(server.includes("pathname === '/api/compact'"));
assert.ok(server.includes("pathname === '/api/context/compaction-plan'"));
assert.ok(server.includes("pathname === '/api/context/compact'"));
assert.ok(html.includes('id="context-compact-preview-modal"'));
assert.ok(html.includes('精簡 Current Context 不會刪除 Role Memory'));

console.log('context-compaction tests: ok');
