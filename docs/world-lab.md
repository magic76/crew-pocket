# Crew World 3D Lab (isolated experiment)

This is a visual prototype only. It does **not** replace the Crew Room, connect
to live Role status, send messages, modify Memory, or run any tool. All labels
are explicitly **示範** and every action is synthetic.

## How to try on Android

1. Checkout this PR branch on the device and let the existing Crew Runtime
   serve the updated static files (usual no-store static assets).
2. Open **http://127.0.0.1:8000/world-lab.html** in the phone browser. Use a
   separate browser tab rather than navigating away from an active Crew Pocket
   conversation or Live session.
3. Drag to pan, pinch or use +/- to zoom, tap a character or role label, select
   聚焦人物, 示範工作 or 示範交接. 世界全景 resets the camera.

Three.js r148 is pinned locally in public/vendor, with its original MIT
license. No CDN, no GLB download, and no API Key is required. The three
character variants share one procedural body rig, animation logic and camera
rules, while colors, hair and accessories vary deterministically.

## Constraints and next iteration

- This tests the Q-chibi low-poly art direction and touch controls, *not*
  final high-poly production assets.
- Real Role, job and handoff evidence may be added in a subsequent iteration
  after approval. Never project a synthetic demo state as actual Runtime work.
- The rendering loop pauses scene updates when hidden, caps pixel ratio, and
  supports reduced motion. In case of WebGL unavailability the page reports
  an error instead of affecting the host chat UI.
- Nothing is wired to the main navigation or app shell yet. This is deliberate
  to avoid the previous office-world UI regressions.
- Run: node test/world-lab.test.js

## Visual acceptance

Try portrait and landscape orientations, zoom/pan, camera focus, work motion,
handoff trip, and switching characters while motions are active. If this
visual direction passes, mount an opt-in entry in the Crew page while preserving
current Role-centric navigation.
