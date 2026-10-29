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
  getCrewInboxSummaryByRole = null,
  getCrewMessageActivity,
  getProvider,
  getRoleActivity = () => null,
  listRoleQueuedMessages = async () => []
}) {
  const [roles, runtimes, queuedMessages, inboxSummaryByRole] = await Promise.all([
    listRoles(),
    listRoleRuntimes(),
    listRoleQueuedMessages().catch(() => []),
    typeof getCrewInboxSummaryByRole === 'function'
      ? Promise.resolve().then(() => getCrewInboxSummaryByRole())
      : Promise.resolve(null)
  ]);
  const runtimeByRole = new Map((runtimes || []).map(runtime => [runtime.roleId, runtime]));
  const queuedByRole = new Map();
  for (const message of queuedMessages || []) {
    const items = queuedByRole.get(message.roleId) || [];
    items.push(message);
    queuedByRole.set(message.roleId, items);
  }
  const useInboxSummary = Boolean(inboxSummaryByRole && typeof inboxSummaryByRole.get === 'function');

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

    const latestActivity = getRoleActivity(role.id);
    // Active work can belong to a newly created conversation that has not yet
    // been saved as the Role's current conversation. Completed work must match
    // the current runtime, and must not describe a newer untracked native turn.
    const turnActivity = latestActivity?.terminal && (providerStatus.isBusy ||
      latestActivity.provider !== runtime?.providerId ||
      latestActivity.conversation_id !== runtime?.conversationId) ? null : latestActivity;
    const busy = Boolean(providerStatus.isBusy || (turnActivity && !turnActivity.terminal));

    const [inbox, activity] = await Promise.all([
      useInboxSummary ? Promise.resolve([]) : getCrewInbox(role.id, { undeliveredOnly: true, limit: 100 }).catch(() => []),
      getCrewMessageActivity(role.id, { limit: 6 }).catch(() => [])
    ]);

    const actionableRequests = inbox.filter(message =>
      !message.replyToId && message.kind !== 'task_result');
    const failedRequests = actionableRequests.filter(message => message.autoResponse?.status === 'failed');
    const queuedRequests = actionableRequests.filter(message =>
      !['failed', 'replied'].includes(message.autoResponse?.status));
    const unreadReplies = inbox.filter(message => Boolean(message.replyToId) && message.kind !== 'task_result');
    const inboxSummary = useInboxSummary ? inboxSummaryByRole.get(role.id) || {} : {};
    const queuedRequestCount = useInboxSummary
      ? Number(inboxSummary.queuedRequestCount || 0) : queuedRequests.length;
    const failedRequestCount = useInboxSummary
      ? Number(inboxSummary.failedRequestCount || 0) : failedRequests.length;
    const unreadReplyCount = useInboxSummary
      ? Number(inboxSummary.unreadReplyCount || 0) : unreadReplies.length;
    const unreadTaskResultCount = useInboxSummary
      ? Number(inboxSummary.unreadTaskResultCount || 0)
      : inbox.filter(message => message.kind === 'task_result').length;
    const oldestQueuedRequest = useInboxSummary
      ? inboxSummary.oldestQueuedRequest || null
      : queuedRequests.reduce((oldest, message) => {
          const createdAt = Number(message.autoResponse?.queuedAt || message.createdAt) || 0;
          return !oldest || createdAt < oldest.createdAt
            ? { createdAt, reason: message.autoResponse?.lastReason || null }
            : oldest;
        }, null);
    const roleQueue = queuedByRole.get(role.id) || [];
    const queuedMessageCount = roleQueue.length;

    let state = 'new';
    if (runtime?.conversationId) state = 'idle';
    else if (runtime?.pendingNew) state = 'new';
    if (busy) state = 'working';
    else if (queuedRequestCount || queuedMessageCount) state = 'waiting';

    const conversationTitle = settings?.title || null;
    const trackedWork = turnActivity && !turnActivity.terminal ? turnActivity : null;
    const sameConversation = !trackedWork || (trackedWork.provider === runtime?.providerId &&
      trackedWork.conversation_id === runtime?.conversationId);
    const currentWork = runtime || trackedWork
      ? {
          conversationId: trackedWork ? trackedWork.conversation_id : runtime?.conversationId || null,
          title: sameConversation ? conversationTitle || (runtime?.pendingNew ? '新工作' : null) : null,
          status: busy ? 'working' : (runtime?.pendingNew ? 'new' : 'idle'),
          startedAt: Number(turnActivity?.started_at || runtime?.activatedAt) || 0,
          updatedAt: Number(turnActivity?.last_activity_at || turnActivity?.started_at || runtime?.updatedAt) || 0
        }
      : null;

    return {
      roleId: role.id,
      roleName: role.name,
      projectId: role.projectId || null,
      state,
      busy,
      activity: turnActivity,
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
      queuedRequestCount,
      failedRequestCount,
      unreadReplyCount,
      unreadTaskResultCount,
      oldestQueuedRequestAt: oldestQueuedRequest?.createdAt || null,
      oldestQueuedRequestAgeMs: oldestQueuedRequest
        ? Math.max(0, Date.now() - oldestQueuedRequest.createdAt)
        : 0,
      oldestQueuedRequestReason: oldestQueuedRequest?.reason || null,
      attentionCount: queuedMessageCount + queuedRequestCount + unreadReplyCount +
        unreadTaskResultCount + failedRequestCount,
      lastActivityAt: Math.max(
        Number(turnActivity?.ended_at || turnActivity?.last_activity_at || turnActivity?.started_at) || 0,
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
