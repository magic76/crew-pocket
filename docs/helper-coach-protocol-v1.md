# Helper Coach v1 — Pocket / Helper Bridge contract

Status: Pocket's client now targets the Helper Runtime Bridge in `magic76/crew-helper` PR #205. Unit and Mock Bridge integration checks do not prove that either Android app is installed, paired, or operating real Maps / Apple Music tasks.

## Ownership and transport

- Helper is the only Android action executor. Pocket is a client of Helper's existing loopback Bridge at `http://127.0.0.1:8766`; Pocket never reads or sends the existing `X-Crew-Bridge-Token`.
- The user enables Helper Coach in Helper's Crew Experience, copies its 64-character hex Coach secret, and pastes it into Pocket. Pocket stores the key in `~/.crew-pocket/helper-coach-v1.json` with owner-only file permissions. Pairing does not generate or display a replacement key.
- Pocket polls every 2.5 seconds while paired. It requests `GET /coach/v1/events?since_event_id=<exclusive cursor>&limit=20`, deduplicates by `event_id`, advances to `next_cursor`, and drains pages while `has_more` is true. If Helper's bounded feed has aged out a cursor, Pocket safely replays retained events and relies on event-ID deduplication.
- Every Bridge request is HMAC-SHA256 signed with `X-Coach-Timestamp` (epoch milliseconds), `X-Coach-Nonce` (UUID/hex), and lowercase-hex `X-Coach-Signature`. The canonical string is `UPPER_METHOD\nexact request-target including query\ntimestamp\nnonce\nlowercase SHA256(raw body)`. Helper enforces a 60-second clock window, nonce replay protection, loopback access and a 32 KiB request limit. Pocket also caps Bridge responses at 32 KiB.
- Pocket does not open a new listener or expose the Helper secret in its dashboard response. The browser only submits the key to Pocket's same-origin pairing route; Pocket performs Bridge requests from the local Node runtime.

## Helper event feed

The feed response is `{protocol_version, events, has_more, next_cursor}`. `since_event_id` is exclusive. Pocket accepts only these Helper event kinds and exact fields:

- `task_observation`: `protocol_version`, `event_id`, `task_id`, `timestamp`, `source`, `kind`, `app_package`, `goal`, `step_index`, structural `ui_summary`, `available_actions`, `active_skills`, string `previous_action`, `result`, `error_code`, `evidence_refs`.
- `task_outcome`: `protocol_version`, `event_id`, `task_id`, `timestamp`, `source`, `kind`, `app_package`, `verified`, `verification_method`, `duration_ms`, `result`, `error_code`, `evidence_refs`.
- `coach_action_result`: `protocol_version`, `event_id`, `task_id`, `timestamp`, `source`, `kind`, `observation_event_id`, `advice_event_id`, `suggested_action_id`, `status` (`executed|failed|cancelled`), `runtime_action_success`, `error_code`, `evidence_refs`.

GoalIntent is a closed category: `MEDIA:PAUSE`, `MEDIA:NEXT`, `MEDIA:PREVIOUS`, `NAVIGATION:START`, `MEDIA:PLAY`, `MESSAGE:SEND`, `TEXT:TYPE_ONLY`, `SEARCH:RESULT`, `APP:OPEN`, or empty. Helper intentionally omits free-form goal text, query/result labels, screenshots, TAP targets, app version and UI fingerprint. Pocket does not infer them from `ui_summary`.

Pocket coaching is restricted to `com.google.android.apps.maps` + `NAVIGATION:START`, and `com.apple.android.music` + `MEDIA:PLAY` or `SEARCH:RESULT`. Other app/goal pairs receive no advice. Only `inspect_ui` and `retry_previous_safe_tap` are accepted, with `{}` parameters, confidence at least 0.5, `requires_user_confirmation: false`, and an expiry no later than 60 seconds after the observation. `inspect_ui` uses `FRESH_OBSERVATION`. Retry is limited to a failed task observation where Helper advertises the safe retry: Maps uses `NAVIGATION_ACTIVE`; Apple Music `MEDIA:PLAY` uses `MEDIA_PLAYBACK_BECAME_ACTIVE`. The event schema does not expose the private postcondition for `SEARCH:RESULT`, so Pocket only suggests `inspect_ui` for that goal.

## Advice and results

Pocket sends `POST /coach/v1/advice` with the common v1 envelope (`source: pocket`, `kind: coach_advice`) plus `observation_event_id`, fixed safe `diagnosis`, `suggested_action_id`, empty `parameters`, `expected_postcondition`, `confidence`, `expires_at`, and `requires_user_confirmation`. It sends no target labels, arbitrary arguments, transcript, query, UI fingerprint or task generation.

HTTP 202 is only an accepted/queued receipt. Pocket stores that state and polls the same feed for `coach_action_result`, which it correlates by `advice_event_id` and additionally checks against the task, observation and action IDs. It separately correlates `task_outcome` by `task_id`; only a task-specific verified outcome is terminal success. An executed action is never treated as goal completion. A timeout or ambiguous POST result is marked unknown and is not automatically resubmitted.

Pocket recognizes task success only when `verified` is true, `result` is `success`, the app/GoalIntent matches a supported task, and `verification_method` exactly matches a trusted `evidence_ref`. Maps accepts `NAVIGATION_TRANSITION_OBSERVED`; Apple Music playback accepts `MEDIA_PLAYBACK_BECAME_ACTIVE`. Generic `RUNTIME_VERIFIED`, TAP, or app-transition evidence alone does not count as either task's success. The current Helper source writes uppercase completion evidence into `verification_method` via `safeErrorCode`.

## Skills and code proposals

- A verified Maps or Apple Music playback outcome creates a Pocket Role Skill candidate with app-package and GoalIntent scope plus Helper event provenance. The Maps skill postcondition is `NAVIGATION_TRANSITION_OBSERVED`; its safe retry postcondition remains `NAVIGATION_ACTIVE`. Apple Music uses `MEDIA_PLAYBACK_BECAME_ACTIVE` for both playback retry and verification. The same verified outcome may stage an inactive `skill_candidate` to Helper; its action sequence is limited to `inspect_ui`. Pocket requires two different verified task IDs and outcome event IDs before marking its candidate ready for review. It does not activate automatically; explicit user activation remains required.
- `SEARCH:RESULT` can receive an `inspect_ui` coaching suggestion, but its current feed has no search-result verifier, so it cannot independently promote a skill.
- A failed outcome can create a code-review prompt, but Pocket does not infer a Runtime defect from the outcome. The user must confirm that attribution and provide the diagnosis, reproduction steps and test plan. After explicit confirmation, Pocket accepts only a bounded Helper Java source/test diff, runs `git diff --check` and `./gradlew testDebugUnitTest --no-daemon` in a temporary checkout, pushes an isolated branch and opens a Draft PR. It never merges, deploys or installs an APK.
- After the PR exists, Pocket sends Helper only a `code_change_proposal` containing its GitHub PR URL, diagnosis, reproduction steps and test plan. The Helper endpoint rejects inline patches and stages the reference as pending review.

## Pocket implementation and verification boundary

- `lib/helper-coach/bridge-client.js` implements loopback requests, exact-target HMAC signing and response limits. `protocol.js`, `engine.js`, `service.js`, `store.js` and `http.js` normalize the strict schema, poll/deduplicate events, create constrained advice and track action/task results.
- Pairing is entered in the Growth Center. Runtime polling runs in the existing Node service; the APK and Android permissions are unchanged. A service restart is needed after deploying the new JavaScript, but this change does not restart it.
- The Growth Center displays actual local events, queue states, candidate provenance and outcomes; empty metrics remain empty. Role Memory uses the existing `TOOL` provenance path.
- Focused checks use `node --test test/helper-coach.integration.test.js`. Mock Bridge tests exercise HMAC, cursor paging/deduplication, receipt and outcome correlation, supported task policies, candidate staging and PR-reference staging. These checks do not validate Helper's running Bridge, pairing UI, or physical-device task completion.
