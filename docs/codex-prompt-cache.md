# Codex Prompt Cache: validation

Crew Pocket uses Codex app-server and the provider's native thread history.
There is no extra application-side KV cache. This feature measures what Codex
actually reports through `thread/tokenUsage/updated` or its session JSONL.

## Check from the app

1. Open a Codex Role and send a task. In **Context Health**, look for
   **Codex Prompt Cache**.
2. Continue in that **same** Role/conversation with a second task.
3. Inspect **Current turn · all model calls** if a cumulative baseline was
   available, otherwise **Latest model call**. A missing field appears as **—**;
   it must not be interpreted as zero cache reuse.
4. Switch to a different Role and back. Cached-token values must follow the
   corresponding conversation and not leak across Roles.
5. After a native `/compact`, check that memories are refreshed once and
   the conversation remains usable. Cache reuse may decrease because
   compaction changes the prefix.

For a controlled comparison, use the same model, reasoning effort, Role,
workspace, tool configuration, and comparable requests. Repeat cold and warm
runs, keeping the interval within the model's applicable cache lifetime.
Account for model variance and network load; a smaller latency on one run
does not prove the cache caused it.

## Measure

Crew already persists per-turn observations to
`~/.crew-pocket/turn-metrics.jsonl`. Codex rows now include last-call, thread,
and (when an earlier thread total is known) whole-turn cache readings.

```bash
node --test test/codex-usage.test.js
node scripts/report-codex-cache.js
node scripts/report-codex-cache.js /path/to/candidate.jsonl /path/to/baseline.jsonl
```

The report computes a **token-weighted** cache read rate using only complete
whole-turn samples. It also prints average elapsed time and time to first
text, but it does **not** calculate cost savings or claim a causal
improvement. If a resumed Codex thread has no known prior cumulative usage,
its first turn cannot be measured as a whole; the latest model-call metrics
can still appear in the UI.

## Compatibility and boundaries

- Old Codex releases may not return `cacheWriteInputTokens`; show **—**.
- Reads, writes, and input tokens are separate counters. "Not cached" means
  input minus cache reads and can include input written to the cache.
- `/compact` or changing model/effort/tools may change the shared prefix.
- Codex Runtime warmup only starts the process. It does not warm the
  model's prompt cache.
- Role memory, private workspaces, and Crew messages remain Role-scoped.
  New threads receive Role/Project/Memory; subsequent Crew replies normally
  carry only the explicit message, except after compaction.
