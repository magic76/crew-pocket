# Crew Pixel Office — upstream Pixel Agents visual integration

**Source:** [pixel-agents-hq/pixel-agents](https://github.com/pixel-agents-hq/pixel-agents), pinned commit `b1bafd02896d90d83457266575a1e8e5011ce997`; MIT license copied to `public/vendor/pixel-agents/LICENSE.txt`. Characters originated with JIK-A-4's Metro City sprite pack, per the upstream README.

This replaces the *production* Crew World 3D scene, with no 3D toggle. The Crew Runtime, durable Role identity, Conversation, Context/Memory, CLI, PTY and MCP remain Crew-owned. No upstream Claude hooks or separate Pixel Agents HTTP/WebSocket server are installed.

## What is imported

- Exact upstream `default-layout-1.json` (21 × 22 tiles, furniture geometry, room arrangement).
- Upstream PNG sprites: 6 character sheets (112 × 96), walls, floor tiles, furniture and PC animation frames.
- Corresponding upstream sprite-sheet frame coordinates, scene z-order and Canvas nearest-neighbor drawing logic are adapted to Crew's existing WebView.
- Character typing animation only occurs for Crew's verified `working` status; waiting markers come from real `waiting`/attention. No simulated agent tool actions.
- Click/tap a character or accessible role-name target -> the ORIGINAL Crew Role conversation, with one preserved original message stream and unsent draft. One room per 9 roles, draggable/pinch-zoom canvas, zoom/reset controls, reduced-motion support.
- Both status polling and animation are paused while the office is closed.

This is a **visual/asset integration**, not a wholesale copy of the React editor, Claude session provider, terminal launcher, or the complete Pixel Agents pathfinding state machine. Additional gameplay/editor support would require a separate scoped integration.

## Offline assets

Official PNG assets are checked into `public/vendor/pixel-agents/assets/` by a one-time GitHub Actions vendor job when the feature branch updates. To refresh or verify locally:

```bash
node scripts/sync-pixel-assets.mjs
node scripts/sync-pixel-assets.mjs --check
```

If local images are temporarily absent, the renderer uses a commit-pinned GitHub raw URL as a fallback. The source layout itself always stays local. This is not an extra required runtime server.

## Tests

```bash
node test/crew-pixel-office.test.js
node test/crew-world-portal.test.js
node test/role-map-navigation.test.js
```

Manual smoke: open the home office on Android WebView and regular mobile browser; tap roles at different desks; confirm original input and history follow the selected Role; test scrolling, pinch/pan, layout 1–36 roles, disconnected status, resize and Dashboard return. No APK rebuild is required for `public/` changes.
