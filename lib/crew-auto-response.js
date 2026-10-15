const { getProject } = require('./projects');
const { getContextSnapshot, saveContextSnapshot } = require('./context/state');
const { ContextSourceType } = require('./context/types');
const { randomUUID } = require('crypto');
const { isTerminalProviderError } = require('./providers/events');
const { normalizeResultStatus } = require('./turn-result');

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
  updateCrewAutoResponse = async () => {},
  isRoleReserved = () => false,
  turnRegistry = null,
  onActivityChanged = () => {},
  runtimeHome,
  logger = console,
  defer = fn => setImmediate(fn),
  timeoutMs = DEFAULT_AUTO_RESPONSE_TIMEOUT_MS
}) {
  const activeRoles = new Set();
  const retryStates = new Map();
  const retryTimers = new Map();
  const maxAttempts = 3;
  const retryState = message => retryStates.get(message.id) || message.autoResponse || { attempts: 0 };
  async function saveRetryState(message, state) {
    await updateCrewAutoResponse(message.toRoleId, message.id, state);
    retryStates.set(message.id, state);
    while (retryStates.size > 2000) retryStates.delete(retryStates.keys().next().value);
  }
  function retryLater(roleId, at) {
    const existing = retryTimers.get(roleId);
    if (existing && existing.at <= at) return;
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      retryTimers.delete(roleId);
      drain(roleId).catch(error => logger.warn('[Crew Auto Response] Retry failed:', error.message));
    }, Math.max(1000, at - Date.now()));
    timer.unref?.();
    retryTimers.set(roleId, { timer, at });
  }

  async function runProviderReply({ provider, runtime, prompt, workspace, requestId }) {
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

    const startPromise = Promise.resolve().then(() => provider.startTurn({
      conversationId,
      roleId: runtime.roleId,
      allowCrewTools: false,
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
        if (settled) abortTurn?.();
      },
      onEvent(event) {
        if (!event) return;
        turnRegistry?.noteProviderEvent(requestId, event);
        if (event.type === 'session_started') {
          conversationId = event.conversationId || conversationId;
        } else if (event.type === 'tool') {
          toolAttempted = true;
          try { abortTurn?.(); } catch (_) {}
          settleReject(new Error('Crew auto-response attempted to use a tool'));
        } else if (event.type === 'turn_completed') {
          if (normalizeResultStatus(event) !== 'completed') {
            settleReject(new Error(event.error || 'Crew auto-response ended without completion: ' + event.status));
            return;
          }
          settleResolve({
            reply: cleanReply(event.response),
            conversationId: event.conversationId || conversationId
          });
        } else if (isTerminalProviderError(event)) {
          settleReject(new Error(event.message || 'Crew auto-response failed'));
        }
      }
    }));

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
    const routingAt = Date.now();
    const recipientRole = await getRole(message.toRoleId);
    const senderRole = await getRole(message.fromRoleId);
    if (!recipientRole || !senderRole) return { status: 'pending', reason: 'role_missing' };

    const runtime = await runtimeForRole(recipientRole.id);
    if (!runtime) return { status: 'pending', reason: 'provider_unavailable' };
    if (isRoleReserved(recipientRole.id) || isRoleRuntimeBusy(runtime, { getProvider })) {
      return { status: 'pending', reason: 'role_busy' };
    }

    const requestId = randomUUID();
    turnRegistry?.start(requestId, runtime.providerId, runtime.conversationId, {
      kind: 'crew_reply', source: 'crew_auto_response', roleId: recipientRole.id
    });
    const startedAt = Date.now();
    const log = (status, conversationId = runtime.conversationId) => logger.log?.('[CrewReplyLifecycle]', JSON.stringify({
      request_id: requestId, message_id: message.id, role_id: recipientRole.id,
      provider: runtime.providerId, conversation_id: conversationId || null,
      at: Date.now(), status, elapsed_ms: Date.now() - startedAt
    }));
    log('preparing');
    onActivityChanged(recipientRole.id);
    try {
      const result = await respondInRuntime(message, { runtime, recipientRole, senderRole, routingAt, requestId });
      turnRegistry?.finish(requestId, { status: 'completed', conversation_id: result.conversationId });
      log('completed', result.conversationId);
      return result;
    } catch (error) {
      turnRegistry?.finish(requestId, { status: 'failed' });
      log('failed', turnRegistry?.get(requestId, runtime.providerId)?.conversation_id);
      throw error;
    } finally {
      onActivityChanged(recipientRole.id);
    }
  }

  async function respondInRuntime(message, { runtime, recipientRole, senderRole, routingAt, requestId }) {
    const previousContext = runtime.conversationId
      ? await getContextSnapshot(runtime.providerId, runtime.conversationId).catch(() => null)
      : null;
    // A Role's current Codex/AGY thread already contains its initial identity
    // and memory. Only bootstrap a new thread or rehydrate after compaction.
    const rehydrateMemory = Boolean(previousContext?.reretrieveMemoryOnNextTurn);
    const needsContext = !runtime.conversationId || rehydrateMemory;
    const ownContext = needsContext ? await buildAgentContext({
      roleId: recipientRole.id,
      projectId: recipientRole.projectId || null,
      conversationId: runtime.conversationId,
      currentWork: 'Reply to a Crew message from ' + senderRole.name,
      currentPrompt: message.content
    }) : null;
    const prompt = buildCrewAutoReplyPrompt({
      contextText: ownContext ? formatAgentContext(ownContext) : '',
      message,
      recipientRole,
      senderRole
    });

    const provider = getProvider(runtime.providerId);
    const roleProject = ownContext?.project || (runtime.workspace
      ? null
      : await getProject(recipientRole.projectId).catch(() => null));
    const workspace = runtime.workspace || roleProject?.workspace || runtimeHome;
    const result = await runProviderReply({ provider, runtime, prompt, workspace, requestId });
    if (rehydrateMemory) {
      await saveContextSnapshot(runtime.providerId, result.conversationId, {
        contributions: [
          ...(previousContext?.contributions || []).filter(item => item.type !== ContextSourceType.MEMORY),
          ...(ownContext?.contributions || []).filter(item => item.type === ContextSourceType.MEMORY)
        ],
        reretrieveMemoryOnNextTurn: false
      }).catch(error => logger.warn('[Crew Auto Response] Memory refresh checkpoint failed:', error.message));
    }

    const settings = await saveConversationSettings(runtime.providerId, result.conversationId, {
      model: runtime.model || getDefaultModel(runtime.providerId),
      effort: runtime.effort || 'low',
      roleId: recipientRole.id,
      ...(workspace ? { workspace } : {}),
      role: 'general'
    });
    await activateRoleConversation({
      routingAt,
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
      provider: runtime.providerId,
      conversationId: result.conversationId
    };
  }

  async function attempt(message) {
    const previous = retryState(message);
    if (previous.status === 'failed') return { status: 'failed', reason: 'retry_exhausted', messageId: message.id };
    if (previous.status === 'running') {
      // A restart may have interrupted an accepted model turn. Never replay it
      // automatically when its completion is unknown.
      await saveRetryState(message, { ...previous, status: 'failed', nextAttemptAt: null,
        lastError: 'Previous automatic reply has an unknown outcome' });
      return { status: 'failed', reason: 'previous_attempt_unknown', messageId: message.id };
    }
    if (previous.nextAttemptAt > Date.now()) {
      retryLater(message.toRoleId, previous.nextAttemptAt);
      return { status: 'pending', reason: 'retry_backoff', nextAttemptAt: previous.nextAttemptAt };
    }
    const attempts = (Number(previous.attempts) || 0) + 1;
    if (attempts > maxAttempts) {
      await saveRetryState(message, { ...previous, status: 'failed', nextAttemptAt: null });
      return { status: 'failed', reason: 'retry_exhausted', messageId: message.id };
    }
    await saveRetryState(message, { status: 'running', attempts, nextAttemptAt: null });
    try {
      const result = await respond(message);
      if (result.status === 'replied') {
        await saveRetryState(message, { status: 'replied', attempts, nextAttemptAt: null });
      } else if (result.reason === 'role_missing' || result.reason === 'provider_unavailable') {
        await saveRetryState(message, { status: 'failed', attempts, lastError: result.reason });
        return { ...result, status: 'failed' };
      } else {
        await saveRetryState(message, { ...previous, status: 'pending' });
      }
      return result;
    } catch (error) {
      const failed = attempts >= maxAttempts;
      const nextAttemptAt = failed ? null : Date.now() + 15000 * (2 ** (attempts - 1));
      await saveRetryState(message, { status: failed ? 'failed' : 'retrying', attempts,
        nextAttemptAt, lastError: String(error.message || error).slice(0, 240) });
      logger.warn('[Crew Auto Response] ' + JSON.stringify({ messageId: message.id,
        at: Date.now(), attempts, status: failed ? 'failed' : 'retrying', nextAttemptAt }));
      if (nextAttemptAt) retryLater(message.toRoleId, nextAttemptAt);
      return { status: failed ? 'failed' : 'pending', reason: failed ? 'retry_exhausted' : 'retry_backoff',
        messageId: message.id, nextAttemptAt, error: String(error.message || error).slice(0, 240) };
    }
  }

  async function drain(roleId) {
    if (!roleId || activeRoles.has(roleId)) return { status: 'pending', reason: 'role_auto_response_busy' };
    // Reserve before the first await, including runtime and inbox reads.
    activeRoles.add(roleId);
    let drainAgain = false;
    try {
      const inbox = await getCrewInbox(roleId, { undeliveredOnly: true, limit: 100 });
      const requests = inbox.filter(message => !message.replyToId && message.kind !== 'task_result' && retryState(message).status !== 'failed');
      if (!requests.length) return { status: 'idle' };
      const runtime = await runtimeForRole(roleId);
      if (!runtime) return { status: 'pending', reason: 'provider_unavailable' };
      if (isRoleReserved(roleId) || isRoleRuntimeBusy(runtime, { getProvider })) {
        retryLater(roleId, Date.now() + 15000);
        return { status: 'pending', reason: 'role_busy' };
      }
      const next = requests.find(message => !(retryState(message).nextAttemptAt > Date.now()));
      for (const message of requests) {
        const at = retryState(message).nextAttemptAt;
        if (at > Date.now()) retryLater(roleId, at);
      }
      if (!next) return { status: requests.length ? 'pending' : 'idle' };
      const result = await attempt(next);
      drainAgain = result.status === 'replied' || result.status === 'failed';
      return result;
    } finally {
      activeRoles.delete(roleId);
      if (drainAgain) defer(() => drain(roleId).catch(error => {
        logger.warn('[Crew Auto Response] Queue drain failed:', error.message);
      }));
    }
  }

  async function dispatch(message, { waitForReply = false } = {}) {
    if (!message?.toRoleId || !message?.id) return { status: 'pending', reason: 'invalid_message' };
    if (activeRoles.has(message.toRoleId)) return { status: 'pending', reason: 'role_auto_response_busy' };
    activeRoles.add(message.toRoleId);
    const work = async () => {
      try {
        const runtime = await runtimeForRole(message.toRoleId);
        if (!runtime) return { status: 'pending', reason: 'provider_unavailable' };
        if (isRoleReserved(message.toRoleId) || isRoleRuntimeBusy(runtime, { getProvider })) return { status: 'pending', reason: 'role_busy' };
        const result = await attempt(message);
        if (waitForReply && result.status === 'replied' && result.replyMessageId) {
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
    };
    if (waitForReply) return work();
    defer(() => work().catch(error => logger.warn('[Crew Auto Response] Failed:', error.message)));
    return { status: 'scheduled' };
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
