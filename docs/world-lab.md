# Crew World 3D — opt-in Role visualization

Crew World is an opt-in visual mode, not a replacement for the Role-centric Crew Room.
The normal conversation, Role selection, and Runtime remain intact.

## Android steps

1. Open AI 小隊 → 探索 3D 小隊世界.
2. Drag to pan, pinch or use +/- to zoom, tap 3D characters or Role labels.
3. Tap 跟他說話 to compose an instruction right on the map. The existing idempotent Role submitter queues it in that Role's current conversation, not a new one.\n4. 頭上狀態名牌 shows verified state and current conversation title (only if working).
4. 前往對話 returns to the selected Role's existing scoped conversation.
5. Close with ✕ or the back arrow. The iframe unloads WebGL; chat and Live are not stopped.

Standalone URL: http://127.0.0.1:8000/world-lab.html

## Reality boundary

- The scene makes read-only GET /api/crew-status requests; no Runtime writes.
- Up to six actual Role identities with distinguishable saturated palettes. Labels use
  textContent, never inject names into HTML.
- Verified working/waiting/idle/new states originate from the server's actual
  Role status. When refresh fails, the scene marks statuses as unknown.
- Demonstration movements remain explicitly labeled 示範. No synthetic
  handoff becomes a real delivered message or implies successful work.
- If initial Runtime metadata is unavailable, it falls back to three explicitly
  labeled demo Roles.
- With more than six Roles, the 3D visual shows the first six. The original
  Crew Room remains the authoritative full list. Reopen to refresh membership.
- The parent validates same origin, iframe source and known Role ID before
  navigating to the existing conversation. No cross-Role context or memory sharing.
- No message bodies, memories, workspaces or credentials are projected into 3D.

## Rendering and acceptance

- Local pinned Three.js r148 under public/vendor, MIT license; no CDN or GLB download.
- Low-poly procedural meshes, shared character proportions, strong color accents,
  optional motion and capped rendering pixel ratio.
- The map pauses visible updates when hidden; the modal unloads on close.
- This validates the visual direction, not a production rigging pipeline.

Run node test/world-lab.test.js. Crew Runtime tests verify that the old
virtual office never becomes the default Crew Room.

Validate Android portrait/landscape, 3–6 Roles, horizontal Role chip scrolling,
touch pinch/pan, character selection, close/reopen, stale Runtime status and
returning to an existing conversation. Device-level visual tests are still needed.

## In-map communication and verified handoffs (P1/P2)

- Live Role mode shows 聚焦人物 / 跟他說話 / 前往對話. Standalone
  offline demo keeps synthetic work/handoff buttons and cannot send messages.
- The composer calls the existing POST /api/role-submit only after the user
  explicitly taps 送出訊息. A strong random request_id is reused for retries
  so an uncertain network response does not duplicate the action.
- Runtime owns the selected Role's provider, project/workspace and existing
  conversation. The visualizer cannot supply or override those fields.
- A queue receipt means accepted/queued, not completed. For the full streaming
  reply, map composer now shows recent assistant replies; tap 查看完整對話 for full context and tool history.
- Head labels use real working/waiting/idle/new state. Only a *working* Role
  may show its current conversation title; waiting shows an attention count.
  No tool step, task outcome or completion is invented.
- GET /api/crew-room-events returns saved metadata without message content.
  Initial load is a baseline and never animates historical messages. Only fresh
  new handoffs/replies between currently displayed Roles animate across hub
  bridges. A saved event does not assert delivery or task success.
- All label and chat names are set with textContent, not untrusted innerHTML.
  Closing the 3D view unloads the iframe, stopping polling and animations.

Check typing in Chinese Gboard, retaining text on network failures, tap target
switching, low-power Android devices, zoomed-out head label visibility, and
quiet/no-handoff startup. The map shows bounded recent assistant answers, not the
entire transcript or private tool/thinking traces; those remain in the normal UI.

## 2026-10-10 fixes: text submission, keyboard and replies

- Text-only requests keep image_path='' but skip realpath validation when there
  is no image. Explicit nonempty image paths still receive root/type checks.
- Role-scoped read-only GET /api/world-chat-history?role_id=... checks both
  current Role Runtime and persisted conversation ownership before calling
  provider.getHistory. It only returns bounded assistant-visible text (not
  tool calls, thinking, or messages belonging to other Roles).
- The composer shows the most recent assistant replies and refreshes every
  4.5 seconds **only while open and visible**. Closing the viewer unloads it.
  A queue acceptance is not proof that the displayed reply belongs to the
  just-submitted message; the UI does not fabricate that correlation.
- A WebView / iframe visualViewport adapter measures keyboard occlusion and
  shifts the panel above Gboard. The reply log scrolls separately and composer
  buttons stay reachable, including portrait/landscape. Open panel no longer
  automatically focuses the textarea.
- Uncertain POST errors preserve the draft and its request ID even if the chat
  panel is closed/reopened within the same scene session. Retries are
  idempotent; users should still inspect their target conversation if status
  is unknown.
- Verification: node test/world-lab.test.js, node test/world-chat-history.test.js
  and node test/role-submit.test.js; manual Android keyboard and reply checks
  are still required.

## Reliable answer delivery after completed Role messages

- POST /api/role-submit still returns a durable queued receipt, never an
  invented success. Once the existing Role worker really finishes, it saves
  a bounded copy of the provider's final assistant text under that same
  request_id. Original conversation history remains the source of full detail.
- The composer now polls GET /api/world-chat-result scoped by both role_id and
  request_id. It puts the corresponding answer **after** the matching user
  bubble; provider-history polling supplies only previous replies, never
  claims to answer the just-submitted task.
- Any stale result belonging to an earlier request is discarded. Completion
  and an empty final text are distinguished. Failed/unknown requests never
  pretend to have succeeded.
- Replies are bounded to 8,000 characters in persistent queue receipts.
  The full answer continues to live in its original Role Conversation.
- The read endpoint checks the Role's current existence and the receipt's
  Role ownership before returning the text. The map never shares another
  Role's context or answer.
- Regression test test/world-chat-ui.test.js simulates the queued-to-finished
  response and asserts the exact answer bubble appears below the user prompt.
