# Crew Pocket Android WebView acceptance — reliable queue + modeless World

Scope: PR integrating deferred Role message delivery and simplified Crew World conversation controls.
This is an **on-device smoke checklist**, not evidence that CI has exercised a real Android WebView.

## Setup

1. Pull the merged Web code and restart **only after explicit operator approval**. APK reinstall is unnecessary for Web-only changes.
2. Open Crew Pocket on Android with two or more existing Roles, distinct Conversations and a working provider.
3. Keep another Role generating a long reply; retain its Conversation/Provider identity to verify that turns are not mixed.
4. Record the build commit, Android/WebView version, provider, result and screen recording if a case fails.

## Must-pass manual scenarios

| Case | Action | Expected |
|---|---|---|
| W01 | Open Dashboard, switch to map, select two Roles | Shared nav visible; same Role Chat composer; no duplicated header/Role bar |
| W02 | Quickly switch three Roles while previous history loads | Map remains draggable/pinch-zoomable; no full-screen blur; latest target wins; typed draft preserved |
| W03 | Delay Role history response >200 ms | Only a tiny spinner beside target; send and Context remain guarded; editable input and Role picker remain usable |
| W04 | Disconnect during Role switch, then reconnect and retry | Draft persists, retry appears; no send to previous Role |
| W05 | Tap **對話**, then the floating Chat **展開** control, then collapse | Original message list expands/collapses; command changes to **收合** when open; no duplicate Chat input |
| W06 | While Role A streams, type a new message and tap send to queue | Text disappears from composer only once durable queue write succeeds; queue capsule shows actual stored message |
| W07 | While A streams, tap **立即插話** | Stop completes or Busy retries; queued message stays in durable queue until provider acceptance; no phantom delivered bubble |
| W08 | Force 409 provider Busy on next send | Ordered finite retry, no duplicate pending user bubble; accepted message removed once acknowledged |
| W09 | Drop network before provider acceptance; close/reopen screen | Durable message remains visible, failure allows manual retry; no silent deletion |
| W10 | During queue delivery change Role/Conversation/Provider | Message cannot be submitted to the wrong target; stale queue stays isolated to original conversation |
| W11 | Switch Dashboard ↔ map with Gboard Chinese IME and keyboard open | No overlapping notifications; draft and selected Role survive; input remains tappable |
| W12 | Start three collaborating Roles; view paper planes and event history | Only evidence-backed messages; no inference of delivery, reading or task completion |

## Failure notes

- A green Node CI run **is not** an Android E2E pass. Record W01–W12 separately.
- If provider acceptance was ambiguous (network loss after submission), **do not auto-resend**. Inspect the destination Conversation before manually retrying, to avoid duplicate work.
- Do not delete `transcript.jsonl`, queue receipts, the Role store or memory records to recover UI state.
- First-line debug information: selected Role ID, active Conversation ID, provider, queued request ID and server response code; redact secrets and message contents.
