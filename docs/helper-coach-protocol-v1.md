# Helper Coach v1 — shared protocol (proposal)

Status: **contract-only**, not connected to Android Runtime yet. This is a compatibility specification, not a claim that coaching works.

## Goal
Crew Pocket acts as a teacher; Crew Helper owns Android permissions, executes actions, and reports evidence. Pocket may diagnose, suggest an existing skill, propose a new skill, or propose a source-code patch. Pocket never silently changes Helper's code, installs an APK, or executes privileged operations.

## Transport and trust
- Same-device loopback only (127.0.0.1); never bind to 0.0.0.0. Discover existing Helper connected-server/Termux bridge before choosing endpoint or port.
- Explicit user opt-in, per-install pairing secret stored in private app storage, request authentication, expiry, nonce/replay protection, request size limits and rate limiting.
- No raw passwords, OTPs, payment fields, account tokens, microphone recordings or unrestricted screenshots in coaching telemetry. Redact before transfer; opt-in for any screenshot.
- Helper Runtime is sole executor. Pocket outputs structured advice, never raw shell/ADB commands as executable instructions.

## Message envelope
All messages have: `protocol_version: 1`, `event_id`, `task_id`, `timestamp` (ISO 8601), `source` (`helper` or `pocket`), and `kind`.

### Helper -> Pocket
`task_observation`: `app_package`, `goal`, `step_index`, `ui_summary` (redacted), `available_actions` (Runtime-advertised action identifiers), `previous_action`, `result` (`success|failed|unknown`), `error_code`, `evidence_refs` (local ephemeral references).

`task_outcome`: `verified` boolean, `verification_method`, `duration_ms`, `skill_id` (optional), `evidence_refs`.

### Pocket -> Helper
`coach_advice`: `observation_event_id`, `diagnosis`, `suggested_action_id` (must be in available_actions), `expected_postcondition`, `confidence` (0..1), `expires_at`, `requires_user_confirmation`.

`skill_candidate`: `skill_id`, `app_package`, `preconditions`, `action_sequence` (only allowlisted Runtime actions), `postconditions`, `evidence_refs`, `status: candidate`.

`code_change_proposal`: `repository`, `diagnosis`, `reproduction_steps`, `test_plan`, `proposed_diff_ref` (PR or patch reference). No automatic merge or install.

## State machine
`observed -> diagnosed -> advice_proposed -> runtime_validated -> executed -> outcome_verified -> candidate_recorded`.
Failure, timeout, changed foreground app or expired advice -> `aborted` and re-observe. Never assume a tap implies success.

## Skill promotion
- Candidate skills remain inactive by default.
- Promotion requires repeated independent verified outcomes, explicit scope (package/version/UI signature), regression checks, and rollback.
- Do not use an unverified coach recommendation to bootstrap its own verification.
- Keep provenance (task ID, observations, model/role version, verification method). Do not equate a model's verbal claim with an Android state assertion.

## First end-to-end acceptance
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
