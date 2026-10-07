const { DEFAULT_ROLE_ID, getRole } = require('./roles');
const { getProject } = require('./projects');
const { MemoryScope } = require('./memory/types');
const { defaultMemoryProvider } = require('./memory');

const DEFAULT_MEMORY_BUDGET = Object.freeze({
  maxItems: 6,
  maxChars: 2400
});

function boundedMemoryBudget(input = {}) {
  return {
    maxItems: Math.max(1, Math.min(Number(input.maxItems) || DEFAULT_MEMORY_BUDGET.maxItems, 20)),
    maxChars: Math.max(512, Math.min(Number(input.maxChars) || DEFAULT_MEMORY_BUDGET.maxChars, 12000))
  };
}

async function buildAgentContext({
  roleId = DEFAULT_ROLE_ID,
  projectId = null,
  conversationId = null,
  currentTask = '',
  currentPrompt = '',
  memoryProvider = defaultMemoryProvider,
  roleResolver = getRole,
  projectResolver = getProject,
  memoryBudget = DEFAULT_MEMORY_BUDGET
} = {}) {
  const role = await roleResolver(roleId || DEFAULT_ROLE_ID) || await roleResolver(DEFAULT_ROLE_ID);
  if (!role) throw new Error('Default Role is unavailable');

  const effectiveProjectId = String(projectId || role.projectId || '').trim() || null;
  const project = effectiveProjectId ? await projectResolver(effectiveProjectId) : null;
  const budget = boundedMemoryBudget(memoryBudget);
  const queryText = [currentTask, currentPrompt].map(value => String(value || '').trim()).filter(Boolean).join('\n');

  const memories = await memoryProvider.recall({
    text: queryText,
    scopes: [MemoryScope.GLOBAL, MemoryScope.ROLE, MemoryScope.PROJECT],
    roleId: role.id,
    projectId: effectiveProjectId,
    conversationId,
    limit: budget.maxItems,
    maxChars: budget.maxChars
  });

  return {
    role,
    project,
    conversation: conversationId ? { id: conversationId } : null,
    currentTask: String(currentTask || currentPrompt || '').trim(),
    memories,
    memoryBudget: budget,
    memoryChars: memories.reduce((total, hit) => total + String(hit?.record?.text || '').length, 0)
  };
}

function formatAgentContext(context) {
  if (!context?.role) return '';
  const lines = [
    '<ADDITIONAL_METADATA>',
    '[Crew Role Identity]',
    `Role ID: ${context.role.id}`,
    `Role Name: ${context.role.name}`
  ];

  if (context.role.description) lines.push(`Role Description: ${context.role.description}`);
  if (context.role.systemContext) lines.push(`Role Context: ${context.role.systemContext}`);
  if (context.role.skills?.length) lines.push(`Role Skills: ${context.role.skills.join(', ')}`);

  if (context.project) {
    lines.push(
      '',
      '[Project Context]',
      `Project ID: ${context.project.id}`,
      `Project Name: ${context.project.name}`
    );
    if (context.project.workspace) lines.push(`Workspace: ${context.project.workspace}`);
    if (context.project.systemContext) lines.push(`Project Context: ${context.project.systemContext}`);
  }

  if (context.memories?.length) {
    lines.push('', '[Relevant Long-Term Memory]');
    context.memories.forEach((hit, index) => {
      const record = hit.record || {};
      lines.push(`${index + 1}. [${record.scope}] ${record.text}`);
    });
  }

  if (context.conversation?.id) {
    lines.push('', '[Current Conversation]', `Conversation ID: ${context.conversation.id}`);
  }

  lines.push('</ADDITIONAL_METADATA>');
  return lines.join('\n');
}

module.exports = {
  DEFAULT_MEMORY_BUDGET,
  boundedMemoryBudget,
  buildAgentContext,
  formatAgentContext
};
