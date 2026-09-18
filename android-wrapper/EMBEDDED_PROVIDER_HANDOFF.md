# Embedded Provider Migration Handoff

## Current state

- Branch: `feature/agent-runtime`.
- Conversation data has been copied into Crew Pocket APK private storage:
  - AGY brain: `files/.gemini/antigravity-cli/brain`
  - Codex sessions: `files/.codex/sessions`
  - Crew Pocket settings and live memos: `files/.crew-pocket/`
- The Termux source data remains intact. Migration is copy-only.
- The Android wrapper currently keeps ordinary chat on the Termux host after data migration. This is intentional protection against accepting messages with no provider reply.
- `embedded_history_migrated=true` marks completed data migration.
- `embedded_runtime_enabled` is deliberately unset/false. Do not enable it until the checks below pass.

## What works in the embedded runtime

- Embedded Node can serve the Crew Pocket UI on localhost:8000.
- Embedded Codex bridge uses localhost:8767. Port 8766 must remain unused by Crew Pocket because Crew Helper owns it.
- Existing AGY and Codex history is readable from APK private storage.

## Blocking provider work

### Antigravity / AGY

The embedded Node environment has no `agy` executable, so provider calls fail (`agy models` cannot run). Bundle or replace the AGY runtime so it works with APK-private `HOME`, `BRAIN_DIR`, and configuration.

### Codex

The embedded Codex bridge starts, but APK-private Codex has no completed account login. Do not copy or expose credentials through logs. Implement an APK-local sign-in/device-login flow, then verify the bridge can complete `account/read` and a real turn.

## Required verification before enabling embedded runtime

1. With Termux still installed, start embedded Node and verify both providers can complete a short new chat turn.
2. Verify SSE text streaming, tool events, cancellation, history loading, and a new conversation for both providers.
3. Stop Termux. Confirm `/api/runtime/status` reports:

   ```json
   {
     "host": { "runtime": "embedded-node" },
     "codex": { "transport": "embedded-android-bridge" }
   }
   ```

4. Reopen the APK with Termux stopped and repeat the chat checks.
5. Only then persist `embedded_runtime_enabled=true` and remove the fallback guard in `CrewRuntimeService` if it is no longer useful.

## Relevant files

- `android-wrapper/app/src/main/java/com/crewpocket/app/CrewRuntimeService.kt`
- `android-wrapper/app/src/main/java/com/crewpocket/app/EmbeddedNodeHost.kt`
- `android-wrapper/app/src/main/java/com/crewpocket/app/EmbeddedCodexBridge.kt`
- `android-wrapper/app/src/main/java/com/crewpocket/app/EmbeddedWorkspaceManager.kt`
- `android-wrapper/app/src/main/java/com/crewpocket/app/TermuxBridge.kt`
- `lib/runtime/history-migration.js`
- `lib/runtime/codex-transport.js`
