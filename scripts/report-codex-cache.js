#!/usr/bin/env node
// Compare Codex prompt-cache usage from Crew's existing turn-metrics.jsonl.
// Whole-turn counters are only reported when the Codex thread baseline exists.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function summarize(records) {
  const turns = records.filter(row => row?.provider === 'codex' && row?.context_stats);
  const measured = turns.filter(row => {
    const stats = row.context_stats;
    return Number.isSafeInteger(stats.turn_input_tokens) &&
      Number.isSafeInteger(stats.turn_cached_input_tokens) &&
      stats.turn_input_tokens > 0 &&
      stats.turn_cached_input_tokens >= 0 &&
      stats.turn_cached_input_tokens <= stats.turn_input_tokens;
  });
  const sum = key => measured.reduce((acc, row) => acc + (row.context_stats[key] || 0), 0);
  const inputTokens = sum('turn_input_tokens');
  const cachedInputTokens = sum('turn_cached_input_tokens');
  const latency = measured.filter(row => Number.isFinite(row.elapsed_ms));
  const firstText = measured.filter(row => Number.isFinite(row.turn_timing?.to_first_text_ms));
  return {
    turnsSeen: turns.length,
    turnsMeasured: measured.length,
    inputTokens,
    cachedInputTokens,
    uncachedInputTokens: inputTokens - cachedInputTokens,
    cacheReadRate: inputTokens > 0 ? cachedInputTokens / inputTokens : null,
    meanTurnMs: latency.length
      ? Math.round(latency.reduce((acc, row) => acc + row.elapsed_ms, 0) / latency.length)
      : null,
    meanFirstTextMs: firstText.length
      ? Math.round(firstText.reduce((acc, row) => acc + row.turn_timing.to_first_text_ms, 0) / firstText.length)
      : null
  };
}

function readMetrics(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch (_) { return []; }
  });
}

function report(label, summary) {
  const rate = summary.cacheReadRate === null ? '—' : (summary.cacheReadRate * 100).toFixed(1) + '%';
  const ms = value => value === null ? '—' : value + 'ms';
  console.log(`${label}: ${summary.turnsMeasured}/${summary.turnsSeen} measurable Codex turns, ${summary.inputTokens} input, ${summary.cachedInputTokens} cached, ${rate} read, avg turn ${ms(summary.meanTurnMs)}, avg first text ${ms(summary.meanFirstTextMs)}`);
}

if (require.main === module) {
  const candidatePath = process.argv[2] || path.join(os.homedir(), '.crew-pocket', 'turn-metrics.jsonl');
  const baselinePath = process.argv[3] || null;
  try {
    const candidate = summarize(readMetrics(candidatePath));
    report('Current', candidate);
    if (baselinePath) {
      const baseline = summarize(readMetrics(baselinePath));
      report('Baseline', baseline);
      if (baseline.cacheReadRate !== null && candidate.cacheReadRate !== null) {
        console.log(`Cache read delta: ${((candidate.cacheReadRate - baseline.cacheReadRate) * 100).toFixed(1)} percentage points. Compare only matched Role/model/tasks and warm/cold conditions.`);
      }
    }
    if (!candidate.turnsMeasured) console.log('No whole-turn cache counters yet. Complete two turns in the same Codex thread, then retry.');
  } catch (error) {
    console.error(`Cache metrics report failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { summarize, readMetrics };
