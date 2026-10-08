const DEFAULT_AUTO_RESPONSE_TIMEOUT_MS = 90000;

function cleanReply(text, maxLength = 4000) {
  return String(text || '').trim().slice(0, maxLength);
}

function buildCrewAutoReplyPrompt({ contextText = '', message, recipientRole, senderRole }) {
  const senderName = senderRole?.name || message.fromRoleName || message.fromRoleId;
  const recipientName = recipientRole?.name || message.toRoleName || message.toRoleId;
  return [
    contextText,
    '<ADDITIONAL_METADATA>',
    '[Incoming Crew Message]',
    'Message ID: ' + message.id,
    'From Role: ' + senderName + ' (' + message.fromRoleId + ')',
    'To Role: ' + recipientName + ' (' + message.toRoleId + ')',
    'The sender message is being handled inside your own current conversation.',
    'Only the explicit sender message is copied. The sender\'s Context, Memory, Conversation, Project, workspace and tool state are not copied into yours.',
    '</ADDITIONAL_METADATA>',
    '<USER_REQUEST>',
    'Reply to this Crew message in plain text.',
    'Communication only: do not modify files, run tools, build, execute commands, or delegate to another Role.',
    'Do not call send_message yourself; Crew Pocket returns your final response to the sender as the result of their Crew tool call when possible.',
    'If the message lacks enough information, ask one concise clarification instead of guessing.',
    '',
    message.content,
    '</USER_REQUEST>'
  ].filter(Boolean).join('\n');
}

// Migration helper only. Once a Role has explicit runtime state, routing uses
// that state instead of repeatedly guessing from "most recently updated".
async function findLatestRoleRuntime(roleId, {
  listProviders,
  getProviderConversationSettings,
  getDefaultModel
}) {
  const providers = listProviders();
  let latest = null;

  for (const provider of providers) {
    const settings = await getProviderConversationSettings(provider.id).catch(() => new Map());
    for (const [conversationId, value] of settings.entries()) {
      if (value?.roleId !== roleId) continue;
      const updatedAt = Number(value.updatedAt) || 0;
      if (!latest || updatedAt > latest.updatedAt) {
        latest = {
          roleId,
          providerId: provider.id,
          conversationId,
          model: value.model || null,
          effort: value.effort || 'low',
          workspace: value.workspace || null,
          updatedAt
        };
      }
    }
  }

  if (!latest) return null;
  return {
    ...latest,
    model: latest.model || getDefaultModel(latest.providerId)
  };
}

async function resolveRoleRuntime(roleId, {
  listProviders,
  getProviderConversationSettings,
  getDefaultModel,
  getRoleRuntime,
  activateRoleConversation,
  clearRoleConversation
}) {
  const current = await getRoleRuntime(roleId);
  if (current) {
    if (current.pendingNew && !current.conversationId) {
      return {
        ...current,
        model: current.model || getDefaultModel(current.providerId),
        effort: current.effort || 'low',
        workspace: current.workspace || null
      };
    }

    const settings = await getProviderConversationSettings(current.providerId).catch(() => new Map());
    const value = current.conversationId ? settings.get(current.conversationId) : null;
    if (value?.roleId === roleId) {
      return {
        ...current,
        model: current.model || value.model || getDefaultModel(current.providerId),
        effort: current.effort || value.effort || 'low',
        workspace: current.workspace || value.workspace || null
      };
    }
    await clearRoleConversation(roleId).catch(() => {});
  }

  const migrated = await findLatestRoleRuntime(roleId, {
    listProviders,
    getProviderConversationSettings,
    getDefaultModel
  });
  if (migrated) {
    return activateRoleConversation(migrated);
  }

  const providerId = listProviders()[0]?.id || null;
  if (!providerId) return null;
  return {
    roleId,
    providerId,
    conversationId: null,
    model: getDefaultModel(providerId),
    effort: 'low',
    workspace: null,
    activatedAt: 0,
    updatedAt: 0
  };
}

function isRoleRuntimeBusy(runtime, { getProvider }) {
  if (!runtime?.providerId || !runtime?.conversationId) return false;
  try {
    return Boolean(getProvider(runtime.providerId).getStatus(runtime.conversationId)?.isBusy);
  } catch (_) {
    return false;
  }
}

async function hasBusyRoleConversation(roleId, {
  getRoleRuntime,
  getProvider
}) {
  const runtime = await getRoleRuntime(roleId);
  return isRoleRuntimeBusy(runtime, { getProvider });
}

function createCrewAutoResponder({
  listProviders,
  getProvider,
  getProviderConversationSettings,
  saveConversationSettings,
  getDefaultModel,
  getRole,
  getRoleRuntime,
  activateRoleConversation,
  clearRoleConversation,
  buildAgentContext,
  formatAgentContext,
  sendCrewMessage,
  getCrewInbox,
  markCrewMessagesDelivered,
  runtimeHome,
  logger = console,
  defer = fn => setImmediate(fn),
  timeoutMs = DEFAULT_AUTO_RESPONSE_TIMEOUT_MS
}) {
  const activeRoles = new Set();

  async function runProviderReply({ provider, runtime, prompt, workspace }) {
    let conversationId = runtime.conversationId || null;
    let abortTurn = null;
    let toolAttempted = false;
    let settled = false;
    let timeout = null;
    let rejectCompletion;
    let resolveCompletion;

    const completion = new Promise((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });

    const settleResolve = value => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolveCompletion(value);
    };
    const settleReject = error => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      rejectCompletion(error instanceof Error ? error : new Error(String(error || 'Crew auto-response failed')));
    };

    timeout = setTimeout(() => {
      try { abortTurn?.(); } catch (_) {}
      settleReject(new Error('Crew auto-response timed out'));
    }, timeoutMs);

    const startPromise = provider.startTurn({
      conversationId,
      model: runtime.model,
      effort: runtime.effort,
      workspace: workspace || runtime.workspace || runtimeHome,
      executionMode: 'CHAT',
      executionPolicy: {
        mode: 'CHAT',
        source: 'crew-message-auto-response',
        hardToolExecutions: 0,
        softToolExecutions: 0,
        maxPolls: 0,
        maxFilesChanged: 0,
        allowWrite: false,
        allowBuild: false,
        allowDependencyChanges: false
      },
      executionIntent: null,
      prompt,
      onAbort(handler) {
        abortTurn = typeof handler === 'function' ? handler : null;
      },
      onEvent(event) {
        if (!event) return;
        if (event.type === 'session_started') {
          conversationId = event.conversationId || conversationId;
        } else if (event.type === 'tool') {
          toolAttempted = true;
          try { abortTurn?.(); } catch (_) {}
          settleReject(new Error('Crew auto-response attempted to use a tool'));
        } else if (event.type === 'turn_completed') {
          settleResolve({
            reply: cleanReply(event.response),
            conversationId: event.conversationId || conversationId
          });
        } else if (event.type === 'error') {
          settleReject(new Error(event.message || 'Crew auto-response failed'));
        }
      }
    });

    Promise.resolve(startPromise).catch(settleReject);

    try {
      const result = await completion;
      if (toolAttempted) throw new Error('Crew auto-response attempted to use a tool');
      if (!result.reply) throw new Error('Crew auto-response returned an empty reply');
      if (!result.conversationId) throw new Error('Crew auto-response did not resolve a conversation');
      return result;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async function runtimeForRole(roleId) {
    return resolveRoleRuntime(roleId, {
      listProviders,
      getProviderConversationSettings,
      getDefaultModel,
      getRoleRuntime,
      activateRoleConversation,
      clearRoleConversation
    });
  }

  async function respond(message) {
    const recipientRole = await getRole(message.toRoleId);
    const senderRole = await getRole(message.fromRoleId);
    if (!recipientRole || !senderRole) return { status: 'pending', reason: 'role_missing' };

    const runtime = await runtimeForRole(recipientRole.id);
    if (!runtime) return { status: 'pending', reason: 'provider_unavailable' };
    if (isRoleRuntimeBusy(runtime, { getProvider })) {
      return { status: 'pending', reason: 'role_busy' };
    }

    const ownContext = await buildAgentContext({
      roleId: recipientRole.id,
      projectId: recipientRole.projectId || null,
      conversationId: runtime.conversationId,
      currentWork: 'Reply to a Crew message from ' + senderRole.name,
      currentPrompt: message.content
    });
    const prompt = buildCrewAutoReplyPrompt({
      contextText: formatAgentContext(ownContext),
      message,
      recipientRole,
      senderRole
    });

    const provider = getProvider(runtime.providerId);
    const workspace = runtime.workspace || ownContext.project?.workspace || runtimeHome;
    const result = await runProviderReply({ provider, runtime, prompt, workspace });

    const settings = await saveConversationSettings(runtime.providerId, result.conversationId, {
      model: runtime.model || getDefaultModel(runtime.providerId),
      effort: runtime.effort || 'low',
      roleId: recipientRole.id,
      ...(workspace ? { workspace } : {}),
      role: 'general'
    });
    const activeRuntime = await activateRoleConversation({
      roleId: recipientRole.id,
      providerId: runtime.providerId,
      conversationId: result.conversationId,
      model: settings.model,
      effort: settings.effort,
      workspace: settings.workspace || workspace || null
    });

    const replyMessage = await sendCrewMessage({
      fromRoleId: recipientRole.id,
      toRoleId: senderRole.id,
      content: result.reply,
      replyToId: message.id
    });
    await markCrewMessagesDelivered(recipientRole.id, [message.id]);

    return {
      status: 'replied',
      messageId: message.id,
      replyMessageId: replyMessage.id,
      reply: result.reply,
      provider: activeRuntime.providerId,
      conversationId: activeRuntime.conversationId
    };
  }

  async function drain(roleId) {
    if (!roleId || activeRoles.has(roleId)) return { status: 'pending', reason: 'role_auto_response_busy' };
    const runtime = await runtimeForRole(roleId);
    if (!runtime) return { status: 'pending', reason: 'provider_unavailable' };
    if (isRoleRuntimeBusy(runtime, { getProvider })) return { status: 'pending', reason: 'role_busy' };

    const inbox = await getCrewInbox(roleId, { undeliveredOnly: true, limit: 20 });
    const nextRequest = inbox.find(message => !message.replyToId);
    if (!nextRequest) return { status: 'idle' };

    activeRoles.add(roleId);
    try {
      return await respond(nextRequest);
    } finally {
      activeRoles.delete(roleId);
      defer(() => drain(roleId).catch(error => {
        logger.warn('[Crew Auto Response] Queue drain failed:', error.message);
      }));
    }
  }

  async function dispatch(message, { waitForReply = false } = {}) {
    if (!message?.toRoleId || !message?.id) return { status: 'pending', reason: 'invalid_message' };
    if (activeRoles.has(message.toRoleId)) return { status: 'pending', reason: 'role_auto_response_busy' };

    const runtime = await runtimeForRole(message.toRoleId);
    if (!runtime) return { status: 'pending', reason: 'provider_unavailable' };
    if (isRoleRuntimeBusy(runtime, { getProvider })) {
      return { status: 'pending', reason: 'role_busy' };
    }

    if (!waitForReply) {
      activeRoles.add(message.toRoleId);
      defer(async () => {
        try {
          const result = await respond(message);
          logger.log('[Crew Auto Response] ' + JSON.stringify(result));
        } catch (error) {
          logger.warn('[Crew Auto Response] Failed:', error.message);
        } finally {
          activeRoles.delete(message.toRoleId);
          defer(() => drain(message.toRoleId).catch(error => {
            logger.warn('[Crew Auto Response] Queue drain failed:', error.message);
          }));
        }
      });
      return { status: 'scheduled' };
    }

    activeRoles.add(message.toRoleId);
    try {
      const result = await respond(message);
      if (result.status === 'replied' && result.replyMessageId) {
        // The sender's current turn receives this reply directly as Crew tool
        // output, so do not show the same reply again from the inbox later.
        await markCrewMessagesDelivered(message.fromRoleId, [result.replyMessageId]);
        return { ...result, delivery: 'inline' };
      }
      return result;
    } finally {
      activeRoles.delete(message.toRoleId);
      defer(() => drain(message.toRoleId).catch(error => {
        logger.warn('[Crew Auto Response] Queue drain failed:', error.message);
      }));
    }
  }

  return {
    schedule: message => dispatch(message, { waitForReply: false }),
    dispatch,
    drain,
    respond,
    activeRoles
  };
}

module.exports = {
  DEFAULT_AUTO_RESPONSE_TIMEOUT_MS,
  buildCrewAutoReplyPrompt,
  findLatestRoleRuntime,
  resolveRoleRuntime,
  isRoleRuntimeBusy,
  hasBusyRoleConversation,
  createCrewAutoResponder
};
