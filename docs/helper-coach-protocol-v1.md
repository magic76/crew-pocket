# Helper Coach v1 — shared protocol and implementation status

Status: **Pocket side implemented; Android Helper Runtime adapter is not yet available.** The Pocket event API and state machine are exercised with an integration Mock Adapter. The mock does not operate Android and is not evidence that Maps navigation or Apple Music playback works on a device.

## Goal
Crew Pocket acts as a teacher; Crew Helper owns Android permissions, executes actions, and reports evidence. Pocket may diagnose, suggest an existing skill, propose a new skill, or propose a source-code patch. Pocket never silently changes Helper's code, installs an APK, or executes privileged operations.

## Transport and trust
- Same-device loopback only (127.0.0.1); never bind to 0.0.0.0. Pocket uses its existing local HTTP server and serves `/api/helper-coach/events`; it does not open another listener. Helper must call `http://127.0.0.1:8000/api/helper-coach/events` from the same phone.
- Repository discovery at `magic76/crew-helper` commit `ecc79d9f51dbca44c83d3f311dfd2243077ffb53` found an existing Android [`AccessibilityBridgeServer`](https://github.com/magic76/crew-helper/blob/ecc79d9f51dbca44c83d3f311dfd2243077ffb53/app/src/main/java/com/crewpocket/helper/AccessibilityBridgeServer.java) on `127.0.0.1:8766`. That is Helper's private action bridge, guarded by its app-private [`X-Crew-Bridge-Token`](https://github.com/magic76/crew-helper/blob/ecc79d9f51dbca44c83d3f311dfd2243077ffb53/app/src/main/java/com/crewpocket/helper/AppConfig.java); it is not a Coach event/advice API. Pocket must not call it directly or obtain/expose that token. The old external-server mode is removed. Coach telemetry is Helper-to-Pocket over Pocket's existing port 8000; Helper remains the only action executor.
- Explicit user opt-in. Pocket creates a per-install secret and stores it in `~/.crew-pocket/helper-coach-v1.json` with owner-only permissions. Helper must store the secret in app-private storage. Sign each request as HMAC-SHA256 over `<timestamp>\n<nonce>\n<exact raw body>` using headers `X-Crew-Coach-Timestamp`, `X-Crew-Coach-Nonce`, and `X-Crew-Coach-Signature` (lowercase hex). Pocket enforces a two-minute clock window, one-time nonces, unique event IDs, 16 KiB event bodies, and an in-memory per-minute rate limit.
- No raw passwords, OTPs, payment fields, account tokens, microphone recordings, search/destination text or unrestricted screenshots in coaching telemetry. Helper should send only redacted UI summaries and opaque local evidence references; Pocket removes common sensitive labels, URLs, long numeric sequences, and unrecognized error, rejection, or verification codes before persistence. No screenshot endpoint exists in Coach v1.
- Helper Runtime is sole executor. Pocket outputs structured advice, never raw shell/ADB commands as executable instructions.

## Message envelope
All messages have: `protocol_version: 1`, `event_id`, `task_id`, `timestamp` (ISO 8601), `source` (`helper` or `pocket`), and `kind`.

### Helper -> Pocket
`task_observation`: `task_type` (`maps.navigation|apple_music.search_play`), `app_package`, `app_version`, `ui_signature`, `step_index`, `ui_summary` (redacted; no destination or search text is required), `available_actions` (Runtime-advertised action identifiers), `previous_action`, `result` (`success|failed|unknown`), `error_code`, `failure_attribution` (`runtime_defect|interaction_issue|unknown`), and `evidence_refs` (opaque local ephemeral references only).

`advice_validation`: `observation_event_id`, `advice_event_id`, `suggested_action_id`, `accepted`, `user_confirmed`, `ui_signature`, optional `rejection_code`. This is required before Helper may execute the suggested action.

Supported action identifiers are `maps.focus_search`, `maps.enter_destination`, `maps.select_destination`, `maps.start_navigation`; `apple_music.focus_search`, `apple_music.search_catalog`, `apple_music.select_track`, `apple_music.play_selected`; and recovery controls `common.return_to_target_app`, `common.retry_last_action`, `common.focus_visible_control`, `common.request_user_confirmation`. User destinations and music queries stay in Helper Runtime; Pocket receives no search text or destination field. Every suggestion must still be in the exact current `available_actions` list.

`task_outcome`: `verified` boolean, `verification_method`, `duration_ms`, `skill_id` (optional), `evidence_refs`.

### Pocket -> Helper
`coach_advice`: `observation_event_id`, `ui_signature`, `diagnosis`, `suggested_action_id` (must be in available_actions), `expected_postcondition`, `confidence` (0..1), `expires_at`, `requires_user_confirmation`.

`skill_candidate`: `skill_id`, `app_package`, `preconditions`, `action_sequence` (only allowlisted Runtime actions), `postconditions`, `evidence_refs`, `status: candidate`.

`code_change_proposal`: `repository`, `diagnosis`, `reproduction_steps`, `test_plan`, `proposed_diff_ref` (PR or patch reference). No automatic merge or install.

## State machine
`observed -> diagnosed -> advice_proposed -> runtime_validated -> executed -> outcome_verified -> candidate_recorded`.
Failure, timeout, changed foreground app or expired advice -> `aborted` and re-observe. Never assume a tap implies success.

Pocket Coach v1 currently uses a deterministic, bounded diagnostic policy for these two task templates. Advice is an action identifier and a postcondition; Pocket has no device-action executor. The Runtime must advertise the action on the current screen, validate it against the current app/UI signature, report validation, execute it once, then send a new observation. Pocket stops after three failed retries. Unknown/unadvertised actions produce no executable advice.

## Skill promotion
- Candidate skills remain inactive by default.
- Promotion requires two different successful task IDs with distinct outcome event IDs, explicit scope (package/version/UI signature), and an allowlisted Runtime verification method. A matching failed outcome demotes a Helper-validated skill back to candidate.
- Do not use an unverified coach recommendation to bootstrap its own verification.
- Keep provenance (task ID, observations, model/role version, verification method). Do not equate a model's verbal claim with an Android state assertion.

## First end-to-end acceptance (Runtime work still required)
1. Helper runs Google Maps task with existing Runtime; a controlled failure emits redacted `task_observation`.
2. Pocket receives authenticated event and suggests only a currently available Runtime action.
3. Helper validates preconditions, executes once, then independently checks the postcondition.
4. Both sides record same task ID; candidate stays inactive until promotion criteria.
5. Test invalid auth, stale/duplicate advice, unexpected action ID, UI change, sensitive-screen redaction, offline Pocket and timeout; Helper must continue functioning without Pocket.
6. Repeat for Apple Music, verifying playback state rather than only opening the app.

## Implementation gates
1. Inspect existing Helper Connected Server Mode, Crew Experience and Pocket bridge/role/memory; reuse existing interfaces.
2. Implement authenticated loopback event ingestion and read-only coaching first.
3. Add Runtime action allowlist and postcondition verification.
4. Add candidate skill storage and review UI.
5. Separately implement code-change proposals as PRs with tests and explicit approval, never direct APK mutation.

## Pocket implementation
- `lib/helper-coach/protocol.js`, `engine.js`, `service.js`, `store.js`, and `http.js` implement the Pocket-side v1 boundary and local ledger.
- `lib/skills/registry.js` stores scoped candidates and only activates after two distinct authenticated verified task outcomes. Successful evidence is also retained in the existing Role Memory store with `TOOL` provenance.
- `role-helper-coach` is seeded as a non-deletable built-in Role. The Growth Center is backed only by this local event/skill ledger; empty state has no sample metrics. A valid signed v1 event is the only signal that the paired Runtime supports the protocol; the UI does not infer support from pairing alone.
- `lib/helper-coach/code-pr.js` accepts only explicitly confirmed diffs under Helper Java source/test directories, clones `magic76/crew-helper` into a temporary checkout, runs `git diff --check` and `./gradlew testDebugUnitTest --no-daemon`, pushes an isolated branch, then opens a Draft PR. It never merges, deploys, or installs. A Runtime-attributed failure automatically creates a source-review suggestion; the user reviews/refines its diagnosis and supplies the patch before the isolated test/PR step. This workflow has not opened a real Helper PR in the absence of such a task.
- Run focused checks with `node --test test/helper-coach.integration.test.js`; the Mock Adapter covers the HTTP route, HMAC, replay/stale advice, Maps/Apple Music flows, bounded retries, provenance and code-patch allowlists. These tests do not validate a physical phone/app.
- Local UI routes are `/api/helper-coach/dashboard`, `/pair`, `/revoke`, `/code-proposals`, and `/code-pr`; pairing/configuration POSTs require a same-origin browser action. The Helper event endpoint is `/api/helper-coach/events`, loopback-only and HMAC-authenticated.

## Required Helper Runtime work
The current `magic76/crew-helper` Bridge exposes its existing authenticated operations but has no Coach event or advice-validation API. Before a physical task can run, Helper must add an explicit opt-in Coach pairing screen separate from the 8766 bridge token; store the Coach key privately; sign outbound event requests with nonce/timestamp; emit the redacted envelope above with app version, UI signature and current task-specific action allowlist; validate advice expiry/action/UI state before each execution; confirm any system permission request; and emit `advice_validation`, fresh observations, and task-specific outcome verifiers. It must report `navigation_active` (a planned route alone is not enough) and require `playback_active_and_track_matches` for Apple Music.

Helper must also report task failure attribution only from its Runtime diagnosis. A user interaction problem cannot create a code-fix task. For Maps the success verifier must be `navigation_active` (a route preview is not enough); for Apple Music it must be `playback_active_and_track_matches`. The next cross-repository work is a canonical Helper contract/API implementation and its Android tests; this Pocket PR does not modify the Helper repository.
