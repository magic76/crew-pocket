// Codex app-server reports usage for the latest model call and for the
// entire thread. Never turn an absent field into a misleading zero.
function count(source, camel, snake) {
  if (!source || typeof source !== 'object') return null;
  const value = source[camel] ?? source[snake];
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
}

function breakdown(source) {
  const input = count(source, 'inputTokens', 'input_tokens');
  const cachedRaw = count(source, 'cachedInputTokens', 'cached_input_tokens');
  const cacheWriteRaw = count(source, 'cacheWriteInputTokens', 'cache_write_input_tokens');
  const cached = input === null || cachedRaw === null ? cachedRaw : Math.min(cachedRaw, input);
  const cacheWrite = input === null || cacheWriteRaw === null ? cacheWriteRaw : Math.min(cacheWriteRaw, input);
  return {
    input,
    cached,
    // This includes tokens newly written to cache (if any).
    nonCached: input === null || cached === null ? null : input - cached,
    cacheWrite,
    readRate: input === null || cached === null || input === 0 ? null : cached / input
  };
}

function normalizeCacheUsage(tokenUsage = {}) {
  const last = breakdown(tokenUsage.last ?? tokenUsage.last_token_usage);
  const total = breakdown(tokenUsage.total ?? tokenUsage.total_token_usage);
  return {
    last_input_tokens: last.input,
    last_cached_input_tokens: last.cached,
    last_uncached_input_tokens: last.nonCached,
    last_cache_write_input_tokens: last.cacheWrite,
    last_cache_read_rate: last.readRate,
    total_input_tokens: total.input,
    total_cached_input_tokens: total.cached,
    total_uncached_input_tokens: total.nonCached,
    total_cache_write_input_tokens: total.cacheWrite,
    total_cache_read_rate: total.readRate
  };
}

// A single Crew turn can contain several Codex model calls. Comparing thread
// totals across turn boundaries measures the *whole* turn when a baseline is
// available. After a cold resume without a baseline, report latest-call data
// instead of inventing a turn total.
function withTurnCacheUsage(stats, baseline) {
  if (!stats || !baseline) return stats;
  const input = stats.total_input_tokens;
  const cached = stats.total_cached_input_tokens;
  const prevInput = baseline.total_input_tokens;
  const prevCached = baseline.total_cached_input_tokens;
  if (![input, cached, prevInput, prevCached].every(Number.isSafeInteger)) return stats;
  const turnInput = input - prevInput;
  const turnCached = cached - prevCached;
  if (turnInput < 0 || turnCached < 0 || turnCached > turnInput) return stats;
  const writes = stats.total_cache_write_input_tokens;
  const prevWrites = baseline.total_cache_write_input_tokens;
  const turnWrites = Number.isSafeInteger(writes) && Number.isSafeInteger(prevWrites) && writes >= prevWrites
    ? writes - prevWrites
    : null;
  return {
    ...stats,
    turn_input_tokens: turnInput,
    turn_cached_input_tokens: turnCached,
    turn_uncached_input_tokens: turnInput - turnCached,
    turn_cache_write_input_tokens: turnWrites,
    turn_cache_read_rate: turnInput > 0 ? turnCached / turnInput : null
  };
}

module.exports = { normalizeCacheUsage, withTurnCacheUsage };
