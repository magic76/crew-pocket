/* Universal Visual Inspector P0: works with screenshots from any app.
 * No Accessibility, silent capture, or automatic AI submission. */
(function () {
  'use strict';

  const MAX_SIDE = 2400;
  const state = {
    image: null, shapes: [], draft: null, tool: 'rect', pointerId: null,
    objectUrl: null, busy: false, origin: '截圖'
  };
  let elements = null;

  function pointOnCanvas(event, canvas) {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - bounds.left) * canvas.width / bounds.width)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - bounds.top) * canvas.height / bounds.height))
    };
  }

  function drawShape(ctx, shape, width) {
    if (!shape) return;
    ctx.save();
    ctx.strokeStyle = '#fb923c';
    ctx.fillStyle = '#fb923c';
    ctx.lineWidth = Math.max(4, width / 350);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (shape.type === 'rect') {
      ctx.strokeRect(shape.start.x, shape.start.y,
        shape.end.x - shape.start.x, shape.end.y - shape.start.y);
    } else if (shape.type === 'pen') {
      ctx.beginPath();
      ctx.moveTo(shape.points[0].x, shape.points[0].y);
      for (const p of shape.points.slice(1)) ctx.lineTo(p.x, p.y);
      if (shape.points.length === 1) ctx.lineTo(shape.points[0].x + 0.1, shape.points[0].y);
      ctx.stroke();
    } else if (shape.type === 'arrow') {
      const dx = shape.end.x - shape.start.x;
      const dy = shape.end.y - shape.start.y;
      const angle = Math.atan2(dy, dx);
      const head = Math.max(16, width / 45);
      ctx.beginPath();
      ctx.moveTo(shape.start.x, shape.start.y);
      ctx.lineTo(shape.end.x, shape.end.y);
      ctx.lineTo(shape.end.x - head * Math.cos(angle - Math.PI / 6),
        shape.end.y - head * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(shape.end.x, shape.end.y);
      ctx.lineTo(shape.end.x - head * Math.cos(angle + Math.PI / 6),
        shape.end.y - head * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    }
    ctx.restore();
  }

  function render() {
    if (!elements || !state.image) return;
    const { canvas, undo } = elements;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(state.image, 0, 0, canvas.width, canvas.height);
    for (const shape of state.shapes) drawShape(ctx, shape, canvas.width);
    drawShape(ctx, state.draft, canvas.width);
    undo.disabled = !state.shapes.length || state.busy;
  }

  function setStatus(message, error) {
    if (!elements) return;
    elements.status.textContent = message || '';
    elements.status.dataset.error = error ? 'true' : 'false';
  }

  function selectTool(name) {
    if (!['rect', 'pen', 'arrow'].includes(name)) return;
    state.tool = name;
    if (!elements) return;
    for (const button of elements.tools.querySelectorAll('[data-visual-tool]')) {
      button.setAttribute('aria-pressed', String(button.dataset.visualTool === name));
    }
  }

  function onPointerDown(event) {
    if (!state.image || state.busy || state.pointerId !== null) return;
    event.preventDefault();
    state.pointerId = event.pointerId;
    const p = pointOnCanvas(event, elements.canvas);
    state.draft = state.tool === 'pen'
      ? { type: 'pen', points: [p] }
      : { type: state.tool, start: p, end: p };
    elements.canvas.setPointerCapture?.(event.pointerId);
    render();
  }

  function onPointerMove(event) {
    if (event.pointerId !== state.pointerId || !state.draft) return;
    event.preventDefault();
    const p = pointOnCanvas(event, elements.canvas);
    if (state.draft.type === 'pen') state.draft.points.push(p);
    else state.draft.end = p;
    render();
  }

  function finishPointer(event, cancelled) {
    if (event.pointerId !== state.pointerId) return;
    if (!cancelled && state.draft) {
      const shape = state.draft;
      const distance = shape.type === 'pen'
        ? shape.points.length
        : Math.hypot(shape.end.x - shape.start.x, shape.end.y - shape.start.y);
      if (distance > 3) state.shapes.push(shape);
    }
    state.draft = null;
    state.pointerId = null;
    render();
  }

  function close() {
    if (!elements || state.busy) return;
    elements.modal.classList.add('hidden');
    state.image = null;
    state.shapes = [];
    state.draft = null;
    state.pointerId = null;
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = null;
  }

  function openImage(url, origin, objectUrl) {
    if (!elements) init();
    if (!elements) return false;
    if (state.busy) return false;
    close();
    state.origin = origin || '截圖';
    state.objectUrl = objectUrl || null;
    elements.note.value = '';
    elements.modal.classList.remove('hidden');
    setStatus('正在載入畫面…');
    const image = new Image();
    image.onload = function () {
      if (state.objectUrl !== objectUrl && objectUrl) return;
      if (!image.naturalWidth || !image.naturalHeight) {
        setStatus('無法讀取圖片尺寸', true);
        return;
      }
      const ratio = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
      elements.canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      elements.canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      state.image = image;
      state.shapes = [];
      selectTool('rect');
      render();
      setStatus('圈選畫面後描述需求。圖片只會在你按下「附加到 Role」後送入對話。');
    };
    image.onerror = function () { setStatus('圖片無法載入，請重新選擇截圖。', true); };
    image.src = url;
    return true;
  }

  function openFromSharedScreen(url) {
    if (typeof url !== 'string') return false;
    const resolved = new URL(url, window.location.origin);
    if (resolved.origin !== window.location.origin ||
        resolved.pathname !== '/api/image' ||
        !resolved.searchParams.has('path')) return false;
    return openImage(resolved.href, 'Android 其他 App 分享截圖', null);
  }

  function openFromFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      if (elements) setStatus('請選擇圖片檔案。', true);
      return false;
    }
    if (file.size > 16 * 1024 * 1024) {
      if (elements) setStatus('圖片超過 16 MB，請先縮小檔案。', true);
      return false;
    }
    const url = URL.createObjectURL(file);
    return openImage(url, '相簿／檔案截圖', url);
  }

  async function attach() {
    if (!elements || !state.image || state.busy) return;
    if (typeof window.processAndUploadImageBase64 !== 'function') {
      setStatus('圖片附件尚未準備好，請重新開啟 Crew Pocket。', true);
      return;
    }
    if (typeof uploadedImagePath !== 'undefined' && uploadedImagePath &&
        !window.confirm('目前已有圖片附件，確定要用這張畫面標註取代嗎？')) return;
    state.busy = true;
    elements.attach.disabled = true;
    setStatus('正在儲存標註圖片…');
    try {
      const imageData = elements.canvas.toDataURL('image/jpeg', 0.88);
      const path = await window.processAndUploadImageBase64(imageData, 'visual-inspector.jpg');
      if (!path) throw new Error('圖片儲存失敗');
      const userNote = elements.note.value.trim();
      const request = [
        '【跨 App 畫面標註】',
        '來源：' + state.origin,
        '使用者需求：' + (userNote || '請先描述圈選區域及可能的問題。'),
        '請先根據標註畫面分析。如果目前 Role 的 Workspace 確實包含此 App 的原始碼，才嘗試定位檔案並提出修改；否則只分析或提供操作建議，不得聲稱已修改第三方 App。'
      ].join('\n');
      if (typeof window.setPrimaryTab === 'function') {
        window.setPrimaryTab('chat', { hapticFeedback: false });
      }
      const composer = document.getElementById('prompt-input');
      if (!composer) throw new Error('找不到對話輸入框');
      composer.value = (composer.value.trim() ? composer.value.trim() + '\n\n' : '') + request;
      composer.dispatchEvent(new Event('input', { bubbles: true }));
      state.busy = false;
      close();
      composer.focus();
    } catch (error) {
      setStatus('附加失敗：' + error.message, true);
    } finally {
      state.busy = false;
      elements.attach.disabled = false;
    }
  }

  function init() {
    if (elements || typeof document === 'undefined') return;
    const modal = document.getElementById('visual-inspector-modal');
    if (!modal) return;
    elements = {
      modal,
      canvas: document.getElementById('visual-inspector-canvas'),
      tools: document.getElementById('visual-inspector-tools'),
      note: document.getElementById('visual-inspector-note'),
      status: document.getElementById('visual-inspector-status'),
      undo: document.getElementById('visual-inspector-undo'),
      attach: document.getElementById('visual-inspector-attach')
    };
    elements.canvas.addEventListener('pointerdown', onPointerDown);
    elements.canvas.addEventListener('pointermove', onPointerMove);
    elements.canvas.addEventListener('pointerup', event => finishPointer(event, false));
    elements.canvas.addEventListener('pointercancel', event => finishPointer(event, true));
    elements.tools.addEventListener('click', event => {
      const button = event.target.closest('[data-visual-tool]');
      if (button) selectTool(button.dataset.visualTool);
    });
    elements.undo.addEventListener('click', () => { state.shapes.pop(); render(); });
    document.getElementById('visual-inspector-clear').addEventListener('click', () => {
      state.shapes = []; render();
    });
    document.getElementById('visual-inspector-close').addEventListener('click', close);
    elements.attach.addEventListener('click', attach);
    const picker = document.getElementById('visual-inspector-file');
    picker.addEventListener('change', () => {
      if (picker.files?.[0]) openFromFile(picker.files[0]);
      picker.value = '';
    });
    selectTool('rect');
  }

  window.CrewVisualInspector = { init, openFromFile, openFromSharedScreen, pointOnCanvas };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { pointOnCanvas };
  }
})();
