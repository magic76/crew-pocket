# Crew World 3D — opt-in Role visualization

Crew World is an opt-in visual mode, not a replacement for the Role-centric Crew Room.
The normal conversation, Role selection, and Runtime remain intact.

## Android steps

1. Open AI 小隊 → 探索 3D 小隊世界.
2. Drag to pan, pinch or use +/- to zoom, tap 3D characters or Role labels.
3. 聚焦人物 centers the character. 示範工作 and 示範交接 only play synthetic animations.
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
