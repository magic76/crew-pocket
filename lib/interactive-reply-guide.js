// Small, per-turn UI presentation hint. Not a skill, a second model call,
// a role identity, or permission to fabricate data or execute tools.
'use strict';

const VISUAL_REQUEST = /(?:比較|對比|方案|選項|優缺點|取捨|哪個好|圖表|趨勢|統計圖|長條圖|折線圖|數據視覺|數值比較|試算|估算|模擬|滑桿|參數|預算|成本分析|價格比較|費用比較|選擇題|待辦清單|檢查清單|勾選|compare|comparison|trade.?off|alternatives?|options?|chart|plot|graph|trend|visuali[sz]e|estimate|scenario|calculator|slider|checklist)/i;
const ACTION_REQUEST = /(?:開工|合併|merge|push|commit|提交|部署|上線|建立.?PR|修復|修正|修改|改掉|重構|實作|實現|直接做|動手做|做吧|幫我做|幫我寫|產生程式|跑測試|執行|安裝|下載|刪除|移除|更新程式|新增功能|建置|發布|發文|操作|跑指令|\b(?:implement|fix|patch|edit|refactor|deploy|install|execute|run|build|publish|create pull request)\b)/i;
const CODE_REQUEST = /(?:程式碼|代碼|code snippet|source code|檔案內容|直接貼|整份檔案|完整程式|貼出.*(?:js|css|html|tsx|yaml|json)|(?:\.tsx?|\.jsx?|\.py|\.css|\.html|\.ya?ml)\b)/i;

function presentationKind(prompt, { executionMode = '', imagePath = '', background = false } = {}) {
  if (typeof prompt !== 'string' || prompt.length > 3000 || prompt.trim().length < 4 ||
      imagePath || background) return null;
  if (!VISUAL_REQUEST.test(prompt) || ACTION_REQUEST.test(prompt) || CODE_REQUEST.test(prompt))
    return null;
  // No format pressure on a write/build turn. Existing providers vary in how they
  // classify harmless comparison requests, so CHAT and INSPECT are permitted.
  if (executionMode && !['CHAT', 'INSPECT'].includes(executionMode)) return null;
  if (/(?:圖表|趨勢|統計圖|長條圖|折線圖|數據視覺|chart|plot|graph|trend|visuali[sz]e)/i.test(prompt))
    return 'chart';
  if (/(?:試算|估算|模擬|滑桿|參數|預算|成本分析|費用比較|calculator|slider|estimate)/i.test(prompt))
    return 'calculator';
  if (/(?:待辦清單|檢查清單|勾選|選擇題|checklist)/i.test(prompt)) return 'checklist';
  return 'scenario';
}

const GUIDES = Object.freeze({
  chart: 'For a concise quantitative comparison, if you have 2–10 defensible numeric observations with clear labels, you MAY include one fenced crew-ui JSON block: {"version":1,"type":"chart","title":"...","kind":"bar","items":[{"label":"...","value":1},{"label":"...","value":2}]}. kind is bar or line. Numbers must be real evidence or clearly labelled hypothetical, never invented as measurements.',
  calculator: 'For a genuinely linear, illustrative estimate you MAY include one fenced crew-ui JSON block: {"version":1,"type":"calculator","title":"...","assumption":"explicit basis","input":{"label":"quantity","min":1,"max":10,"step":1,"value":5},"output":{"label":"result","base":50,"perUnit":10}}. The formula is base+(selected-initial)*perUnit. Never use for nonlinear relationships or unsupported rates.',
  checklist: 'For an actionable checklist you MAY include one fenced crew-ui JSON block: {"version":1,"type":"checklist","title":"...","items":["first step","second step"]}. Prefer ordinary Markdown if a checklist offers no interaction benefit. Do not treat selection as execution approval.',
  scenario: 'For 2–4 meaningful alternatives you MAY include one fenced crew-ui JSON block: {"version":1,"type":"scenario","title":"...","options":[{"label":"A","description":"...","facts":[{"label":"trade-off","value":"..."}]},{"label":"B","description":"...","facts":[]}]}. Use concise trustworthy differences, not fabricated facts.'
});

function buildInteractiveReplyGuide(prompt, options = {}) {
  const kind = presentationKind(prompt, options);
  if (!kind) return '';
  return [
    '[Crew Reply Presentation · optional visual formatting]',
    'Answer the actual user request first, in normal Markdown. An inline interactive card is OPTIONAL only when it adds clear value.',
    GUIDES[kind],
    'Use valid JSON inside a fenced crew-ui block; never emit HTML, CSS or JavaScript for the widget.',
    'Use at most one card, avoid duplicating the same content verbatim, and do not invent values, sources, execution results or approvals.',
    'If uncertain, answer with Markdown only. All widget data is model-authored and unverified; user actions only draft follow-up text.'
  ].join('\n');
}

module.exports = { presentationKind, buildInteractiveReplyGuide };
