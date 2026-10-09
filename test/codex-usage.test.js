const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCacheUsage, withTurnCacheUsage } = require('../lib/providers/codex-usage');

test('reads latest-call and cumulative counters with optional write usage', () => {
  const usage = normalizeCacheUsage({
    last: { inputTokens: 82000, cachedInputTokens: 76000, cacheWriteInputTokens: 3000 },
    total: { inputTokens: 100000, cachedInputTokens: 80000, cacheWriteInputTokens: 5000 }
  });
  assert.equal(usage.last_cached_input_tokens, 76000);
  assert.equal(usage.last_uncached_input_tokens, 6000);
  assert.equal(usage.last_cache_write_input_tokens, 3000);
  assert.ok(Math.abs(usage.last_cache_read_rate - 76000 / 82000) < 1e-10);
  assert.equal(usage.total_cache_read_rate, 0.8);
});

test('supports older snake_case Codex session JSONL', () => {
  const usage = normalizeCacheUsage({
    last_token_usage: { input_tokens: 1500, cached_input_tokens: 1000 },
    total_token_usage: { input_tokens: 1800, cached_input_tokens: 1000 }
  });
  assert.equal(usage.last_uncached_input_tokens, 500);
  assert.equal(usage.last_cache_write_input_tokens, null);
  assert.equal(usage.total_input_tokens, 1800);
});

test('does not mislabel missing usage as zero hits', () => {
  const usage = normalizeCacheUsage({});
  assert.equal(usage.last_input_tokens, null);
  assert.equal(usage.last_cache_read_rate, null);
  assert.equal(usage.total_cache_read_rate, null);
  assert.equal(normalizeCacheUsage({ last: { inputTokens: 0, cachedInputTokens: 0 } }).last_cache_read_rate, null);
});

test('whole turn is the delta of cumulative thread usage across model calls', () => {
  const previous = normalizeCacheUsage({
    total: { inputTokens: 50000, cachedInputTokens: 35000, cacheWriteInputTokens: 2000 }
  });
  const after = normalizeCacheUsage({
    last: { inputTokens: 5000, cachedInputTokens: 4000, cacheWriteInputTokens: 300 },
    total: { inputTokens: 80000, cachedInputTokens: 59000, cacheWriteInputTokens: 4000 }
  });
  const result = withTurnCacheUsage(after, previous);
  assert.equal(result.turn_input_tokens, 30000);
  assert.equal(result.turn_cached_input_tokens, 24000);
  assert.equal(result.turn_uncached_input_tokens, 6000);
  assert.equal(result.turn_cache_write_input_tokens, 2000);
  assert.equal(result.turn_cache_read_rate, 0.8);
  assert.equal(after.last_cache_read_rate, 0.8);
});

test('unknown baseline / reset / partial metrics do not invent turn totals', () => {
  const current = normalizeCacheUsage({ total: { inputTokens: 100, cachedInputTokens: 20 } });
  assert.equal(withTurnCacheUsage(current, null).turn_cache_read_rate, undefined);
  assert.equal(withTurnCacheUsage(current, { total_input_tokens: 200, total_cached_input_tokens: 50 }).turn_cache_read_rate, undefined);
  assert.equal(withTurnCacheUsage(current, { total_input_tokens: 20 }).turn_cache_read_rate, undefined);
});

const { summarize } = require('../scripts/report-codex-cache');

test('cache benchmark only aggregates complete comparable turn samples', () => {
  const summary = summarize([
    { provider: 'codex', elapsed_ms: 1000, turn_timing: { to_first_text_ms: 400 }, context_stats: { turn_input_tokens: 1000, turn_cached_input_tokens: 800 } },
    { provider: 'codex', elapsed_ms: 2000, turn_timing: { to_first_text_ms: 600 }, context_stats: { turn_input_tokens: 2000, turn_cached_input_tokens: 1500 } },
    { provider: 'codex', elapsed_ms: 900, context_stats: { last_input_tokens: 500 } },
    { provider: 'antigravity', context_stats: { turn_input_tokens: 999, turn_cached_input_tokens: 999 } }
  ]);
  assert.equal(summary.turnsSeen, 3);
  assert.equal(summary.turnsMeasured, 2);
  assert.equal(summary.inputTokens, 3000);
  assert.equal(summary.cachedInputTokens, 2300);
  assert.equal(summary.uncachedInputTokens, 700);
  assert.equal(summary.meanTurnMs, 1500);
  assert.equal(summary.meanFirstTextMs, 500);
});
