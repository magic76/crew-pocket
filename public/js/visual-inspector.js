/* Universal Visual Inspector P0: works with screenshots from any app.
 * No Accessibility or silent capture; sending always requires an explicit user action. */
(function () {
  'use strict';

  const MAX_SIDE = 2400;
  const state = {
    image: null, shapes: [], draft: null, tool: 'pan', pointerId: null,
    objectUrl: null, busy: false, origin: '截圖', loadVersion: 0,
    zoom: 1, fitWidth: 0, pointers: new Map(), pan: null, pinchDistance: 0,
    sharedImagePath: null, sharedImageUrl: null, pinchMidpoint: null,
    attachment: null, pending: null, roles: []
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
    undo.disabled = !state.shapes.length || state.busy || Boolean(state.pending);
  }

  function setStatus(message, error) {
    if (!elements) return;
    elements.status.textContent = message || '';
    elements.status.dataset.error = error ? 'true' : 'false';
  }

  function selectTool(name) {
    if (!['pan', 'rect', 'pen', 'arrow'].includes(name)) return;
    state.tool = name;
    if (!elements) return;
    for (const button of elements.tools.querySelectorAll('[data-visual-tool]')) {
      button.setAttribute('aria-pressed', String(button.dataset.visualTool === name));
    }
  }

  // The screenshot is a document first and an annotation surface second.
  // Manually pan at all zoom levels: drawing and navigation cannot steal each
  // other's gestures, including long screenshots on Android WebView.
  function fitToWidth() {
    if (!state.image || !elements) return;
    state.fitWidth = Math.max(1, Math.min(elements.canvas.width,
      elements.stage.clientWidth || elements.stage.getBoundingClientRect().width || 360));
    applyZoom(state.zoom);
  }

  function applyZoom(next, anchor = null) {
    if (!state.image || !elements) return;
    const stage = elements.stage;
    const canvas = elements.canvas;
    const zoom = Math.max(1, Math.min(4, next));
    const beforeWidth = canvas.getBoundingClientRect().width || state.fitWidth || canvas.width;
    const beforeHeight = beforeWidth * canvas.height / canvas.width;
    const rect = stage.getBoundingClientRect();
    const offsetX = anchor ? anchor.x - rect.left : (stage.clientWidth || rect.width) / 2;
    const offsetY = anchor ? anchor.y - rect.top : (stage.clientHeight || rect.height) / 2;
    const imageX = (stage.scrollLeft + offsetX) / beforeWidth;
    const imageY = (stage.scrollTop + offsetY) / beforeHeight;
    state.zoom = zoom;
    const afterWidth = Math.round(state.fitWidth * zoom);
    canvas.style.width = afterWidth + 'px';
    canvas.style.height = 'auto';
    stage.scrollLeft = Math.max(0, imageX * afterWidth - offsetX);
    stage.scrollTop = Math.max(0, imageY * afterWidth * canvas.height / canvas.width - offsetY);
    elements.zoomLabel.textContent = Math.round(zoom * 100) + '%';
    elements.zoomOut.disabled = zoom <= 1;
    elements.zoomIn.disabled = zoom >= 4;
  }

  function distanceBetweenPointers() {
    const pair = [...state.pointers.values()];
    if (pair.length < 2) return 0;
    return Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
  }

  function pointerMidpoint() {
    const pair = [...state.pointers.values()];
    if (pair.length < 2) return null;
    return { x: (pair[0].x + pair[1].x) / 2, y: (pair[0].y + pair[1].y) / 2 };
  }

  function onPointerDown(event) {
    if (!state.image || state.busy || state.pending) return;
    event.preventDefault();
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    elements.canvas.setPointerCapture?.(event.pointerId);

    if (state.pointers.size === 2) {
      state.draft = null; // second finger turns drawing into a navigation gesture
      state.pointerId = null;
      state.pan = null;
      state.pinchDistance = distanceBetweenPointers();
      state.pinchMidpoint = pointerMidpoint();
      render();
      return;
    }
    if (state.pointers.size > 2) return;
    if (state.tool === 'pan') {
      state.pan = {
        id: event.pointerId, x: event.clientX, y: event.clientY,
        left: elements.stage.scrollLeft, top: elements.stage.scrollTop
      };
      return;
    }
    state.pointerId = event.pointerId;
    const p = pointOnCanvas(event, elements.canvas);
    state.draft = state.tool === 'pen'
      ? { type: 'pen', points: [p] }
      : { type: state.tool, start: p, end: p };
    render();
  }

  function onPointerMove(event) {
    if (!state.pointers.has(event.pointerId)) return;
    event.preventDefault();
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (state.pointers.size >= 2) {
      const distance = distanceBetweenPointers();
      const midpoint = pointerMidpoint();
      if (state.pinchMidpoint && midpoint) {
        elements.stage.scrollLeft += state.pinchMidpoint.x - midpoint.x;
        elements.stage.scrollTop += state.pinchMidpoint.y - midpoint.y;
      }
      if (state.pinchDistance > 0 && distance > 0) {
        applyZoom(state.zoom * distance / state.pinchDistance, midpoint);
      }
      state.pinchDistance = distance;
      state.pinchMidpoint = midpoint;
      return;
    }
    if (state.tool === 'pan' && state.pan?.id === event.pointerId) {
      elements.stage.scrollLeft = state.pan.left + state.pan.x - event.clientX;
      elements.stage.scrollTop = state.pan.top + state.pan.y - event.clientY;
      return;
    }
    if (event.pointerId !== state.pointerId || !state.draft) return;
    const p = pointOnCanvas(event, elements.canvas);
    if (state.draft.type === 'pen') state.draft.points.push(p);
    else state.draft.end = p;
    render();
  }

  function finishPointer(event, cancelled) {
    if (!state.pointers.has(event.pointerId)) return;
    state.pointers.delete(event.pointerId);
    if (!cancelled && event.pointerId === state.pointerId && state.draft) {
      const shape = state.draft;
      const distance = shape.type === 'pen'
        ? Math.hypot(
          shape.points.at(-1).x - shape.points[0].x,
          shape.points.at(-1).y - shape.points[0].y
        )
        : Math.hypot(shape.end.x - shape.start.x, shape.end.y - shape.start.y);
      if (distance > 3) state.shapes.push(shape);
    }
    state.draft = null;
    state.pointerId = null;
    state.pinchDistance = 0;
    state.pinchMidpoint = null;
    state.pan = null;
    // After releasing a pinch, the remaining finger can continue panning,
    // but never accidentally draw a new annotation.
    if (state.tool === 'pan' && state.pointers.size === 1) {
      const [id, point] = [...state.pointers.entries()][0];
      state.pan = {
        id, x: point.x, y: point.y,
        left: elements.stage.scrollLeft, top: elements.stage.scrollTop
      };
    }
    render();
  }

  function close() {
    if (!elements || state.busy) return;
    elements.modal.classList.add('hidden');
    state.loadVersion++;
    state.image = null;
    state.shapes = [];
    state.draft = null;
    state.pointerId = null;
    state.pointers.clear();
    state.pan = null;
    state.pinchDistance = 0;
    state.pinchMidpoint = null;
    state.attachment = null;
    state.pending = null;
    state.sharedImagePath = null;
    state.sharedImageUrl = null;
    state.zoom = 1;
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = null;
  }

  function openImage(url, origin, objectUrl) {
    if (!elements) init();
    if (!elements) return false;
    if (state.busy) return false;
    close();
    const version = state.loadVersion;
    state.origin = origin || '截圖';
    state.objectUrl = objectUrl || null;
    elements.modal.dataset.entry = state.origin.startsWith('Android') ? 'shared' : 'picker';
    elements.note.value = '';
    elements.noteDetails.open = false;
    elements.zoomLabel.textContent = '100%';
    elements.modal.classList.remove('hidden');
    setSending(false);
    void loadRoles(version);
    setStatus('正在載入畫面…');
    const image = new Image();
    image.onload = function () {
      if (state.loadVersion !== version) return;
      if (!image.naturalWidth || !image.naturalHeight) {
        setStatus('無法讀取圖片尺寸', true);
        return;
      }
      const ratio = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
      elements.canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      elements.canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      state.image = image;
      state.shapes = [];
      state.zoom = 1;
      selectTool('pan');
      fitToWidth();
      render();
      // A long image starts at the top, not centered halfway down the capture.
      elements.stage.scrollTop = 0;
      elements.stage.scrollLeft = 0;
      setStatus('上下滑動檢視畫面；需要圈選時再選工具。');
    };
    image.onerror = function () {
      if (state.loadVersion === version) setStatus('圖片無法載入，請重新選擇截圖。', true);
    };
    image.src = url;
    return true;
  }

  function openFromSharedScreen(url) {
    if (typeof url !== 'string') return false;
    try {
      const resolved = new URL(url, window.location.origin);
      if (resolved.origin !== window.location.origin ||
          resolved.pathname !== '/api/image' ||
          !resolved.searchParams.has('path')) return false;
      const opened = openImage(resolved.href, 'Android 其他 App 分享截圖', null);
      if (opened) {
        state.sharedImagePath = resolved.searchParams.get('path');
        state.sharedImageUrl = resolved.href;
      }
      return opened;
    } catch (_) { return false; }
  }

  function openFromFile(file) {
    if (state.busy) return false;
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

  async function loadRoles(version) {
    elements.send.disabled = true;
    elements.attach.disabled = true;
    const current = window.getCurrentRoleId?.() || 'role-general';
    elements.role.replaceChildren();
    try {
      const response = await fetch('/api/roles', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.roles)) throw new Error(data.error || '無法讀取 Role 清單');
      if (version !== state.loadVersion) return;
      state.roles = data.roles;
      for (const role of state.roles) {
        const option = document.createElement('option');
        option.value = role.id; option.textContent = role.name;
        elements.role.appendChild(option);
      }
      // Do not silently route a missing current Role to a different recipient.
      elements.role.value = state.roles.some(role => role.id === current) ? current : '';
      setSending(false);
    } catch (error) {
      if (version === state.loadVersion) setStatus(error.message + '；請重新開啟快速分享。', true);
    }
  }

  function requestText() {
    const inferred = state.shapes.length
      ? '請分析我標註的位置，協助定位問題或提出修改建議。'
      : '請先分析這張截圖，協助我確認畫面與可能的問題。';
    return [ '【跨 App 畫面標註】', '來源：' + state.origin,
      '使用者需求：' + (elements.note.value.trim() || inferred),
      '標註：' + (state.shapes.length ? '已將框選／畫筆／箭頭合成到附件，請優先分析標註區域。' : '無'),
      '請先根據標註畫面分析。如果目前 Role 的 Workspace 確實包含此 App 的原始碼，才嘗試定位檔案並提出修改；否則只分析或提供操作建議，不得聲稱已修改第三方 App。'
    ].join('\n');
  }

  // Upload without touching the currently viewed Role's composer/attachment.
  async function imagePath() {
    if (state.sharedImagePath && !state.shapes.length) return state.sharedImagePath;
    const signature = JSON.stringify(state.shapes);
    if (state.attachment?.signature === signature) return state.attachment.path;
    const response = await fetch('/api/upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: elements.canvas.toDataURL('image/jpeg', 0.88), filename: 'visual-inspector.jpg' })
    });
    const data = await response.json();
    if (!response.ok || !data.success || !data.filePath) throw new Error(data.error || '圖片儲存失敗');
    state.attachment = { signature, path: data.filePath };
    return data.filePath;
  }

  function setSending(busy) {
    state.busy = busy;
    const frozen = busy || Boolean(state.pending);
    const roleReady = Boolean(elements.role.value);
    elements.send.disabled = busy || !roleReady;
    elements.attach.disabled = frozen || !roleReady;
    elements.role.disabled = frozen;
    elements.note.disabled = frozen;
    elements.send.textContent = busy ? '發送中…' : state.pending ? '確認／重試發送' : '立即發送';
    for (const button of elements.modal.querySelectorAll('button')) {
      if (button !== elements.send && button !== elements.attach) button.disabled = frozen;
    }
    elements.picker.disabled = frozen;
    render();
  }

  async function sendNow() {
    if (!elements || !state.image || state.busy || !elements.role.value) return;
    setSending(true);
    setStatus('正在提交給 Role…');
    let timer;
    try {
      if (!state.pending) {
        const path = await imagePath();
        state.pending = { request_id: window.crypto.randomUUID(), role_id: elements.role.value,
          prompt: requestText(), image_path: path };
      }
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), 20000);
      const response = await fetch('/api/role-submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.pending), signal: controller.signal
      });
      const data = await response.json();
      if (!response.ok || !data.success || !data.submission) {
        // A definitive rejection means it is safe to edit and resubmit.
        if (response.status >= 400 && response.status < 500) state.pending = null;
        throw new Error(data.error || '提交未確認');
      }
      if (data.submission.status === 'unknown') throw new Error(data.submission.error || '先前執行狀態未知，請查看目標對話');
      if (['failed', 'cancelled'].includes(data.submission.status)) {
        state.pending = null;
        throw new Error(data.submission.error || '先前提交執行失敗，請重試');
      }
      const roleName = state.roles.find(role => role.id === state.pending.role_id)?.name || state.pending.role_id;
      setSending(false);
      close();
      if (typeof window.showToast === 'function') window.showToast('已送給 ' + roleName);
      else {
        const toast = document.createElement('div');
        toast.className = 'visual-inspector-toast'; toast.setAttribute('role', 'status');
        toast.textContent = '已送給 ' + roleName;
        document.body.appendChild(toast); setTimeout(() => toast.remove(), 4000);
      }
    } catch (error) {
      setStatus('發送失敗：' + (error.name === 'AbortError' ? '連線逾時' : error.message) +
        (state.pending ? '。提交狀態未確認；重試會確認同一項需求，不會重複提交。' : ''), true);
    } finally {
      clearTimeout(timer);
      setSending(false);
    }
  }

  async function attach() {
    if (!elements || !state.image || state.busy || state.pending || !elements.role.value) return;
    setSending(true);
    setStatus('正在儲存標註圖片…');
    try {
      const target = elements.role.value;
      const path = await imagePath();
      const request = requestText();
      if (target !== window.getCurrentRoleId?.()) {
        if (!window.openCrewCockpitRole) throw new Error('Role 切換尚未準備好');
        await window.openCrewCockpitRole(target);
        if (window.getCurrentRoleId?.() !== target) throw new Error('Role 切換失敗');
      }
      if (typeof uploadedImagePath !== 'undefined' && uploadedImagePath &&
          !window.confirm('目前已有圖片附件，確定要取代嗎？')) return;
      if (!window.attachExistingImagePath) throw new Error('圖片附件尚未準備好');
      window.attachExistingImagePath(path, state.sharedImagePath === path ? state.sharedImageUrl : '/api/image?path=' + encodeURIComponent(path));
      window.setPrimaryTab?.('chat', { hapticFeedback: false });
      const composer = document.getElementById('prompt-input');
      if (!composer) throw new Error('找不到對話輸入框');
      composer.value = (composer.value.trim() ? composer.value.trim() + '\n\n' : '') + request;
      composer.dispatchEvent(new Event('input', { bubbles: true }));
      setSending(false); close(); composer.focus();
    } catch (error) { setStatus('附加失敗：' + error.message, true); }
    finally { setSending(false); }
  }

  function init() {
    if (elements || typeof document === 'undefined') return;
    const modal = document.getElementById('visual-inspector-modal');
    if (!modal) return;
    elements = {
      modal,
      canvas: document.getElementById('visual-inspector-canvas'),
      stage: document.getElementById('visual-inspector-stage'),
      noteDetails: document.getElementById('visual-inspector-note-details'),
      zoomOut: document.getElementById('visual-inspector-zoom-out'),
      zoomIn: document.getElementById('visual-inspector-zoom-in'),
      zoomLabel: document.getElementById('visual-inspector-zoom-label'),
      tools: document.getElementById('visual-inspector-tools'),
      note: document.getElementById('visual-inspector-note'),
      status: document.getElementById('visual-inspector-status'),
      undo: document.getElementById('visual-inspector-undo'),
      attach: document.getElementById('visual-inspector-attach'),
      send: document.getElementById('visual-inspector-send'),
      role: document.getElementById('visual-inspector-role'),
      picker: document.getElementById('visual-inspector-file')
    };
    elements.canvas.addEventListener('pointerdown', onPointerDown);
    elements.canvas.addEventListener('pointermove', onPointerMove);
    elements.canvas.addEventListener('pointerup', event => finishPointer(event, false));
    elements.canvas.addEventListener('pointercancel', event => finishPointer(event, true));
    elements.zoomOut.addEventListener('click', () => applyZoom(state.zoom / 1.5));
    elements.zoomIn.addEventListener('click', () => applyZoom(state.zoom * 1.5));
    document.getElementById('visual-inspector-fit').addEventListener('click', () => {
      state.zoom = 1; fitToWidth(); elements.stage.scrollTop = 0; elements.stage.scrollLeft = 0;
    });
    window.addEventListener('resize', () => {
      if (state.image && !elements.modal.classList.contains('hidden')) fitToWidth();
    });
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
    elements.send.addEventListener('click', sendNow);
    elements.role.addEventListener('change', () => setSending(false));
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
