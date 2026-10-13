'use strict';

// A display transcript is an archive. Context attribution must instead follow
// the last replacement history and subsequent model-facing response items.
// Never rewrite the provider's rollout or serialize opaque/encrypted payloads.
function readCodexActiveHistory(content) {
  let items = [], compacted = false, complete = true, lastCompactedAt = null;
  for (const line of String(content || '').split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (_) { complete = false; continue; }
    if (entry.type === 'compacted') {
      compacted = true;
      lastCompactedAt = entry.timestamp || null;
      complete = Array.isArray(entry.payload?.replacement_history);
      items = complete ? [...entry.payload.replacement_history] : [];
      if (!complete && entry.payload?.message) {
        items.push({ type: 'message', role: 'assistant', content: entry.payload.message });
      }
    } else if (entry.type === 'response_item' && entry.payload) {
      items.push(entry.payload);
    }
  }
  const messages = [], calls = new Map(), outputs = [];
  let opaqueItems = 0;
  let assistant = null;
  function currentAssistant() {
    if (!assistant) {
      assistant = { role: 'assistant', content: '', tools: [] };
      messages.push(assistant);
    }
    return assistant;
  }
  function readable(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(part => {
      if (typeof part?.text === 'string') return part.text;
      opaqueItems++; return '';
    }).join('\n');
    if (value == null) return '';
    opaqueItems++; return '';
  }
  for (const item of items) {
    if (!item || typeof item !== 'object') { complete = false; continue; }
    if (item.type === 'message') {
      const content = readable(item.content);
      if (item.role === 'assistant') {
        const message = currentAssistant();
        message.content += (message.content ? '\n' : '') + content;
      } else {
        assistant = null;
        messages.push({ role: item.role, content, tools: [] });
      }
    } else if (['custom_tool_call', 'function_call'].includes(item.type)) {
      const raw = item.input ?? item.arguments ?? '';
      // Keep the original input string for character estimates, without
      // parsing and re-serializing it with a different escaping overhead.
      const tool = { name: item.name || 'tool', args: raw, output: null };
      currentAssistant().tools.push(tool);
      if (item.call_id) calls.set(item.call_id, tool);
    } else if (['custom_tool_call_output', 'function_call_output'].includes(item.type)) {
      outputs.push(item);
    } else {
      // Compaction and reasoning may contain opaque provider-owned state.
      opaqueItems++;
    }
  }
  for (const item of outputs) {
    const output = readable(item.output);
    const tool = calls.get(item.call_id);
    if (tool) tool.output = tool.output === null ? output : tool.output + '\n' + output;
    else {
      complete = false;
      messages.push({ role: 'assistant', content: '', tools: [{ name: 'tool result', args: null, output }] });
    }
  }
  return {
    active_messages: messages,
    context_attribution: {
      source: 'codex_rollout', scope: 'active',
      complete: complete && opaqueItems === 0, opaqueItems,
      compacted, lastCompactedAt
    }
  };
}

module.exports = { readCodexActiveHistory };
