# PR #39 execution feedback validation

Branch: `feat/execution-feedback-ux-20261008`. Follow-up to the existing UI changes; no main merge.

## Findings and fixes

- Excerpts previously included fenced code bodies, headings and inline Markdown. Skip code blocks/indented code/headings/tables, strip inline markup and preserve filename underscores.
- Historical tool records without terminal metadata previously displayed success. Display an unconfirmed state instead; missing duration stays hidden.
- Completed tools with nonzero exit codes previously displayed success. Show failure from actual exit/error data. Keep the active concurrent tool in the status label.
- Interrupted provider turns were normalized to completed/failed without preserving interruption. Preserve interruption, settle unfinished progress indicators, and retain partial content on SSE EOF/network failure.
- Automatic disconnection recovery accepted any longer historical answer, including previous turns. Replace that unsafe recovery with an explicit, owning-conversation-guarded history reload. Reconnection alone does not claim completion.
- Runtime completion metadata disappeared after history reload. Append separate feedback records under `~/.crew-pocket/execution-feedback/<provider>/<conversation>.jsonl`, enrich only exact response hashes within the request's timestamp interval. Do not edit provider transcripts, snapshots, settings or Role Memory. Unknown/no-timestamp history remains unconfirmed. Duplicate raw tool output is not stored.
- Closed live tool timelines previously rebuilt hidden rows on every event. Render them only when expanded; the state map continues collecting background events.
- Expanding a result exposed all tool steps before the answer. Keep the tool record section separately collapsed; give its summary a touch target and disclosure indicator.
- Collapse can disturb a user reading the current answer. Keep that result expanded and preserve its anchor when the user has scrolled into it. Actual WebView layout remains an outstanding acceptance check.
- Execution mode describes intent, not proof of file changes. Only confirmed successful tool events populate changed files; absent paths do not claim completed edits.

## Validation performed

- `node --check` on every changed executable JS file.
- `git diff --check origin/main...HEAD` and working/staged diff checks.
- `node test/execution-feedback.test.js`: excerpt handling; unknown/interrupted/failed tool display; duration/commit/check rendering; exact metadata matching; provider/conversation isolation; historical timestamps; transcript objects unchanged.
- `node test/execution-feedback-runtime.test.js`: a real isolated Node HTTP/SSE server with deterministic provider events. Completed, tool failure, provider error, interrupted turn, and client disconnect all pass; history preserves their metadata. Static JS has `Cache-Control: no-store`.
- `test/execution-feedback-stream.test.js` with jsdom: completed, clean EOF without done, provider interruption, user abort, network error, HTTP error and a background Role completion pass. Result is initially closed, full answer expands and tool records stay closed.
- Existing focused regressions: execution-result UI, Role navigation, Role Memory and Role queue/runtime tests.
- Running production Runtime read-only check: localhost responds and JS is served with `no-store`. Production Runtime was not restarted; tests used a separate port and temporary HOME/storage, which were cleaned up.

To run the DOM test without adding a production dependency:

```sh
node "$PREFIX/lib/node_modules/npm/bin/npm-cli.js" install --prefix "$PREFIX/tmp/crew-feedback-dom" jsdom@26 --no-audit --no-fund
NODE_PATH="$PREFIX/tmp/crew-feedback-dom/node_modules" node test/execution-feedback-stream.test.js
```

## Outstanding acceptance checks

Wireless Debugging currently has no connected device. The previously configured target refused the connection. No Android WebView screenshots or actual touch/layout checks have been obtained. The fixture tests do not constitute a live Codex/Antigravity end-to-end run.

Still verify on the APK: live tool progress with real provider data; repeated status changes; multi-tool density; Role/Conversation switch and return; scroll anchoring at completion; touch expansion; reload/reconnect; user stop and provider/tool errors. Commit/check badges are tested with supplied structured data; current Runtime does not infer them from answer text or terminal output, and omits them when unavailable.

**Merge readiness: pending Android WebView and live-provider acceptance.** Do not merge based solely on these automated results. Backend changes require a user-approved Runtime restart for production delivery; no APK rebuild is needed.
