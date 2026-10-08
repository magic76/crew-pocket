# Unified answer presentation (P0 / P1 / P2)

The AI's stored Markdown remains the **single source of truth** in each Role-owned
conversation. Rich reading and task results are presentation only. They never
change memory, provider prompts, transcript text, or source tool events.

## UX

- During streaming, the usual Markdown response updates without a second surface.
- On successful completion, structured/long Markdown is enhanced **in place**:
  headings, titled panels, lists, code and responsive tables keep the original
  content and order. Short, plain replies remain unchanged.
- No "圖文閱讀", "文字版" or duplicate reader button; no fixed-height nested
  iframe, and no extra vertical scroll container. Long answers use the chat's
  own scroll position. Tables and code may scroll **horizontally** on small screens.
- Recognized headings (summary/comparison/risks/conclusion/implementation, with
  Chinese and English aliases) get visual treatment only when present in the
  actual Markdown. No new summary or evidence is inferred.
- Long task results remain **collapsed** by default. The expanded card has a
  structured state header, the supplied file paths, supplied verification checks,
  optional commit metadata, execution record accordion, and **one** original
  response. A missing check or commit is never presented as a success.
- Historical task bodies are lazy: they receive enhancement when the card is
  first opened. No second answer is appended outside the task card.
- Code blocks, code-enhancement hooks, links, table accessibility, switching
  between Roles, and conversational history continue to use the current renderer.

## Files

- `public/js/visual-answer.js`: idempotent in-place enhancement. Reuses already
  DOMPurify-sanitized Markdown from `formatMessageContent`. No fetch is made.
- `public/css/visual-answer.css`: responsive native content and semantic panels.
- `public/js/chat.js`: structured execution result view (only actual `turn_result`
  metadata for commit/checks/files; no inference).
- `test/visual-answer-inline.test.js`: no duplicates, no iframe, report section
  grouping, original-node preservation, and lazy history coverage.
- `test/execution-result-ui.test.js`: task card invariants.

## Compatibility

`lib/visual-answer.js` and `POST /api/visual-answer` remain available for
legacy / explicit exports. The normal chat UI no longer uses the older
`answer-me-with-html` iframe, its generated secondary layout, or its extra render
request. This avoids a nested vertical scroll surface while retaining the
capability for a future intentional export use case.

## Verification

```bash
node --check public/js/visual-answer.js
node --check public/js/chat.js
node --check test/visual-answer-inline.test.js
node test/visual-answer-inline.test.js
node test/execution-result-ui.test.js
node test/visual-answer.test.js
```

Manually check Android narrow screens, long tables/code, streaming completion,
failure states, lazy historical task cards, changed files, large reports, Role
switching and conversation restoration.
