const { DEFAULT_ROLE_ID, getRole } = require('./roles');
const { getProject } = require('./projects');
const { MemoryScope } = require('./memory/types');
const { defaultMemoryProvider } = require('./memory');
const { defaultSkillRegistry, skillContext } = require('./skills/registry');
const {
  ContextSourceType,
  ContextPriority
} = require('./context/types');
const {
  defaultContextEstimator,
  contributionFromText
} = require('./context/estimator');

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

function buildStaticContextContributions({
  role = null,
  project = null,
  memories = [],
  roleSkills = [],
  currentWork = '',
  estimator = defaultContextEstimator
} = {}) {
  const contributions = [];

  if (role) {
    const roleText = [
      role.id,
      role.name,
      role.description,
      role.systemContext,
      ...(role.skills || [])
    ].filter(Boolean).join('\n');
    contributions.push(contributionFromText({
      id: 'role-core',
      type: ContextSourceType.ROLE,
      text: roleText,
      label: role.name || role.id,
      priority: ContextPriority.REQUIRED,
      compactable: false,
      pinned: true,
      sourceRef: `role:${role.id}`,
      estimator
    }));
  }

  if (project) {
    const projectText = [
      project.id,
      project.name,
      project.workspace,
      project.systemContext
    ].filter(Boolean).join('\n');
    contributions.push(contributionFromText({
      id: 'project-core',
      type: ContextSourceType.PROJECT,
      text: projectText,
      label: project.name || project.id,
      priority: ContextPriority.HIGH,
      compactable: false,
      pinned: true,
      sourceRef: `project:${project.id}`,
      estimator
    }));
  }

  for (const skill of roleSkills || []) {
    contributions.push(contributionFromText({
      id: 'skill:' + skill.id,
      type: ContextSourceType.SKILL,
      text: skillContext(skill),
      label: skill.title,
      priority: ContextPriority.NORMAL,
      compactable: true,
      pinned: false,
      sourceRef: 'skill:' + skill.id,
      estimator
    }));
  }

  for (const hit of memories || []) {
    const record = hit?.record || {};
    if (!record.id || !record.text) continue;
    contributions.push(contributionFromText({
      id: `memory:${record.id}`,
      type: ContextSourceType.MEMORY,
      text: formatMemoryEvidence(record),
      label: record.kind || 'Long-term memory',
      priority: ContextPriority.HIGH,
      compactable: true,
      pinned: false,
      sourceRef: `memory:${record.id}`,
      estimator
    }));
  }

  if (String(currentWork || '').trim()) {
    contributions.push(contributionFromText({
      id: 'work-current',
      type: ContextSourceType.WORK,
      text: currentWork,
      label: 'Current work',
      priority: ContextPriority.REQUIRED,
      compactable: false,
      pinned: true,
      estimator
    }));
  }

  return contributions;
}

async function buildAgentContext({
  roleId = DEFAULT_ROLE_ID,
  projectId = null,
  conversationId = null,
  currentWork = '',
  currentPrompt = '',
  memoryProvider = defaultMemoryProvider,
  skillRegistry = defaultSkillRegistry,
  roleResolver = getRole,
  projectResolver = getProject,
  memoryBudget = DEFAULT_MEMORY_BUDGET
} = {}) {
  const role = await roleResolver(roleId || DEFAULT_ROLE_ID) || await roleResolver(DEFAULT_ROLE_ID);
  if (!role) throw new Error('Default Role is unavailable');

  const effectiveProjectId = String(projectId || role.projectId || '').trim() || null;
  const project = effectiveProjectId ? await projectResolver(effectiveProjectId) : null;
  const budget = boundedMemoryBudget(memoryBudget);
  const queryText = [currentWork, currentPrompt].map(value => String(value || '').trim()).filter(Boolean).join('\n');

  const memories = await memoryProvider.recall({
    text: queryText,
    scopes: [MemoryScope.GLOBAL, MemoryScope.ROLE, MemoryScope.PROJECT],
    roleId: role.id,
    projectId: effectiveProjectId,
    conversationId,
    limit: budget.maxItems,
    maxChars: budget.maxChars
  });

  const roleSkills = await skillRegistry.match(role.id, queryText, 2);
  const resolvedWork = String(currentWork || currentPrompt || '').trim();
  const contributions = buildStaticContextContributions({
    role,
    project,
    memories,
    roleSkills,
    currentWork: resolvedWork
  });

  return {
    role,
    project,
    conversation: conversationId ? { id: conversationId } : null,
    currentWork: resolvedWork,
    memories,
    roleSkills,
    contributions,
    memoryBudget: budget,
    memoryChars: memories.reduce((total, hit) => total + String(hit?.record?.text || '').length, 0)
  };
}

function formatMemoryEvidence(record = {}) {
  const labels = [record.scope || 'MEMORY'];
  if (record.provenance?.derivation) labels.push(record.provenance.derivation);
  if (record.confidence !== null && record.confidence !== undefined) {
    labels.push(`confidence=${Number(record.confidence).toFixed(2)}`);
  }

  let line = `[${labels.join(' · ')}] ${record.text || ''}`;
  const sources = Array.isArray(record.provenance?.sources)
    ? record.provenance.sources.slice(0, 3).map(source => `${source.type}:${source.id}`)
    : [];
  const derivedFrom = Array.isArray(record.provenance?.derivedFrom)
    ? record.provenance.derivedFrom.slice(0, 3)
    : [];

  if (sources.length) line += ` | sources=${sources.join(',')}`;
  if (derivedFrom.length) line += ` | derivedFrom=${derivedFrom.join(',')}`;
  return line;
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

  if (context.roleSkills?.length) {
    lines.push('', '[Relevant Active Role Skills · user-attested, not independently verified]');
    context.roleSkills.forEach(skill => lines.push(skillContext(skill)));
  }

  if (context.memories?.length) {
    lines.push('', '[Relevant Long-Term Memory]');
    context.memories.forEach((hit, index) => {
      const record = hit.record || {};
      lines.push(`${index + 1}. ${formatMemoryEvidence(record)}`);
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
  buildStaticContextContributions,
  buildAgentContext,
  formatMemoryEvidence,
  formatAgentContext
};
