# Visual Answer (P0/P1)

Crew Pocket keeps **Markdown as the source of truth** for Role-owned conversations and memory.
Visual Answer is an optional **on-demand** derivative reading view; it does not alter
stored transcript text, project/workspace context, provider prompts, or execution events.

## User flow

- During streaming: standard Markdown UI, unchanged.
- After successful completion: long, structured responses get a small
  "◇ 視覺化閱讀" action. Short replies do not.
- Tapping expands a mobile-friendly HTML reader **beneath the same message**.
  Tapping again collapses it; the original Markdown stays in place.
- Inside the expanded reader, **Full screen** is an optional secondary action.
  Back returns to the expanded message at the same conversation position.
- Execution result cards retain their original collapsed status / changed file /
  verification views; the visual reader is a separate action.
- Only one answer remains expanded in the visible conversation by default.
  Each Role/Provider/Conversation has an independent in-memory selection: after
  switching Roles and reloading that conversation, its last expanded answer
  reopens when it is in history.
- Successful rendered HTML is held in a small role-scoped client cache and a
  short-lived server cache, so closing/reopening or returning from full screen
  needs no additional model call or HTML render while cached.

## Implementation

- public/js/visual-answer.js: eligibility heuristic, inline accordion, role-scoped
  in-memory selection/cache, optional full-screen modal, fetch and cleanup.
- public/css/visual-answer.css: reader layout and normal Markdown typography.
- lib/visual-answer.js: server-side draft adapter, isolated subprocess,
  bounded output, restricted CSP and ephemeral LRU result cache.
- lib/vendor/answer-me-with-html/am.mjs: offline, bundled standalone Node CLI
  from https://github.com/QingYunA/answer-me-with-html (MIT).
- POST /api/visual-answer: authenticated by the existing /api/ route guard.
  Accepts { "content": "<markdown>" }, returns { "success": true, "html": "..." }.

The rendering input is sanitized separately from the user's original Markdown:
local image references are replaced with their descriptions, and HTML/SVG
source fences are displayed as code rather than trusted page components.
The result is rendered in a fixed-height, independently scrollable inline
iframe with **no sandbox permissions**, plus a restrictive Content Security
Policy. No scripts, forms or network access are needed for the static document.
The outer chat supplies Expand/Collapse, Copy and Full screen controls.

The renderer uses Node.js >=20. It runs only after a user taps the action,
with an 8-second timeout, 48,000-character source limit, at most two
concurrent renders and temporary files deleted after use. A renderer error
leaves the original answer untouched.

## Supported and later

P1 supports readable panel layouts, Markdown tables, and the renderer's
extended fenced components when already present in the AI's answer:
flow, sequence, tree, timeline, limits, kv, annot and callout.

P2 should make agents optionally produce these visual blocks **when useful**;
do not silently ask an extra model to rewrite every reply. The P1 adapter
does not invent a diagram from ordinary Markdown bullet points.

## Validation

- node --check lib/visual-answer.js
- node --check public/js/visual-answer.js
- node --check public/js/chat.js
- node --check server.js
- node test/visual-answer.test.js
- node test/visual-answer-inline.test.js
- git diff --check origin/main...HEAD

On Android, confirm: different Role history, completion/failure, switching
between conversations, long response panels and tables, scroll inside the
inline frame, expand/collapse, back/escape from optional fullscreen, offline
rendering, and no model
request or persistent memory mutation when opening a reader.
