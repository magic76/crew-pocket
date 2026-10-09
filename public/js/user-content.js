// Shared between the Node runtime (transcript/history/title) and the browser
// (user message bubble). Only the actual request belongs in a user bubble.
// Never edit the Codex session JSONL: clean at read/display boundaries instead.
(function registerCrewUserContent(root) {
  'use strict';

  const LEGACY_INTENT_PREAMBLE =
    /^\s*\[Approved Execution Intent\]\r?\n\{[^\r\n]*\}\r?\nThe intent is advisory and remains strictly bounded by the Execution Contract\. Do not perform intent items that exceed the approved mode or the original user request\.\s*/u;
  const LEGACY_SELF_DEBUG_PREAMBLE =
    /^\s*【Crew Embedded Self-Debug】\r?\n[^\r\n]*\r?\n\s*/u;

  function cleanCrewUserContent(raw) {
    if (raw == null || raw === '') return '';
    const original = String(raw);
    // Existing Role context and provider instructions can surround the
    // explicitly marked request. If the marker exists, this alone is the text
    // the user authored (preserving formatting and ordinary JSON).
    const request = original.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/u);
    if (request) return request[1].trim();

    let text = original
      .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gu, '')
      .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/gu, '');

    // Older Codex turns stored the intent in unmarked plaintext *before*
    // the actual prompt. Remove only the precise shape Crew Pocket emitted;
    // never remove an arbitrary JSON object or a user discussing intents.
    let previous;
    do {
      previous = text;
      text = text
        .replace(LEGACY_SELF_DEBUG_PREAMBLE, '')
        .replace(LEGACY_INTENT_PREAMBLE, '');
    } while (text !== previous);

    return text
      .replace(/^\[Crew Pocket：支援互動 HTML、Chart\.js 圖表、Google Maps、Android APK 與本機檔案；依使用者需求套用對應規則。\]\s*/u, '')
      .replace(/^\[Crew Pocket Capability Rules\]\s*[\s\S]*?\n\n/u, '')
      .replace(/\[Context:[\s\S]*?(?:\](?:\n\n|\n|$)|\[User Request\]:?\n*|$)/giu, '')
      .replace(/\[System Environment:[\s\S]*?(?:\[User Request\]:?\n*|$)/giu, '')
      .replace(/\[User Request\]:?\n*/giu, '')
      .replace(/(?:\s*<turn_aborted>[\s\S]*?<\/turn_aborted>\s*)+/giu, '')
      .replace(/^\s*turn_aborted\s*$/gimu, '')
      .trim();
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { cleanCrewUserContent };
  }
  if (root) root.cleanCrewUserContent = cleanCrewUserContent;
})(typeof window === 'object' ? window : null);
