# Pixel Office P0 (Crew Pocket)

Pixel Office is an optional renderer inside the existing Crew World shell. It does **not** change durable Role IDs, Memory, Dreaming, CLI, PTY, MCP, history or the original Chat DOM.

## Use

Open Crew World and tap **PIXEL** near the top-right. The same button becomes **3D** to return to the existing town. Preference is saved locally where browser storage is available; the original 3D renderer remains available.

- One Role = one persistent seat; scrolling supports up to 36 Roles.
- Tap the Role's name/status plaque to select its **current** conversation through `CrewWorldHost.onSelectedRole`.
- Runtime data is read-only from `GET /api/crew-status` every 5.5 seconds. Only the verified `working` state animates typing. `waiting`/attention shows a badge. Unknown, disconnected or missing state is explicitly not presented as working.
- If the status endpoint cannot be reached, a locally known Role roster may be shown with all states marked **未同步**.
- Closing the map pauses polling and animation. Mode switches dispose the old renderer but keep the original Chat composer and unsent draft.

## Architecture and upstream

This is an original, dependency-free Canvas 2D P0 implementation **inspired by** [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents), whose core has a React Canvas/office engine and a different session-based data model. Its MIT-licensed sprites or rendering source have **not** been copied or bundled; a future asset reuse needs licensing and attribution review.

The existing Three.js `world-lab.js` renderer remains intact. Pixel Office is loaded only when selected, via `crew-world-launcher.js`. It deliberately does not emulate agent/tool events or fabricate Subagent collaboration.

## Verification

```bash
node --check public/js/crew-pixel-office.js
node --check public/js/crew-world-launcher.js
node test/crew-pixel-office.test.js
node test/crew-world-portal.test.js
node test/world-lab.test.js
git diff --check
```

Manual smoke: toggle Pixel/3D while a Role streams; tap multiple Roles; ensure the selected Role and draft remain correct. Verify unknown network state, empty roster, 8/16 Role layouts, viewport resize, and reopening after Dashboard. No APK rebuild is needed for these `public/` changes.
