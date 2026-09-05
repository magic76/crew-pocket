# Crew Pocket Web Workspace

Crew Pocket is the mobile-first PWA and local Node.js service in this repository. It runs on Android Termux and supports Antigravity (`agy`) and OpenAI Codex.

## Scope and Architecture

- `server.js` owns HTTP/SSE routes, provider dispatch, local bridge integration, and persistence entry points.
- `lib/` contains providers, resident sessions, conversation settings, history, device adapters, and storage helpers.
- `public/index.html` is the shell. `public/js/` owns client UI, chat/history, Live voice, tools, and PWA behavior.
- `public/manifest.json`, `public/sw.js`, and `scripts/prepare-pwa-cache.js` must stay in sync for deployable PWA changes.
- `crew-helper` is an independent project. Do not edit, stage, or assume its files unless the user explicitly asks.

## Required Behavior

- Preserve conversation histories, `transcript.jsonl`, `transcript_full.jsonl`, compact snapshots, and user settings. Never regenerate or truncate history as a side effect of a UI change.
- A conversation's provider, model, workspace, and role are scoped to that conversation. Do not let a previous conversation's state leak into the next one.
- Live voice must clean up WebSocket, media tracks, audio contexts, timers, and UI state on every termination path. Do not interrupt an active Live call or text stream for unrelated work.
- A workspace switch changes only the target conversation's next AI session. Validate paths under Termux Home and close only the affected resident session when needed.

## PWA and UI Delivery

- After changing `public/` JavaScript, CSS, HTML, manifest, icons, or service-worker inputs, run `node scripts/prepare-pwa-cache.js` then `node scripts/prepare-pwa-cache.js --check`.
- Do not hand-edit generated cache revisions in `public/sw.js`; update `scripts/prepare-pwa-cache.js` when the cache asset set changes.
- For app icons, keep 1024, 512, and 192 variants aligned with the manifest, favicon, Apple touch icon, splash image, and service-worker cache list.
- Keep mobile UI touch-first, compact, and readable. Avoid visual redesign outside the requested surface.

## Verification and Operations

- For JavaScript changes, run `node --check` on each touched executable file and `git diff --check`.
- For server routes or provider/session changes, verify the relevant local helper or focused endpoint when the running service state permits.
- Never restart `start-web.sh`, terminate a running server, install or replace an APK, or close active sessions without the user's explicit approval.
- Before a commit, inspect staged changes and exclude unrelated hunks. Commit and push only when requested.

## Crew Pocket-Specific Capabilities

- Do not web-search to explain Crew Pocket itself; this repository is the primary source of truth.
- Screen inspection uses `POST http://127.0.0.1:8000/api/phone/screenshot`; camera inspection uses `POST http://127.0.0.1:8000/api/phone/photo`. Only inspect a newly successful capture.
- Interactive tools require a complete self-contained HTML sandbox. Charts use Chart.js. Maps use Google Maps links.
- When the user asks to install, update, or test an Android APK: ALWAYS execute `~/install-apk.sh <path-to-apk>`. APK management strictly uses Wireless Debugging (ADB) for silent, background installation and real-time logcat debugging. If `~/install-apk.sh` exits with an error (ADB offline / not configured), immediately inform the user that Wireless Debugging is closed or the Port changed, and ask the user to turn on Wireless Debugging in Developer Options and provide the current Port (or run `~/set-adb.sh <port>`).
- When the user mentions another conversation using `[@Title](conversation://<conversation-id>)` with an instruction to delegate or transfer a message/task to it:
  1. Inspect the referenced conversation's transcripts under `/data/data/com.termux/files/home/.gemini/antigravity-cli/brain/<conversation-id>/.system_generated/logs/transcript.jsonl` if context is needed.
  2. You can delegate or enqueue the task to the target conversation via HTTP `POST http://127.0.0.1:8000/api/tasks` with `{ action: "create", conversation_id: "<conversation-id>", task: "<task message>" }`, or spawn a subagent referencing that conversation ID.
  3. Respond with a clear confirmation and a clickable link `[<Title>](conversation://<conversation-id>)` for easy navigation.
