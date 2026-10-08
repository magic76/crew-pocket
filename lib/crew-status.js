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
  listRoleQueuedMessages = async () => []
}) {
  const [roles, runtimes, queuedMessages] = await Promise.all([
    listRoles(),
    listRoleRuntimes(),
    listRoleQueuedMessages().catch(() => [])
  ]);
  const runtimeByRole = new Map((runtimes || []).map(runtime => [runtime.roleId, runtime]));
  const queuedByRole = new Map();
  for (const message of queuedMessages || []) {
    const items = queuedByRole.get(message.roleId) || [];
    items.push(message);
    queuedByRole.set(message.roleId, items);
  }

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
    const roleQueue = queuedByRole.get(role.id) || [];
    const queuedMessageCount = roleQueue.length;

    let state = 'new';
    if (runtime?.conversationId) state = providerStatus.isBusy ? 'working' : 'idle';
    else if (runtime?.pendingNew) state = 'new';
    if (!providerStatus.isBusy && (queuedRequests.length || queuedMessageCount)) state = 'waiting';

    const conversationTitle = settings?.title || null;
    const currentWork = runtime
      ? {
          conversationId: runtime.conversationId || null,
          title: conversationTitle || (runtime.pendingNew ? '新工作' : null),
          status: providerStatus.isBusy ? 'working' : (runtime.pendingNew ? 'new' : 'idle'),
          startedAt: Number(runtime.activatedAt) || 0,
          updatedAt: Number(runtime.updatedAt) || 0
        }
      : null;

    return {
      roleId: role.id,
      roleName: role.name,
      projectId: role.projectId || null,
      state,
      busy: Boolean(providerStatus.isBusy),
      runtime: runtime ? {
        providerId: runtime.providerId,
        conversationId: runtime.conversationId,
        pendingNew: Boolean(runtime.pendingNew),
        model: runtime.model || settings?.model || null,
        effort: runtime.effort || settings?.effort || 'low',
        workspace: runtime.workspace || settings?.workspace || null,
        activatedAt: runtime.activatedAt || 0,
        updatedAt: runtime.updatedAt || 0
      } : null,
      conversationTitle,
      currentWork,
      queuedMessageCount,
      queuedRequestCount: queuedRequests.length,
      unreadReplyCount: unreadReplies.length,
      attentionCount: queuedMessageCount + queuedRequests.length + unreadReplies.length,
      lastActivityAt: Math.max(
        Number(runtime?.updatedAt) || 0,
        Number(roleQueue.at(-1)?.createdAt) || 0,
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
