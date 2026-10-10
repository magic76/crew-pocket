# Crew World: one WebView, one Chat runtime

Crew World is the Map view of Crew Pocket's home screen, paired with Dashboard.
It lives **inside public/index.html**, not an iframe. The regular Role roster
and the original Chat tab stay available.

## Mobile usage

1. Open **AI 小隊 → 地圖** using the Dashboard / 地圖 segmented toggle.
2. Drag to pan, pinch to zoom; tap a Role and select **開啟聊天**.
3. The world shows a bottom sheet holding the **original messages-container
   and chat-composer-footer DOM nodes**. It uses the existing Role conversation,
   SSE streaming, stop/interruption control, upload actions and task-result cards.
4. Select **收合** to see the world again; the active Role keeps working.
   **展開** opens a near-full-screen chat sheet on the world.
5. Select **前往對話** to return to the normal full Chat view.
6. Switch back with **Dashboard**, ✕ or ←. Chat nodes are returned to their original
   positions; Role and stream state is not restarted or cloned.

Android IME positioning uses the **single** window.visualViewport, and only
one set of chat inputs and listeners exists. Confirm Gboard on a real device.

Standalone art review: http://127.0.0.1:8000/world-lab.html
This separate page is now **visual-only** and has no second Chat implementation.

## Architecture

- `public/js/crew-world-launcher.js`: manages optional world opening,
  lazy-loads local Three.js (~600 KB) and world modules only on first access,
  original Chat DOM move/restore with placeholders, Role navigation via
  `window.openCrewCockpitRole`, and the floating sheet.
- `public/js/world-lab.js`: reusable Three.js scene mount via
  `window.mountCrewWorldScene`. Does not submit messages or read private
  chat content. The host is notified of the clicked Role directly.
- `public/js/world-lab-kit.js`: fixed low-poly character rigs with distinct
  profession accessories and procedural colors. Up to 36 agents (three per district) are drawn.
- `public/js/world-lab-events.js`: baseline-only saved Role handoff events.
  Handoff animations are illustrative and never imply successful delivery.
- `public/css/world-lab.css`: the world-only styles; no global body/button
  resets affecting Crew Pocket's existing Chat theme.
- `public/css/crew-world-launcher.css`: same-document responsive chat sheet.
  No iframe keyboard shim, postMessage bridge or duplicate polling composer.

The scene reads verified `/api/crew-status` and saved handoff metadata;
characters display only verified work/wait/idle statuses, current work titles
when truly busy, and bounded latest reply *speech* previews. No cross-Role
context, memory, credentials or workspace is shared.
- The first reply poll after entering Map only records a baseline. Old replies
  never pop up. A changed assistant reply can show only while its Role is
  working or within 20 seconds after verified work, for up to five minutes;
  the bubble hides as soon as the Role becomes idle, waiting or unknown.

## Lifecycle and safety

- Opening creates one WebGLRenderer; closing cancels RAF, intervals and timers,
  disconnects ResizeObserver, removes DOM listeners, disposes geometries,
  materials, renderer and forces the WebGL context to be released.
- The same original Chat DOM is **moved**, not cloned. Its input and listeners,
  including stop and attachments, survive show/hide.
- The selected Role must be present in the host snapshot. Role navigation is
  delegated to the existing `openCrewCockpitRole` function. No independent
  `/api/role-submit` path is invoked by Crew World.
- The full chat remains the authoritative record and history; World only
  changes its position on screen.

## Tests

- `node test/world-lab.test.js`: world scene, syntax and single-DOM contract.
- `node test/crew-world-portal.test.js`: original message and composer node
  identity, role navigation, collapse/restore, close/reopen and scene teardown.
- Existing Crew Runtime, Role queue, history, memory, and Visual Inspector
  regression suites must continue passing.

On-device checks still required: Android portrait/landscape, Gboard Chinese,
visualViewport keyboard shrink, streaming while the world panel is collapsed,
role switching during another Role's active work, attachments, tap/pinch,
open/close memory stability and WebGL recovery.

## Dashboard / Map and city growth (Oct 2026)

- **Dashboard** and **地圖** are equal, accessible view modes on the
  Crew Home. Neither mode creates a new Conversation. Both share the same
  Role identity and runtime.
- The old Dashboard card that launched a separate "3D experiment" is removed.
  Both modes expose equivalent toggle controls; switching to Dashboard cleans
  up the Three.js scene while leaving any active Role request undisturbed.
- The former rendering cutoff was 6 Roles. Now **up to 36** are rendered.
  A Project forms contiguous districts of at most 3 Role avatars each.
  For 16 Roles from one Project the map has **six** island neighborhoods,
  not 16 far-flung islands. Several Projects form separate districts.
- District positions use a compact ring town: the first six neighborhoods
  form an inner ring, subsequent neighborhoods form outer rings. Island/
  bridge geometry is built **once per district**, not once per person.
  Each Role is individually selectable and retains its own Role/Conversation,
  color and status; proximity does not share project context or memory.
- At overview zoom the map hides idle/waiting Role badges and project pins
  unless a Role is working. Working Roles and their new reply bubbles remain
  visible; zooming in reveals all individual badges. The horizontal
  Role chip rail offers direct navigation to every rendered agent.
- Project pins show verified working counts only while a member is working.
  They are navigational only: no tool calls, new messages, or completion claims.
- Camera framing accounts for the city extent. Zoom and focused district
  views remain available on phone.
- At >36 Roles, the map labels its visible/total count rather than silently
  hiding extra characters. **Dashboard** still provides the full Role roster;
  a later world-virtualization phase can lift the cap without overloading
  low-memory Android devices.
- When Role membership changes while the map is already open, re-enter Map
  to refresh the district layout. Existing status refresh continues meanwhile.

## Natural bridge network (Oct 2026)

The first prototype made **every** neighborhood send one long bridge directly
to the Hub. With a full inner/outer island ring, the roads visually piled up
near the center and looked like crossing spokes rather than a plausible town.

- WorldLabKit now plans a **shore-to-shore neighborhood road network** before
  building Three.js meshes. Bridges terminate at each island's coastline; they
  do not pass through the decorative buildings or underneath the center of
  another island.
- Uses a deterministic, minimal connecting tree over actual project islands
  and the Hub. Routes prefer nearby islands; for more than three neighborhoods,
  the central Hub has a **single bridge entrance** instead of many spokes.
- Candidate roads are rejected if they cross an existing bridge or run through
  the interior of an unrelated island. Every district still has a route to Hub
  when the map has its generated 1–36 Agent layout.
- Nearest-neighbor bridges create short linked island paths with readable
  junctions on land rather than long waterborne intersections.
- Works with one, two or three agent demo maps too; zero extra provider calls,
  new task actions, Context coupling, or runtime state.
- `node test/world-road-network.test.js` checks crossing, connectivity,
  obstruction and the hub entrance for 1–36 same-project and mixed-project
  examples.

## Paper-airplane messaging (Oct 2026)

For newly observed, **saved Role-to-Role message metadata**, the primary
visualization is now a folded low-poly paper airplane from the **sender's
actual avatar** to the **intended recipient**. Agents do not physically walk,
cross water or leave their project island to send a digital message.

- **Handoff/outgoing**: pale blue paper plane; **reply**: pale green.
  A small fading trail follows the plane and a subtle landing-target halo
  draws attention to the recipient's position. These effects communicate
  **the existence and direction of a saved message event only**, never read
  status, delivery confirmation, task completion, or processing success.
- **Cross-island**: short airborne arc (roughly 0.8–1.65 seconds, depending
  on map distance), independent of paths/bridges. **Same-island**: brief,
  lower local arc between the specific two Role avatars.
- Old road deck lighting remains only as a **very faint optional secondary**
  highlight. No route is fabricated if bridges do not connect.
- At most **three** simultaneous planes, with a bounded queue of up to six
  pending observed events. The initial observation remains a history baseline
  with no replay. Old or unauthorized events still cannot trigger animation.
- **Reduced motion**: plane is briefly shown at the arc midpoint without
  spatial travel, trail or pulsing destination halo.
- Three.js plane/trail/ring GPU resources are explicitly disposed when each
  effect ends and when the map closes; no new remote assets, API calls,
  message submits or shared Role Context have been introduced.
- The standalone preview's "示範交接" launches the same airplane effect but
  never posts an actual message.

`node test/world-message-motion.test.js` retains the bridge-routing and
grounded-Avatar regression contracts.
`node test/world-paper-plane.test.js` checks start/end points, arc height,
same-island behavior, 1–36 Roles, distinct reply color, and geometry cleanup.

Android 3D visual smoke testing is still required.

Regression contract covers 7/16/36 characters, multi-Project grouping,
uniqueness of Role selection points, dynamically scaled town extent and the
Dashboard/Map toggle. Android WebView GPU and gesture testing remains required.
