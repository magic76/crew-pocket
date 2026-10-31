// P0: one trusted MCP connection maps to one Role; tool args never select an identity.
// Do not mount this globally on a Codex app-server shared by multiple Roles.
const { getRole, listRoles } = require('../roles');
const { getRoleRuntime } = require('../role-runtime');
const { defaultMemoryProvider } = require('../memory');
const { sendCrewMessage, getCrewInbox } = require('../crew-messages');
const { defaultMemoryCandidateStore } = require('./memory-candidates');
const { defaultCrewTaskStore } = require('./tasks');
const { defaultSocialPublisherScheduler } = require('../social-publisher-scheduler');
const { getAutoCompactSettings } = require('../context/auto-compact-store');
const { listArchive, curateArchive, recallArchive, proposeCompaction } = require('../context/self-managed');

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
  taskStore = defaultCrewTaskStore,
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


  async function contextIdentity() {
    const { runtime } = await identity();
    if (!(await getAutoCompactSettings()).enabled) {
      throw new Error('Self-managed Context is disabled in AutoCompact settings');
    }
    if (!runtime?.providerId || !runtime?.conversationId) {
      throw new Error('No active Role conversation to manage');
    }
    return { roleId: boundRoleId, provider: runtime.providerId,
      conversationId: runtime.conversationId };
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

    async crew_request_social_publisher_schedule({ intervalMinutes = 30 } = {}) {
      const { role } = await identity();
      const status = await defaultSocialPublisherScheduler.requestSchedule({
        roleId: role.id,
        intervalMinutes
      });
      return {
        status: 'pending_user_confirmation',
        intervalMinutes: status.requestedSchedule?.intervalMinutes || 30,
        enabled: status.enabled,
        note: '排程請求已記錄；必須由使用者在社群工作台確認啟用。'
      };
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

    async crew_handoff({ toRoleId, task, parentTaskId = null, timeoutMinutes = 30 } = {}) {
      await identity();
      const to = requiredString(toRoleId, 'Recipient Role ID', 160);
      const body = requiredString(task, 'Task', 4000);
      const result = await taskStore.create({
        fromRoleId: boundRoleId, toRoleId: to, task: body,
        parentTaskId: parentTaskId || null, timeoutMinutes
      });
      return { taskId: result.id, status: result.status,
        toRoleId: result.toRoleId, duplicate: result.duplicate === true };
    },

    async crew_get_task_status({ taskId } = {}) {
      await identity();
      const id = requiredString(taskId, 'Task ID', 80);
      const result = await taskStore.status(id, boundRoleId);
      return { taskId: result.id, fromRoleId: result.fromRoleId,
        toRoleId: result.toRoleId, parentTaskId: result.parentTaskId,
        status: result.status, result: result.result, error: result.error,
        createdAt: result.createdAt, updatedAt: result.updatedAt };
    },

    async crew_report_done({ taskId, summary } = {}) {
      await identity();
      return taskStore.report(
        boundRoleId, requiredString(taskId, 'Task ID', 80),
        requiredString(summary, 'Summary', 2000)
      );
    },


    async crew_context_propose({ summary, keepIds = [] } = {}) {
      return proposeCompaction(await contextIdentity(), { summary, keepIds });
    },

    async crew_context_list({ limit = 15 } = {}) {
      return listArchive(await contextIdentity(), { limit });
    },

    async crew_context_curate({ items } = {}) {
      return curateArchive(await contextIdentity(), { items });
    },

    async crew_context_recall({ id, offset = 0, maxChars = 6000 } = {}) {
      return recallArchive(await contextIdentity(), { id, offset, maxChars });
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
