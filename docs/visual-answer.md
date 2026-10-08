# Visual Answer (P0/P1)

Crew Pocket keeps **Markdown as the source of truth** for Role-owned conversations and memory.
Visual Answer is an optional **on-demand** derivative reading view; it does not alter
stored transcript text, project/workspace context, provider prompts, or execution events.

## User flow

- During streaming: standard Markdown UI, unchanged.
- After successful completion: long, structured responses get a small
  "◇ 視覺化閱讀" action. Short replies do not.
- Tapping opens a full-screen, mobile-friendly reading document. The original
  response remains in the conversation and can be copied from the reader.
- Execution result cards retain their original collapsed status / changed file /
  verification views; the visual reader is a separate action.
- Reloading history recreates the action from the stored original Markdown.
- Close returns to the same conversation without sending another AI request.

## Implementation

- public/js/visual-answer.js: complexity heuristic, action, modal, fetch, cleanup.
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
The result is rendered inside an iframe with no sandbox permissions and a
restrictive Content Security Policy. No scripts, forms or network access are
needed for the static document. The outer Crew Pocket modal supplies working
close and copy buttons.

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
- node --test test/visual-answer.test.js
- git diff --check origin/main...HEAD

On Android, confirm: different Role history, completion/failure, switching
between conversations, long response panels and tables, closed reader
restores scroll position, back/escape close, offline rendering, and no model
request or persistent memory mutation when opening a reader.
