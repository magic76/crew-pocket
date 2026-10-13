// P0: one trusted MCP connection maps to one Role; tool args never select an identity.
// Do not mount this globally on a Codex app-server shared by multiple Roles.
const { getRole, listRoles } = require('../roles');
const { getRoleRuntime } = require('../role-runtime');
const { defaultMemoryProvider } = require('../memory');
const { sendCrewMessage, getCrewInbox } = require('../crew-messages');
const { defaultMemoryCandidateStore } = require('./memory-candidates');

function requiredString(value, name, max = 4000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(name + ' must be a non-empty string (max ' + max + ' chars)');
  }
  return value.trim();
}
function clamp(value, fallback, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.trunc(parsed))) : fallback;
}

function createCrewMcpTools({
  roleId,
  resolveRole = getRole,
  resolveRoles = listRoles,
  resolveRuntime = getRoleRuntime,
  memoryProvider = defaultMemoryProvider,
  candidateStore = defaultMemoryCandidateStore,
  sendMessage = sendCrewMessage,
  getInbox = getCrewInbox
} = {}) {
  const boundRoleId = requiredString(roleId, 'Bound Role ID', 160);
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(boundRoleId)) throw new Error('Invalid bound Role ID');

  async function identity() {
    const role = await resolveRole(boundRoleId);
    if (!role || role.id !== boundRoleId) throw new Error('Bound Role does not exist');
    const runtime = await resolveRuntime(boundRoleId);
    return { role, runtime };
  }

  return Object.freeze({
    async crew_whoami() {
      const { role, runtime } = await identity();
      return {
        role: {
          id: role.id,
          name: role.name,
          description: role.description || '',
          projectId: role.projectId || null,
          systemContext: role.systemContext || '',
          skills: role.skills || []
        },
        runtime: runtime ? {
          providerId: runtime.providerId,
          conversationId: runtime.conversationId || null,
          model: runtime.model || null,
          workspace: runtime.workspace || null
        } : null
      };
    },

    async crew_list_roles() {
      await identity();
      const roles = await resolveRoles();
      // Other agents' private instructions, workspaces and memories are not listed.
      return { roles: roles.map(role => ({
        id: role.id, name: role.name, description: role.description || '',
        isSelf: role.id === boundRoleId
      })) };
    },

    async crew_get_inbox({ limit = 20 } = {}) {
      await identity();
      return { messages: await getInbox(boundRoleId, { undeliveredOnly: true, limit: clamp(limit, 20, 50) }) };
    },

    async crew_send_message({ toRoleId, message, replyToId } = {}) {
      await identity();
      const to = requiredString(toRoleId, 'Recipient Role ID', 160);
      if (!/^[A-Za-z0-9._-]{1,160}$/.test(to) || to === boundRoleId || to === '*' || to.startsWith('tag:')) {
        throw new Error('Recipient must be a different concrete Role');
      }
      const content = requiredString(message, 'Message', 4000);
      const reply = replyToId ? requiredString(replyToId, 'Reply ID', 160) : null;
      const sent = await sendMessage({
        fromRoleId: boundRoleId, toRoleId: to, content, replyToId: reply
      });
      return { messageId: sent.id, fromRoleId: boundRoleId, toRoleId: to, status: 'queued' };
    },

    async crew_recall({ query = '', limit = 6 } = {}) {
      const { role, runtime } = await identity();
      if (typeof query !== 'string' || query.length > 1000) throw new Error('Query must be under 1000 characters');
      const scopes = ['ROLE', 'GLOBAL'];
      if (role.projectId) scopes.push('PROJECT');
      if (runtime?.conversationId) scopes.push('SESSION');
      const hits = await memoryProvider.recall({
        text: query, scopes, roleId: boundRoleId, projectId: role.projectId || null,
        conversationId: runtime?.conversationId || null,
        limit: clamp(limit, 6, 10), maxChars: 4000
      });
      return { memories: hits.map(hit => ({
        id: hit.record.id, text: hit.record.text, scope: hit.record.scope,
        kind: hit.record.kind, confidence: hit.record.confidence,
        provenance: hit.record.provenance, score: hit.score
      })) };
    },

    async crew_propose_memory({ text, kind = 'experience', tags = [], evidence = [] } = {}) {
      const { role, runtime } = await identity();
      const claim = requiredString(text, 'Memory candidate text', 2000);
      const candidate = await candidateStore.propose({
        roleId: boundRoleId, projectId: role.projectId || null,
        conversationId: runtime?.conversationId || null,
        text: claim, kind, tags, evidence
      });
      return { candidateId: candidate.id, status: 'pending_review', duplicate: candidate.duplicate === true };
    }
  });
}

module.exports = { createCrewMcpTools };
