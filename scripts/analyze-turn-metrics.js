#!/usr/bin/env node

// Summarise Crew Pocket's privacy-preserving per-turn metrics without reading
// prompts or response text. The server writes these records to its stdout log.

const fs = require('node:fs');

const logPath = process.argv[2] || '/data/data/com.termux/files/home/.agy-web.log';
let content;
try {
  content = fs.readFileSync(logPath, 'utf8');
} catch (error) {
  console.error(`無法讀取 log：${logPath}\n${error.message}`);
  process.exitCode = 1;
  return;
}

const records = [];
const lines = content.split(/\r?\n/);
for (const line of lines) {
  const match = line.match(/^\[ToolMetrics\]\s+(\{.*\})\s*$/);
  if (!match) continue;
  try { records.push(JSON.parse(match[1])); } catch (_) {}
}

const numberValues = (key, rows = records) => rows
  .map(row => Number(row[key]))
  .filter(Number.isFinite)
  .sort((a, b) => a - b);

const quantiles = (values) => {
  if (!values.length) return null;
  const pick = ratio => values[Math.min(values.length - 1, Math.floor((values.length - 1) * ratio))];
  return {
    min: values[0],
    p50: pick(0.5),
    p90: pick(0.9),
    p95: pick(0.95),
    max: values[values.length - 1]
  };
};

const summary = {
  log: logPath,
  turns: records.length,
  by_reason: {},
  by_provider: {},
  client_closed_rate: 0,
  tool_events: records.reduce((sum, row) => sum + (Number(row.events) || 0), 0),
  unique_tools: records.reduce((sum, row) => sum + (Number(row.unique_tools) || 0), 0),
  executions: records.reduce((sum, row) => sum + (Number(row.executions) || 0), 0),
  polls: records.reduce((sum, row) => sum + (Number(row.polls) || 0), 0),
  retries: 0,
  timing_ms: {
    elapsed: quantiles(numberValues('elapsed_ms')),
    to_session: quantiles(records.map(row => row.turn_timing?.to_session_ms).filter(Number.isFinite).sort((a, b) => a - b)),
    to_first_text: quantiles(records.map(row => row.turn_timing?.to_first_text_ms).filter(Number.isFinite).sort((a, b) => a - b)),
    to_done: quantiles(records.map(row => row.turn_timing?.to_done_ms).filter(Number.isFinite).sort((a, b) => a - b))
  },
  context_tokens: {
    active: quantiles(records.map(row => row.context_stats?.active_tokens).filter(Number.isFinite).sort((a, b) => a - b)),
    total: quantiles(records.map(row => row.context_stats?.total_tokens).filter(Number.isFinite).sort((a, b) => a - b))
  },
  repeated_errors: {
    custom_tool_output_missing: lines.filter(line => line.includes('Custom tool call output is missing')).length,
    model_discovery_failed: lines.filter(line => line.includes('Dynamic model discovery error')).length,
    chat_error: lines.filter(line => line.includes('[Chat Error]')).length
  }
};

for (const row of records) {
  const reason = row.reason || 'unknown';
  summary.by_reason[reason] = (summary.by_reason[reason] || 0) + 1;
  const provider = row.provider || 'unknown';
  summary.by_provider[provider] = (summary.by_provider[provider] || 0) + 1;
}

summary.client_closed_rate = records.length
  ? Number(((summary.by_reason.client_closed || 0) / records.length).toFixed(4))
  : 0;
summary.retries = Math.max(0, summary.executions - summary.unique_tools);

console.log(JSON.stringify(summary, null, 2));
