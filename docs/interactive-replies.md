# Crew Pocket · Inline Interactive Replies (P0 / P1 / P2 / P3)

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

## P2: Visual data and live parameters

The same `crew-ui` code fence now supports **three more allowlisted types**:

- `chart`: 2–10 points, `kind: "bar"` or `"line"`, numeric values 0–1e9.
  Responsive native bars/SVG, with a collapsible numeric data table.
- `scenario`: 2–4 tabs. Each has a description and up to four comparison facts.
  Switching tabs is immediate and local; “以此方案繼續” only fills a draft.
- `calculator`: a single bounded range input with a deterministic **linear**
  formula `base + (selectedValue - initialValue) * perUnit`. The supplied
  assumption is prominently shown as a **model assumption**, not a verified
  forecast. “用這個數值繼續” fills a draft including the assumption.

All charts and calculations show **AI 回覆資料 · 未驗證**. The widget never
uses `eval`, model-authored script, chart plugins, network requests, or a
second transcript. Manual device QA is still required.

The following single-line JSON objects are examples for fenced `crew-ui` blocks:

    {"version":1,"type":"chart","title":"延遲比較","kind":"bar","unit":"ms","items":[{"label":"舊版","value":85},{"label":"新版","value":42}]}

    {"version":1,"type":"scenario","title":"部署方案","options":[{"label":"穩健","description":"維持既有部署流程","facts":[{"label":"變更範圍","value":"小"}]},{"label":"快速","description":"簡化部署流程","facts":[{"label":"變更範圍","value":"中"}]}]}

    {"version":1,"type":"calculator","title":"費用示意","assumption":"每增加一單位，加收 12 元；僅供估算","input":{"label":"使用量","min":10,"max":100,"step":10,"value":30,"unit":"次"},"output":{"label":"費用","base":360,"perUnit":12,"unit":"元","precision":0}}

Implementation is `public/js/crew-rich-widgets.js` and
`public/css/crew-rich-widgets.css` with `test/crew-rich-widgets.test.js`.
Invalid data stays in its code fence rather than being rendered.
Unlike P1's conservative Markdown inference, P2 charts/calculators are
**explicitly requested via data** and are never guessed from ordinary prose.

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

    node --check public/js/crew-rich-widgets.js
    node --check test/crew-rich-widgets.test.js
    node test/crew-rich-widgets.test.js
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
