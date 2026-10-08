// Deterministic provider events for the real HTTP/SSE Runtime contract.
const { getProvider } = require('../../lib/providers');
const provider = getProvider('codex');
const histories = new Map();
provider.isAvailable = () => true;
provider.getHistory = async id => histories.get(id) || { conversation_id: id, messages: [] };
provider.startTurn = async ({ conversationId, prompt, onEvent, onAbort }) => {
  const id = conversationId || 'feedback-test';
  const scenario = /scenario:(\w+)/.exec(prompt)?.[1] || 'completed';
  const messages = [];
  histories.set(id, { conversation_id: id, provider: 'codex', messages });
  messages.push({ role: 'user', content: prompt, timestamp: new Date().toISOString() });
  const assistant = { role: 'assistant', content: '', tools: [], timestamp: new Date().toISOString() };
  messages.push(assistant);
  let aborted = false;
  onAbort(() => { aborted = true; });
  onEvent({ type: 'session_started', conversationId: id });
  onEvent({ type: 'reasoning_delta', delta: 'checking' });
  for (const [toolId, exitCode] of [['read', 0], ['check', scenario === 'toolfailed' ? 1 : 0]]) {
    const event = { type: 'tool', toolId, name: 'commandExecution', info: { parameters: { command: 'node --check fixture.js' }, exitCode } };
    onEvent({ ...event, state: 'running' });
    onEvent({ ...event, state: 'completed', durationSeconds: 0.02 });
  }
  assistant.content = '已檢查執行回饋。';
  onEvent({ type: 'text_delta', delta: assistant.content });
  await new Promise(resolve => setTimeout(resolve, scenario === 'slow' ? 1500 : 30));
  if (aborted) return;
  if (scenario === 'providererror') onEvent({ type: 'error', message: 'fixture provider failure' });
  else onEvent({ type: 'turn_completed', conversationId: id, response: assistant.content, status: scenario === 'interrupted' ? 'interrupted' : 'completed' });
};
