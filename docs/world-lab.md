# Crew World: one WebView, one Chat runtime

Crew World is an optional 3D mode of the existing Crew Pocket Web app.
It lives **inside public/index.html**, not an iframe. The regular Role roster
and the original Chat tab stay available.

## Mobile usage

1. Open **AI 小隊 → 探索 3D 小隊世界**.
2. Drag to pan, pinch to zoom; tap a Role and select **開啟聊天**.
3. The world shows a bottom sheet holding the **original messages-container
   and chat-composer-footer DOM nodes**. It uses the existing Role conversation,
   SSE streaming, stop/interruption control, upload actions and task-result cards.
4. Select **收合** to see the world again; the active Role keeps working.
   **展開** opens a near-full-screen chat sheet on the world.
5. Select **前往對話** to return to the normal full Chat view.
6. Close the world with ✕ or ←. Chat nodes are returned to their original
   positions; Role and stream state is not restarted or cloned.

Android IME positioning uses the **single** window.visualViewport, and only
one set of chat inputs and listeners exists. Confirm Gboard on a real device.

Standalone art review: http://127.0.0.1:8000/world-lab.html
This separate page is now **visual-only** and has no second Chat implementation.

## Architecture

- `public/js/crew-world-launcher.js`: manages optional world opening,
  original Chat DOM move/restore with placeholders, Role navigation via
  `window.openCrewCockpitRole`, and the floating sheet.
- `public/js/world-lab.js`: reusable Three.js scene mount via
  `window.mountCrewWorldScene`. Does not submit messages or read private
  chat content. The host is notified of the clicked Role directly.
- `public/js/world-lab-kit.js`: fixed low-poly character rigs with distinct
  profession accessories and palettes (max six on the 3D preview).
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
