# Crew Pocket · Inline Interactive Replies (P0 / P1)

The existing Role-owned Markdown transcript remains the single source of truth.
This feature adds **native UI inside completed assistant messages** without generating
HTML, calling another model, adding an iframe, or changing provider prompts.

## Already works with ordinary Markdown

- Structured long answers still use `visual-answer.js` to organize headings and tables in place.
- Where two or more section panels exist, each of the first six sections has a small `追問這段` control.
- Clicking a section action **fills the current chat composer**. The user inspects and sends it explicitly.
- Short conversational answers and streaming text keep their existing appearance.

## P1: Native controls from ordinary Markdown

Without any `crew-ui` block, a completed assistant reply can now show contextual
actions when its **actual** rendered Markdown has an unambiguous structure:

- A comparison with 2–6 explicitly labeled `方案 A/B`, `選項 A/B`, or `Option A/B` headings,
  list entries, or table rows gets compact choice chips. A click fills a draft about
  that exact option; it does not send, run tools or imply the option is approved.
- A heading labeled `下一步`, `待辦`, `行動項目`, `Next Steps`, etc. with 2–8 short
  list items gets checkboxes **inside the original list** and a button to draft
  the checked items. Code-heavy and nested lists are skipped.
- Only one automatic choice group and one automatic checklist are allowed per
  reply. Explicit `crew-ui` components override automatic discovery.
- Original text, headings, lists and tables are retained in place. Ordinary prose
  and ambiguous options are not transformed; no extra model call or storage is added.
- Actions use the P0 Role/provider/conversation guard and never overwrite an
  existing draft. HTML/SVG sandboxes, streaming and failed turns remain unchanged.

Implementation: `public/js/crew-reply-discovery.js` with
`test/crew-reply-discovery.test.js`; loaded before `crew-interactive.js`.

## Opt-in structured widget format

An agent can produce a fenced Markdown code block whose language is `crew-ui`.
The code block body is a JSON object with `version: 1`, a supported `type`, and a `title`.

Choice example (put the JSON below inside a fenced `crew-ui` code block):

    {"version":1,"type":"choice","title":"接下來做哪項？","question":"請按優先順序繼續。","options":[{"label":"先修 UI","value":"先處理手機 UI 的問題"},{"label":"先跑驗證","value":"先跑回歸測試並回報"}]}

Checklist example:

    {"version":1,"type":"checklist","title":"驗收清單","items":["檢查手機佈局","確認 Role 不串台","驗證歷史訊息"]}

Metrics example (read-only and **model-provided; not verification evidence**):

    {"version":1,"type":"metrics","title":"概覽","items":[{"label":"候選項目","value":"4"},{"label":"待驗證","value":"2"}]}

Use the JSON form **only where interactivity genuinely improves the answer**.
Never present model-authored metrics or labels as certified runtime state.
Execution outcomes, file changes, checks, commits, and tool status still come only from
trusted `turn_result` through the existing Living UI renderer.

## Boundaries

- Schemas are allowlisted. Choice has 2–8 options; checklist 1–12 items; metrics 1–4 items.
- Text fields and raw JSON are length bounded and escaped as text. No HTML, script or CSS is executed.
- Invalid, incomplete, or unknown versions remain ordinary code, without breaking Markdown.
- Widgets are hydrated **only after a reply completes** (or a lazy history card is expanded).
- The original Markdown is not rewritten in the transcript, memory or provider context.
- UI state is local to the current render. Choosing an option is not a persistent task or approval.
- Button actions only prefill `#prompt-input`; the user still presses Send. Existing drafts are never overwritten.
- A Role/provider/conversation mismatch blocks the draft and displays an explanation.
- Each assistant message can hydrate up to five native widgets. No new network request is made.
- Existing standalone HTML/SVG sandboxes remain separate from this trusted native widget path.

## Verification

    node --check public/js/crew-reply-discovery.js
    node --check test/crew-reply-discovery.test.js
    node test/crew-reply-discovery.test.js
    node --check public/js/crew-interactive.js
    node --check public/js/visual-answer.js
    node --check public/js/chat.js
    node --check test/crew-interactive.test.js
    node test/crew-interactive.test.js
    node test/visual-answer-inline.test.js
    node test/living-ui.test.js
    git diff --check

Manual: narrow Android WebView, light/dark themes, choice and checklist input,
composer already holding a draft, cross-Role switching, historical lazy task
cards, failed/interrupted turns and unchanged HTML/SVG sandboxes.
