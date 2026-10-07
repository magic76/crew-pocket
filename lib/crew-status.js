function safeStatus(provider, conversationId) {
  if (!provider || !conversationId) return { isBusy: false };
  try {
    return provider.getStatus(conversationId) || { isBusy: false };
  } catch (_) {
    return { isBusy: false };
  }
}

async function buildCrewStatus({
  listRoles,
  listRoleRuntimes,
  getConversationSettings,
  getCrewInbox,
  getCrewMessageActivity,
  getProvider,
  listTasks
}) {
  const [roles, runtimes, tasks] = await Promise.all([
    listRoles(),
    listRoleRuntimes(),
    listTasks(200).catch(() => [])
  ]);
  const runtimeByRole = new Map((runtimes || []).map(runtime => [runtime.roleId, runtime]));

  const items = await Promise.all((roles || []).map(async role => {
    const runtime = runtimeByRole.get(role.id) || null;
    let settings = null;
    let providerStatus = { isBusy: false };

    if (runtime?.providerId && runtime?.conversationId) {
      settings = await getConversationSettings(runtime.providerId, runtime.conversationId).catch(() => null);
      let provider = null;
      try { provider = getProvider(runtime.providerId); } catch (_) {}
      providerStatus = safeStatus(provider, runtime.conversationId);
    }

    const [inbox, activity] = await Promise.all([
      getCrewInbox(role.id, { undeliveredOnly: true, limit: 100 }).catch(() => []),
      getCrewMessageActivity(role.id, { limit: 6 }).catch(() => [])
    ]);

    const queuedRequests = inbox.filter(message => !message.replyToId);
    const unreadReplies = inbox.filter(message => Boolean(message.replyToId));
    const matchingTasks = runtime?.conversationId
      ? (tasks || []).filter(task =>
          task.conversationId === runtime.conversationId &&
          task.provider === runtime.providerId &&
          ['running', 'pending_confirmation'].includes(task.status)
        )
      : [];
    const currentTask = matchingTasks[0] || null;

    let state = 'new';
    if (runtime?.conversationId) state = providerStatus.isBusy ? 'working' : 'idle';
    if (!providerStatus.isBusy && queuedRequests.length) state = 'waiting';

    return {
      roleId: role.id,
      roleName: role.name,
      projectId: role.projectId || null,
      state,
      busy: Boolean(providerStatus.isBusy),
      runtime: runtime ? {
        providerId: runtime.providerId,
        conversationId: runtime.conversationId,
        model: runtime.model || settings?.model || null,
        effort: runtime.effort || settings?.effort || 'low',
        workspace: runtime.workspace || settings?.workspace || null,
        activatedAt: runtime.activatedAt || 0,
        updatedAt: runtime.updatedAt || 0
      } : null,
      conversationTitle: settings?.title || currentTask?.conversationTitle || null,
      currentTask: currentTask ? {
        id: currentTask.id,
        title: currentTask.title || currentTask.task || '',
        status: currentTask.status,
        updatedAt: currentTask.updatedAt || 0
      } : null,
      queuedRequestCount: queuedRequests.length,
      unreadReplyCount: unreadReplies.length,
      lastActivityAt: Math.max(
        Number(runtime?.updatedAt) || 0,
        Number(currentTask?.updatedAt) || 0,
        Number(activity?.[0]?.createdAt) || 0
      ),
      recentMessage: activity?.[0] ? {
        id: activity[0].id,
        direction: activity[0].direction,
        fromRoleId: activity[0].fromRoleId,
        fromRoleName: activity[0].fromRoleName,
        toRoleId: activity[0].toRoleId,
        toRoleName: activity[0].toRoleName,
        content: activity[0].content,
        replyToId: activity[0].replyToId || null,
        createdAt: activity[0].createdAt
      } : null
    };
  }));

  return {
    generatedAt: Date.now(),
    roles: items.sort((a, b) => a.roleName.localeCompare(b.roleName, 'en'))
  };
}

module.exports = { buildCrewStatus };
