/* P2: bounded data-driven inline visuals. The model supplies inert JSON, not HTML,
 * JavaScript, CSS, DOM actions, or an executable formula. Source Markdown is kept.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CrewRichWidgets = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const text = (value, max) => {
    if (typeof value !== 'string') return null;
    const result = value.trim();
    return result && result.length <= max && !/[\u0000-\u001f\u007f]/.test(result) ? result : null;
  };
  const numeric = (value, min, max) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  const optional = (value, max) => value == null || value === '' ? '' : text(value, max);
  const number = (n, digits = 2) => new Intl.NumberFormat('zh-TW', {
    maximumFractionDigits: digits
  }).format(n === 0 ? 0 : n);

  function normalizeSpec(value) {
    if (!record(value) || value.version !== 1) return null;
    const title = text(value.title, 90);
    const question = optional(value.question, 220);
    if (!title || question === null) return null;

    if (value.type === 'chart') {
      if (value.kind !== 'bar' && value.kind !== 'line') return null;
      const unit = optional(value.unit, 18);
      if (unit === null || !Array.isArray(value.items) ||
          value.items.length < 2 || value.items.length > 10) return null;
      const items = value.items.map(item => record(item) &&
        text(item.label, 48) && numeric(item.value, 0, 1e9)
          ? { label: text(item.label, 48), value: item.value } : null);
      if (items.some(item => !item) || new Set(items.map(item => item.label)).size !== items.length)
        return null;
      return { version: 1, type: 'chart', title, question, kind: value.kind, unit, items };
    }

    if (value.type === 'scenario') {
      if (!Array.isArray(value.options) || value.options.length < 2 ||
          value.options.length > 4) return null;
      const options = value.options.map(item => {
        if (!record(item)) return null;
        const label = text(item.label, 52);
        const description = text(item.description, 360);
        if (!label || !description || !Array.isArray(item.facts) ||
            item.facts.length > 4) return null;
        const facts = item.facts.map(fact => record(fact) &&
          text(fact.label, 42) && text(fact.value, 80)
            ? { label: text(fact.label, 42), value: text(fact.value, 80) } : null);
        return facts.every(Boolean) ? { label, description, facts } : null;
      });
      if (options.some(item => !item) ||
          new Set(options.map(item => item.label)).size !== options.length) return null;
      return { version: 1, type: 'scenario', title, question, options };
    }

    if (value.type === 'calculator') {
      const input = value.input, output = value.output;
      const assumption = text(value.assumption, 180);
      if (!record(input) || !record(output) || !assumption) return null;
      const inLabel = text(input.label, 55), inUnit = optional(input.unit, 18);
      const outLabel = text(output.label, 55), outUnit = optional(output.unit, 18);
      if (!inLabel || inUnit === null || !outLabel || outUnit === null) return null;
      if (!numeric(input.min, -1e6, 1e6) || !numeric(input.max, -1e6, 1e6) ||
          input.min >= input.max || !numeric(input.step, 0.0001, 1e5) ||
          !numeric(input.value, input.min, input.max) ||
          (input.max - input.min) / input.step > 1000 ||
          !numeric(output.base, -1e9, 1e9) ||
          !numeric(output.perUnit, -1e6, 1e6)) return null;
      const low = output.base + (input.min - input.value) * output.perUnit;
      const high = output.base + (input.max - input.value) * output.perUnit;
      if (![low, high].every(n => numeric(n, -1e9, 1e9))) return null;
      const precision = output.precision == null ? 2 : output.precision;
      if (!Number.isInteger(precision) || precision < 0 || precision > 2) return null;
      return {
        version: 1, type: 'calculator', title, question, assumption,
        input: { label: inLabel, unit: inUnit, min: input.min, max: input.max,
          step: input.step, value: input.value },
        output: { label: outLabel, unit: outUnit, base: output.base,
          perUnit: output.perUnit, precision }
      };
    }
    return null;
  }

  function calculate(spec, value) {
    if (spec?.type !== 'calculator' ||
        !numeric(value, spec.input.min, spec.input.max)) return null;
    const result = spec.output.base + (value - spec.input.value) * spec.output.perUnit;
    return Number.isFinite(result) ? result : null;
  }

  function chartHtml(spec) {
    const max = Math.max(...spec.items.map(item => item.value), 0);
    const units = spec.unit ? ' ' + escape(spec.unit) : '';
    const cells = spec.items.map(item =>
      '<tr><th scope="row">' + escape(item.label) + '</th><td>' +
      escape(number(item.value)) + units + '</td></tr>').join('');
    const table = '<details class="crew-rich-data"><summary>查看數值</summary>' +
      '<table><thead><tr><th scope="col">項目</th><th scope="col">數值</th></tr></thead>' +
      '<tbody>' + cells + '</tbody></table></details>';
    if (spec.kind === 'bar') {
      const bars = spec.items.map(item => {
        const width = max ? (100 * item.value / max).toFixed(2) : '0';
        return '<div class="crew-rich-bar-row"><span>' + escape(item.label) + '</span>' +
          '<div class="crew-rich-bar-track"><span class="crew-rich-bar-fill" style="width:' +
          width + '%"></span></div><strong>' + escape(number(item.value)) + units +
          '</strong></div>';
      }).join('');
      return '<div class="crew-rich-bars" aria-label="長條圖">' + bars + '</div>' + table;
    }
    const pointCoords = spec.items.map((item, index) => ({
      x: 18 + (264 * index / (spec.items.length - 1)),
      y: 116 - (max ? 92 * item.value / max : 0)
    }));
    const points = pointCoords.map(p => p.x.toFixed(2) + ',' + p.y.toFixed(2)).join(' ');
    const dots = pointCoords.map(p => '<circle cx="' + p.x.toFixed(2) +
      '" cy="' + p.y.toFixed(2) + '" r="3.5"></circle>').join('');
    return '<div class="crew-rich-line-wrap"><svg viewBox="0 0 300 130" role="img"' +
      ' aria-label="趨勢圖，詳細數值請展開下方表格">' +
      '<line class="crew-rich-axis" x1="18" y1="116" x2="282" y2="116"></line>' +
      '<polyline class="crew-rich-line" fill="none" points="' + points + '"></polyline>' +
      '<g class="crew-rich-dots">' + dots + '</g></svg>' +
      '<div class="crew-rich-endpoints"><span>' + escape(spec.items[0].label) +
      '</span><span>' + escape(spec.items[spec.items.length - 1].label) +
      '</span></div></div>' + table;
  }

  function scenarioPanel(spec, index) {
    const option = spec.options[index];
    return '<p class="crew-rich-description">' + escape(option.description) + '</p>' +
      (option.facts.length ? '<dl class="crew-rich-facts">' +
        option.facts.map(fact => '<div><dt>' + escape(fact.label) +
          '</dt><dd>' + escape(fact.value) + '</dd></div>').join('') + '</dl>' : '');
  }

  function widgetHtml(spec) {
    const heading = '<div class="crew-interactive-heading"><strong>' +
      escape(spec.title) + '</strong><span>AI 回覆資料 · 未驗證</span></div>';
    const question = spec.question ? '<p class="crew-interactive-question">' +
      escape(spec.question) + '</p>' : '';
    if (spec.type === 'chart') return heading + question + chartHtml(spec);
    const feedback = '<p class="crew-interactive-feedback" role="status" aria-live="polite"></p>';
    if (spec.type === 'scenario') {
      return heading + question + '<div class="crew-rich-tabs" role="tablist" aria-label="' +
        escape(spec.title) + '">' + spec.options.map((item, index) =>
        '<button type="button" role="tab" data-rich-tab="' + index +
        '" aria-selected="' + (index === 0) + '" tabindex="' + (index === 0 ? '0' : '-1') +
        '">' + escape(item.label) + '</button>').join('') +
        '</div><div class="crew-rich-scenario-panel" role="tabpanel" tabindex="0">' +
        scenarioPanel(spec, 0) + '</div><button type="button" class="crew-rich-apply"' +
        ' data-rich-apply="scenario">以此方案繼續</button>' + feedback;
    }
    const input = spec.input, output = spec.output;
    return heading + question + '<div class="crew-rich-calculator">' +
      '<label class="crew-rich-slider-label"><span>' + escape(input.label) +
      '</span><strong data-rich-input-value>' + escape(number(input.value, 4)) +
      (input.unit ? ' ' + escape(input.unit) : '') + '</strong></label>' +
      '<input type="range" data-rich-range min="' + input.min +
      '" max="' + input.max + '" step="' + input.step + '" value="' + input.value +
      '" aria-label="' + escape(input.label) + '">' +
      '<div class="crew-rich-range"><span>' + escape(number(input.min, 4)) +
      '</span><span>' + escape(number(input.max, 4)) + '</span></div>' +
      '<div class="crew-rich-result"><span>' + escape(output.label) +
      '</span><strong data-rich-output-value>' + escape(number(output.base, output.precision)) +
      (output.unit ? ' ' + escape(output.unit) : '') + '</strong></div>' +
      '<p class="crew-rich-assumption">示意試算 · ' + escape(spec.assumption) +
      '</p></div><button type="button" class="crew-rich-apply"' +
      ' data-rich-apply="calculator">用這個數值繼續</button>' + feedback;
  }

  function buildDraft(spec, value) {
    if (spec.type === 'scenario') {
      const option = spec.options[value];
      return option ? '針對剛才回覆的「' + spec.title + '」，我想採用「' +
        option.label + '」。請先確認影響、風險與實作步驟，不要直接執行。' : '';
    }
    if (spec.type === 'calculator' && calculate(spec, value) !== null) {
      return '針對「' + spec.title + '」的示意試算：\n' + spec.input.label +
        '：' + number(value, 4) + (spec.input.unit ? ' ' + spec.input.unit : '') +
        '\n' + spec.output.label + '：' + number(calculate(spec, value), spec.output.precision) +
        (spec.output.unit ? ' ' + spec.output.unit : '') +
        '\nAI 提供的假設：' + spec.assumption +
        '\n請根據這組參數進一步分析，先核實假設，不要視為已驗證數據。';
    }
    return '';
  }

  function mount(pre, spec, context, fillComposer) {
    if (!pre || !spec || !['chart', 'scenario', 'calculator'].includes(spec.type)) return false;
    const widget = document.createElement('section');
    widget.className = 'crew-interactive crew-rich-widget';
    widget.dataset.crewInteractive = spec.type;
    widget.setAttribute('aria-label', spec.title);
    widget.innerHTML = widgetHtml(spec);
    if (spec.type === 'scenario') {
      let active = 0;
      const tabs = [...widget.querySelectorAll('[data-rich-tab]')];
      function select(index, focus) {
        if (!Number.isInteger(index) || index < 0 || index >= spec.options.length) return;
        active = index;
        tabs.forEach((tab, i) => {
          tab.setAttribute('aria-selected', String(i === index));
          tab.setAttribute('tabindex', i === index ? '0' : '-1');
        });
        widget.querySelector('.crew-rich-scenario-panel').innerHTML = scenarioPanel(spec, index);
        if (focus) tabs[index].focus();
      }
      tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => select(index, false));
        tab.addEventListener('keydown', event => {
          const key = event.key;
          const next = key === 'ArrowRight' ? (index + 1) % tabs.length
            : key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
            : key === 'Home' ? 0 : key === 'End' ? tabs.length - 1 : null;
          if (next === null) return;
          event.preventDefault();
          select(next, true);
        });
      });
      widget.querySelector('[data-rich-apply]').addEventListener('click', () => {
        fillComposer(buildDraft(spec, active), context, widget);
      });
    }
    if (spec.type === 'calculator') {
      const slider = widget.querySelector('[data-rich-range]');
      function update() {
        const value = Number(slider.value);
        const result = calculate(spec, value);
        if (result === null) return;
        widget.querySelector('[data-rich-input-value]').textContent = number(value, 4) +
          (spec.input.unit ? ' ' + spec.input.unit : '');
        widget.querySelector('[data-rich-output-value]').textContent =
          number(result, spec.output.precision) +
          (spec.output.unit ? ' ' + spec.output.unit : '');
      }
      slider.addEventListener('input', update);
      widget.querySelector('[data-rich-apply]').addEventListener('click', () => {
        fillComposer(buildDraft(spec, Number(slider.value)), context, widget);
      });
    }
    pre.replaceWith(widget);
    return true;
  }
  return { normalizeSpec, calculate, chartHtml, widgetHtml, scenarioPanel, buildDraft, mount };
});
