const fs = require('node:fs/promises');
const path = require('node:path');

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
    'Only the plain-text message below was shared. No sender Context, Memory, Conversation, Project, workspace or tool state was transferred.',
    '</ADDITIONAL_METADATA>',
    '<USER_REQUEST>',
    'Reply to this Crew message in plain text.',
    'Communication only: do not modify files, run tools, build, execute commands, or delegate to another Role.',
    'Do not call send_message yourself; Crew Pocket will deliver your final response back to the sender automatically.',
    'If the message lacks enough information, ask one concise clarification instead of guessing.',
    '',
    message.content,
    '</USER_REQUEST>'
  ].filter(Boolean).join('\n');
}

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
          providerId: provider.id,
          conversationId,
          model: value.model || null,
          effort: value.effort || 'low',
          updatedAt
        };
      }
    }
  }

  const providerId = latest?.providerId || providers[0]?.id || null;
  if (!providerId) return null;
  return {
    providerId,
    model: latest?.model || getDefaultModel(providerId),
    effort: latest?.effort || 'low',
    sourceConversationId: latest?.conversationId || null,
    updatedAt: latest?.updatedAt || 0
  };
}

async function hasBusyRoleConversation(roleId, {
  listProviders,
  getProviderConversationSettings
}) {
  for (const provider of listProviders()) {
    const settings = await getProviderConversationSettings(provider.id).catch(() => new Map());
    for (const [conversationId, value] of settings.entries()) {
      if (value?.roleId !== roleId) continue;
      try {
        if (provider.getStatus(conversationId)?.isBusy) return true;
      } catch (_) {}
    }
  }
  return false;
}

function createCrewAutoResponder({
  listProviders,
  getProvider,
  getProviderConversationSettings,
  getDefaultModel,
  getRole,
  buildAgentContext,
  formatAgentContext,
  sendCrewMessage,
  markCrewMessagesDelivered,
  runtimeHome,
  logger = console,
  defer = fn => setImmediate(fn),
  timeoutMs = DEFAULT_AUTO_RESPONSE_TIMEOUT_MS
}) {
  const activeRoles = new Set();
  const mailboxWorkspace = path.join(runtimeHome, '.crew-pocket', 'mailbox');

  async function runProviderReply({ provider, runtime, prompt }) {
    await fs.mkdir(mailboxWorkspace, { recursive: true });

    let temporaryConversationId = null;
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
      conversationId: null,
      model: runtime.model,
      effort: runtime.effort,
      workspace: mailboxWorkspace,
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
          temporaryConversationId = event.conversationId || temporaryConversationId;
        } else if (event.type === 'tool') {
          toolAttempted = true;
          try { abortTurn?.(); } catch (_) {}
          settleReject(new Error('Crew auto-response attempted to use a tool'));
        } else if (event.type === 'turn_completed') {
          settleResolve(cleanReply(event.response));
        } else if (event.type === 'error') {
          settleReject(new Error(event.message || 'Crew auto-response failed'));
        }
      }
    });

    Promise.resolve(startPromise).catch(settleReject);

    try {
      const reply = await completion;
      if (toolAttempted) throw new Error('Crew auto-response attempted to use a tool');
      if (!reply) throw new Error('Crew auto-response returned an empty reply');
      return reply;
    } finally {
      if (timeout) clearTimeout(timeout);
      if (temporaryConversationId && provider.metadata?.capabilities?.delete && typeof provider.deleteConversation === 'function') {
        await provider.deleteConversation(temporaryConversationId).catch(error => {
          logger.warn('[Crew Auto Response] Temporary conversation cleanup failed:', error.message);
        });
      }
    }
  }

  async function respond(message) {
    const recipientRole = await getRole(message.toRoleId);
    const senderRole = await getRole(message.fromRoleId);
    if (!recipientRole || !senderRole) return { status: 'pending', reason: 'role_missing' };

    // Re-check at execution time to close the race between scheduling and a
    // human starting work in the recipient Role.
    if (await hasBusyRoleConversation(recipientRole.id, {
      listProviders,
      getProviderConversationSettings
    })) {
      return { status: 'pending', reason: 'role_busy' };
    }

    const runtime = await findLatestRoleRuntime(recipientRole.id, {
      listProviders,
      getProviderConversationSettings,
      getDefaultModel
    });
    if (!runtime) return { status: 'pending', reason: 'provider_unavailable' };

    const provider = getProvider(runtime.providerId);
    const ownContext = await buildAgentContext({
      roleId: recipientRole.id,
      projectId: recipientRole.projectId || null,
      currentTask: 'Reply to a Crew message from ' + senderRole.name,
      currentPrompt: message.content
    });
    const prompt = buildCrewAutoReplyPrompt({
      contextText: formatAgentContext(ownContext),
      message,
      recipientRole,
      senderRole
    });

    const reply = await runProviderReply({ provider, runtime, prompt });
    const replyMessage = await sendCrewMessage({
      fromRoleId: recipientRole.id,
      toRoleId: senderRole.id,
      content: reply,
      replyToId: message.id
    });
    await markCrewMessagesDelivered(recipientRole.id, [message.id]);

    return {
      status: 'replied',
      messageId: message.id,
      replyMessageId: replyMessage.id,
      provider: runtime.providerId
    };
  }

  async function schedule(message) {
    if (!message?.toRoleId || !message?.id) return { status: 'pending', reason: 'invalid_message' };
    if (activeRoles.has(message.toRoleId)) return { status: 'pending', reason: 'role_auto_response_busy' };

    if (await hasBusyRoleConversation(message.toRoleId, {
      listProviders,
      getProviderConversationSettings
    })) {
      return { status: 'pending', reason: 'role_busy' };
    }

    activeRoles.add(message.toRoleId);
    defer(async () => {
      try {
        const result = await respond(message);
        logger.log('[Crew Auto Response] ' + JSON.stringify(result));
      } catch (error) {
        logger.warn('[Crew Auto Response] Failed:', error.message);
      } finally {
        activeRoles.delete(message.toRoleId);
      }
    });
    return { status: 'scheduled' };
  }

  return {
    schedule,
    respond,
    activeRoles
  };
}

module.exports = {
  DEFAULT_AUTO_RESPONSE_TIMEOUT_MS,
  buildCrewAutoReplyPrompt,
  findLatestRoleRuntime,
  hasBusyRoleConversation,
  createCrewAutoResponder
};
