const { sessionManager } = require('../session');

async function startTurn({ conversationId, model, effort, prompt, onEvent, onAbort }) {
  const session = await sessionManager.getOrCreateSession(conversationId, model, effort);
  session.isBusy = true;
  let fullResponse = '';
  let finished = false;

  onEvent({
    type: 'session_started',
    conversationId: session.conversationId,
    model: session.model,
    effort: session.effort
  });

  const cleanup = () => {
    if (finished) return;
    finished = true;
    session.isBusy = false;
    session.emitter.removeListener('event', handleEvent);
    session.emitter.removeListener('raw', handleRaw);
    if (session.process) session.process.removeListener('close', handleClose);
    sessionManager.resetIdleTimer(session);
  };

  const handleEvent = (item) => {
    if (item.event === 'step_update' && item.step_update) {
      const update = item.step_update;
      if (update.step_type === 'agent_response' && update.text_delta) {
        fullResponse += update.text_delta;
        onEvent({ type: 'text_delta', delta: update.text_delta, accumulated: fullResponse });
      } else if (update.step_type === 'thought' || update.thinking_delta || update.thinking) {
        const delta = update.thinking_delta || update.thinking || update.text || '';
        if (delta) onEvent({ type: 'reasoning_delta', delta });
      } else if (update.step_type === 'tool') {
        onEvent({
          type: 'tool',
          state: update.state,
          name: update.tool_name,
          info: update.tool_info,
          durationSeconds: update.duration_seconds
        });
      }
      return;
    }

    if (item.event === 'result' && item.result) {
      if (item.result.conversation_id) session.conversationId = item.result.conversation_id;
      if (item.result.thinking) {
        onEvent({ type: 'reasoning_complete', thinking: item.result.thinking });
      }
      if (item.result.response) fullResponse = item.result.response;
      onEvent({
        type: 'turn_completed',
        response: fullResponse,
        conversationId: session.conversationId,
        status: item.result.status
      });
      cleanup();
    }
  };

  const handleRaw = (line) => {
    if (line && line.trim()) console.log(`[Resident agy stdout note] ${line.trim()}`);
  };

  const handleClose = (code) => {
    if (!finished) onEvent({ type: 'error', message: `agy process crashed or closed with code ${code}` });
    cleanup();
  };

  session.emitter.on('event', handleEvent);
  session.emitter.on('raw', handleRaw);
  if (session.process) session.process.on('close', handleClose);

  onAbort(() => {
    if (!finished && session.isBusy) sessionManager.closeSession(session.conversationId);
    cleanup();
  });

  const payload = {
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: prompt }] }
  };
  session.process.stdin.write(`${JSON.stringify(payload)}\n`);
  return { conversationId: session.conversationId, cleanup };
}

module.exports = {
  id: 'antigravity',
  startTurn,
  getStatus(conversationId) {
    const session = sessionManager.sessions.get(conversationId);
    return { conversation_id: conversationId, isBusy: Boolean(session && session.isBusy) };
  },
  stop() { sessionManager.closeActiveSession(); },
  prewarm(model, effort) { sessionManager.prewarm(model, effort); }
};
