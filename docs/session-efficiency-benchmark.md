# Session Efficiency: P0 telemetry + P1 offline A/B benchmark

This is an **observability and benchmark-only** layer. It does **not** change
AutoCompact thresholds, the compaction planner, Provider native sessions, Role
Memory, or MCP outputs. No extra LLM calls are made by the benchmark.

## What is collected

Crew Runtime already writes one `~/.crew-pocket/turn-metrics.jsonl`
record per turn and compaction decisions to
`~/.crew-pocket/auto-compact-telemetry.jsonl`.

P0 extends turn metrics with:

- `role_id`, `model` (existing provider and conversation IDs still apply)
- `context_stats.turn_output_tokens` when the Provider supplies whole-turn usage
- `read_fingerprints`: at most 64 **HMAC hashes**, generated with an
  ephemeral, per-process secret, from completed read/search calls.
  Commands, file paths, search text and tool output are **not** stored by
  this feature. Fingerprints cannot be linked across Runtime restarts.

Codex: `turn_input_tokens`, `turn_cached_input_tokens` and
`turn_output_tokens` use deltas of cumulative thread counters. After cold
resume, or if counters are absent, the unknown fields remain **null**. Native
Claude/AGY CLI may not expose these counters. Do not infer spending from
`active_tokens`, `last_input_tokens` or the context-window gauge.

The older `turn-metrics.jsonl` format remains readable. Raw traces are local
only and can contain other pre-existing metadata: **never upload them publicly**.

## P1: matched-session A/B comparison

Run the *same task* in two **independent conversations** with the same
Provider, model, task inputs, workspace revision, and cache condition.
Capture the JSONL logs of both runs separately. Run multiple repetitions
for meaningful comparisons; include cold and warm cache conditions in
separate cases. Evaluate actual task success outside the model (tests,
expected artifacts, manual review). Do **not** use `reason: completed` as
proof of correct task completion.

Create `benchmark-manifest.json` (IDs here are examples):

```json
{
  "version": 1,
  "cases": [
    {
      "id": "read-and-fix-regression-01",
      "provider": "codex",
      "model": "gpt-6",
      "cacheCondition": "warm",
      "baseline": {
        "conversationId": "baseline_thread_id",
        "taskSuccess": true
      },
      "candidate": {
        "conversationId": "candidate_thread_id",
        "taskSuccess": true
      }
    }
  ]
}
```

Capture the native `turn-metrics.jsonl` and
`auto-compact-telemetry.jsonl` from the respective runs. Include compaction
logs if measuring reacquisition. Run:

```sh
node scripts/benchmark-session-efficiency.js \
  --manifest benchmark-manifest.json \
  --baseline baseline-turn-metrics.jsonl \
  --candidate candidate-turn-metrics.jsonl \
  --baseline-compactions baseline-auto-compact-telemetry.jsonl \
  --candidate-compactions candidate-auto-compact-telemetry.jsonl \
  --out benchmark-report.json
```

The compaction arguments are optional. A baseline with AutoCompact disabled
compared to a candidate with AutoCompact enabled is one reasonable experiment.
Because the benchmark does **not** execute models itself, snapshots must come
from **real, independently performed runs**, not fabricated provider traces.

### Optional cost estimation

Input-token counts alone are *not* API cost. Different Providers and
subscriptions have different pricing; cached reads and output tokens differ
from uncached input. To compute USD estimates, pass a private JSON pricing file
with **your** actual per-million-token rates:

```json
{
  "codex/gpt-6": {
    "inputPerMillion": 0,
    "cachedInputPerMillion": 0,
    "outputPerMillion": 0
  }
}
```

The zero values above are **placeholders only**; replace all of them with
verified, applicable nonnegative prices. Do not use placeholder rates in
reports. Append `--pricing actual-pricing.json` to the command.

Costs remain `null` if any required token counter or price is missing.
For subscription-based CLI usage, measured Tokens and latency are generally
more meaningful than hypothetical API spend.

### Interpreting the output

- `inputTokens` / `cachedInputTokens`: totals for the **entire measured
  session**, only when *every* turn provides the corresponding counters.
- `suspectedReads`: number of matching read fingerprints before/after a
  completed compaction, within 3 turns and 30 minutes. This is a **heuristic**,
  not evidence that compaction caused extra calls. Unchanged file paths can be
  re-read for legitimate reasons, and restarts lose fingerprint comparability.
- `estimatedCostDelta`: candidate vs baseline only with complete output,
  input, cache, and pricing data.
- `taskSuccess`: must be supplied from external ground truth. **Unknown
  success is not success.**
- `acceptance`: `inconclusive` if any pair lacks success labels or
  complete cost estimates; `fail` for known success regression. With complete
  evidence, the initial proposed gate is: no regression, at least 10% mean
  estimated-cost improvement, and no individual latency regression >20%.
  This is an engineering threshold, **not** an empirically proven optimum.

For longer-lived work, additionally compare P95 latency and costs per
successful task across several matched repetitions. The CLI currently
provides pairwise and mean results; no statistical significance is claimed.

## Design constraints

1. Keep P0 non-invasive; **do not** insert an output-compression proxy in
   the native Codex, AGY, or Claude transport.
2. Leave the KEEP / SUMMARIZE / DROP / RERETRIEVE planner unchanged.
3. Never share context or memory between Roles as part of benchmarking.
4. Do not log Tool output, user prompts, raw tool arguments, or raw read paths.
5. Keep pricing and success as external ground truth, not heuristic defaults.
6. Only propose P2 efficiency-aware automatic decisions after matched runs
   establish actual improvements.

Run tests:

```sh
node --test test/session-efficiency.test.js
node --test test/codex-usage.test.js
```
