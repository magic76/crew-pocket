# Crew Pocket AT-AT P0: trace-driven Tool Improvements

This is an **advisory, fail-closed** tool-improvement loop. It does not modify provider tools, MCP servers, Skill.md, runtime policies, or production output.

## Existing sources reused

- Terminal **execution feedback** already records request/conversation IDs, tool group, states, attempts, and errors under ~/.crew-pocket/execution-feedback/.
- Existing **turn-metrics.jsonl** provides duration and token usage where measured. Provider completion is not task success.
- Provider histories and **Context Archive** retain original evidence. AT-AT never overwrites raw outputs nor duplicates private tool arguments/output.
- Existing **Role DNA / Dreaming / MCP memory** pipelines are left intact. Agent strategy belongs in Skill/Experience; tool issues get Tool Improvement candidates; harness/environment issues remain diagnostics.

## Flow

1. After saveExecutionFeedback succeeds for a terminal turn, inspect bounded tool metadata (no new model).
2. Root causes: AGENT_STRATEGY, HARNESS, TOOL_DESCRIPTION, TOOL_SCHEMA, TOOL_OUTPUT, TOOL_ERROR, MISSING_CAPABILITY, ENVIRONMENT, UNKNOWN.
3. Only high-signal, tool-attributed evidence yields description/schema/output/error candidates. A task failure alone does not imply a faulty tool.
4. Missing capability detection requires an explicit atomicTask=true, trusted atomicTaskKey, 3 different request IDs, and 3–8 tool steps. Ordinary adjacency is not evidence of an atomic task.
5. Store candidates in ~/.crew-pocket/tool-improvements.json (0600). Dedupe on tool + type + normalized problem. Provenance points at existing execution feedback; reference counts are bounded observed counts.
6. Keep production tool contracts and proposals separate. A proposal hash is not deployed tool code.

## HTTP API (existing Crew authorization)

- GET /api/tool-improvements
- GET /api/tool-improvements/{id}
- POST /api/tool-improvements/{id}/reject
- POST /api/tool-improvements/{id}/evaluate returns 422 insufficient-data until a trusted replay runner is configured. A remote HTTP caller cannot supply fabricated replay measurements.

There is deliberately no promotion endpoint and no large UI for P0.

## Offline historical replay

Run on a trusted local machine:

    node scripts/evaluate-tool-improvement.js <candidate-id> <historical-cases.json> <trusted-runner.js>

An operator-provided runner exports async runCase({task, variant, toolHash, candidateId}). It MUST execute the same immutable historical snapshot on the selected pinned baseline/candidate tool implementation and return measured values including toolHash (actually executed SHA-256), taskSuccess (boolean), toolErrorRate, retries, toolCalls, tokens, latencyMs and recoveryCount.

Historical case JSON is an array with at least one distinct ID in each group: source, similar, regression (held-out unrelated). Each case has id, group, and snapshotHash (SHA-256). It is not acceptable to test only the originating failure. The operator is responsible for a real replay adapter and genuine task snapshots; the prototype has no automatic live-tool adapter.

A missing/mismatched tool hash, missing task snapshot/group, missing metrics or failed runner yields insufficient-data. Held-out task success becoming failure yields regressed. Only measured improvement with no regressions and pinned tool versions can become validated; validated never becomes promoted in P0.

## Current limitations

- Existing streams do not always expose output length, machine-readable errors, confirmed task outcomes or immutable tool-version hashes; these remain unknown rather than fabricated.
- Whole-turn duration is not per-tool latency. Repeated adjacent tool calls alone do not prove an atomic task.
- Output shaping and error suggestions are candidates only. They never modify raw provider history, the Context Archive or production tools.
