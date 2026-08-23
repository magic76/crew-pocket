/**
 * 🎙️ Crew Pocket - Option A: Pure Inline Live Voice Card (No Distracting Background Sync)
 * Direct Real-Time Multimodal Communication in Dedicated Live Card UI.
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'crew_pocket_gemini_api_key';
  const VOICE_KEY = 'crew_pocket_live_voice';
  const MODEL_KEY = 'crew_pocket_live_model';
  const DEFAULT_VOICE = 'Puck';
  const DEFAULT_MODEL = 'models/gemini-3.1-flash-live-preview';

  // State
  let ws = null;
  let audioContext = null;
  let micMediaStream = null;
  let micAudioSource = null;
  let micProcessorNode = null;
  let silentGainNode = null;
  let audioPlayer = null;
  let isConnected = false;
  let isMuted = false;
  let isCameraOn = false;
  let cameraFacingMode = 'environment';
  let cameraStream = null;
  let cameraInterval = null;
  let analyser = null;
  let animFrameId = null;
  let audioSendBuffer = [];
  
  // Real-time STT & Session Dialogue Tracker
  let speechRecognizer = null;
  let sessionDialogueTurns = [];
  let currentTurnUser = '';
  let currentTurnModel = '';
  let lastUserSpokeTime = 0;
  let lastVideoFrameSentTime = 0;
  let isCameraExpanded = false;
  let liveCallStartTs = 0;

  // DOM References
  const liveVoiceBtn = document.getElementById('live-voice-btn');
  const liveKeyModal = document.getElementById('live-key-modal');
  const liveApiKeyInput = document.getElementById('live-api-key-input');
  const liveModelSelect = document.getElementById('live-model-select');
  const liveVoiceSelect = document.getElementById('live-voice-select');
  const liveSaveKeyBtn = document.getElementById('live-save-key-btn');
  const liveCloseKeyBtn = document.getElementById('live-close-key-btn');
  const messagesContainer = document.getElementById('messages-container');

  // ==========================================
  // 🔊 Gapless 24kHz PCM Audio Stream Player (with 35ms Jitter Buffer)
  // ==========================================
  class LiveAudioPlayer {
    constructor(ctx) {
      this.ctx = ctx;
      this.nextStartTime = 0;
      this.activeSources = [];
      this.jitterBufferSec = 0.035; // 35ms smooth jitter buffer to eliminate pops/stutters
    }

    playChunk(float32Array, sampleRate = 24000) {
      if (!float32Array || float32Array.length === 0) return;
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }

      const audioBuffer = this.ctx.createBuffer(1, float32Array.length, sampleRate);
      audioBuffer.getChannelData(0).set(float32Array);

      const source = this.ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.ctx.destination);

      if (analyser) {
        source.connect(analyser);
      }

      const currentTime = this.ctx.currentTime;
      let startTime = this.nextStartTime;
      if (startTime < currentTime) {
        startTime = currentTime + this.jitterBufferSec;
      }

      source.start(startTime);
      this.nextStartTime = startTime + audioBuffer.duration;

      this.activeSources.push(source);
      source.onended = () => {
        const idx = this.activeSources.indexOf(source);
        if (idx > -1) this.activeSources.splice(idx, 1);
        if (this.activeSources.length === 0 && isConnected && !isMuted) {
          updateCardStatus('listening', '🎙️ 可以開始說話');
        }
      };
    }

    stopAll() {
      for (const src of this.activeSources) {
        try { src.stop(); } catch (e) {}
      }
      this.activeSources = [];
      if (this.ctx) {
        this.nextStartTime = this.ctx.currentTime;
      }
    }
  }

  // ==========================================
  // 🧮 Audio Data Conversion Utilities
  // ==========================================
  function floatTo16BitPCM(float32Array) {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    let offset = 0;
    for (let i = 0; i < float32Array.length; i++, offset += 2) {
      let s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return buffer;
  }

  function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    const chunkSize = 0x8000;
    for (let i = 0; i < len; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)));
    }
    return window.btoa(binary);
  }

  function base64ToFloat32PCM(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const dataView = new DataView(bytes.buffer);
    const numSamples = Math.floor(len / 2);
    const float32 = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      const int16 = dataView.getInt16(i * 2, true);
      float32[i] = int16 / 32768.0;
    }
    return float32;
  }

  function downsampleBuffer(buffer, inputSampleRate, outputSampleRate = 16000) {
    if (inputSampleRate === outputSampleRate) return buffer;
    if (inputSampleRate < outputSampleRate) return buffer;
    const sampleRateRatio = inputSampleRate / outputSampleRate;
    const newLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
      let accum = 0, count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
        accum += buffer[i];
        count++;
      }
      result[offsetResult] = count > 0 ? accum / count : 0;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ==========================================
  // 🌟 Option A: Inline Live Card DOM Management
  // ==========================================
  function createInlineCardElement() {
    removeInlineCard();

    const selectedVoice = getSelectedVoice();

    const card = document.createElement('div');
    card.id = 'live-inline-card';
    card.className = 'flex gap-2.5 w-full max-w-2xl mx-auto justify-start transition-all duration-300 animate-fadeIn';
    
    card.innerHTML = `
      <div class="w-7 h-7 rounded-full bg-teal-500/20 border border-teal-500/50 text-teal-300 flex items-center justify-center shrink-0 text-xs font-bold mt-0.5 shadow-sm shadow-teal-500/30">
        🎙️
      </div>

      <div class="bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 border border-teal-500/50 rounded-2xl rounded-tl-none p-3.5 text-xs sm:text-sm shadow-2xl shadow-teal-950/50 flex-1 max-w-[92%] space-y-3 relative overflow-hidden">
        
        <!-- CARD TOP TOOLBAR (兩排結構，掛斷放置於第二排尾端) -->
        <div class="border-b border-slate-800/80 pb-2.5 space-y-2">
          
          <!-- Row 1: 狀態指示 (靠左) + 音色選擇膠囊 (靠右) -->
          <div class="flex items-center justify-between gap-2 min-w-0">
            <div class="flex items-center gap-1.5 min-w-0">
              <span id="live-card-status-dot" class="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0"></span>
              <span id="live-card-status-text" class="text-amber-300 font-bold text-xs font-mono truncate">⚡ 準備中...</span>
            </div>
            
            <!-- 🗣️ Voice Selector Pill (音色切換膠囊 · 靠右放置) -->
            <div class="relative inline-flex items-center shrink-0">
              <select id="live-card-voice-select" class="appearance-none bg-teal-950/80 hover:bg-teal-900 active:scale-95 border border-teal-500/50 text-teal-300 text-[11px] font-semibold rounded-full pl-2.5 pr-4.5 py-0.5 outline-none transition cursor-pointer shadow-sm" title="點擊切換音色">
                <option value="Puck" ${selectedVoice === 'Puck' ? 'selected' : ''}>🗣️ Puck (活潑)</option>
                <option value="Charon" ${selectedVoice === 'Charon' ? 'selected' : ''}>🗣️ Charon (沉穩)</option>
                <option value="Kore" ${selectedVoice === 'Kore' ? 'selected' : ''}>🗣️ Kore (溫柔)</option>
                <option value="Fenrir" ${selectedVoice === 'Fenrir' ? 'selected' : ''}>🗣️ Fenrir (低沉)</option>
                <option value="Aoede" ${selectedVoice === 'Aoede' ? 'selected' : ''}>🗣️ Aoede (明亮)</option>
              </select>
              <span class="pointer-events-none absolute right-1.5 text-[9px] text-teal-400 font-mono">▾</span>
            </div>
          </div>

          <!-- Row 2: 靜音、相機與掛斷控制按鈕 (掛斷置於尾端) -->
          <div class="flex items-center justify-end gap-2 pt-0.5">
            <!-- 🔇 Mute Button -->
            <button id="live-card-mute-btn" type="button" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition shadow-sm" title="靜音 / 開啟麥克風">
              <span id="live-card-mute-icon">🎙️</span>
              <span id="live-card-mute-label">靜音</span>
            </button>

            <!-- 📷 Camera Toggle Button -->
            <button id="live-card-camera-btn" type="button" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition shadow-sm" title="開啟相機 (視覺辨識)">
              <span>📷</span>
              <span id="live-card-camera-label">相機</span>
            </button>

            <!-- 🛑 掛斷按鈕 (第二排尾端) -->
            <button id="live-card-hangup-btn" type="button" class="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-95 text-white text-xs font-bold shadow-md shadow-rose-600/30 transition shrink-0">
              掛斷
            </button>
          </div>

        </div>

        <!-- 📷 CAMERA EXPANSION VIEW (相機展開區) -->
        <div id="live-card-camera-box" class="hidden transition-all duration-300 overflow-hidden rounded-xl border border-indigo-500/40 bg-slate-950 relative">
          <video id="live-card-video" autoplay playsinline muted class="w-full max-h-52 object-contain bg-black rounded-lg transition-all duration-300"></video>
          
          <!-- Top Badge (智慧節流指示燈) -->
          <div id="live-card-camera-badge" class="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/80 border border-slate-700 text-[10px] text-slate-300 font-mono flex items-center gap-1 shadow-md pointer-events-none">
            <span id="live-camera-badge-dot" class="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
            <span id="live-camera-badge-text">待命中 (說話時自動發送)</span>
          </div>

          <!-- Bottom Camera Controls: 📸 截圖存檔 + ⛶ 放大 + 🔄 切換鏡頭 -->
          <div class="absolute bottom-2 right-2 flex gap-1.5 z-10 flex-wrap justify-end">
            <button id="live-card-snap-btn" type="button" class="px-2.5 py-1 rounded-lg bg-teal-950/90 hover:bg-teal-900 text-[10px] text-teal-300 border border-teal-500/50 font-mono flex items-center gap-1 shadow-md active:scale-95 transition" title="截圖儲存並發送高畫質畫面給 AI">
              📸 截圖存檔
            </button>
            <button id="live-card-expand-btn" type="button" class="px-2.5 py-1 rounded-lg bg-indigo-950/90 hover:bg-indigo-900 text-[10px] text-indigo-300 border border-indigo-500/50 font-mono flex items-center gap-1 shadow-md active:scale-95 transition" title="放大 / 縮小鏡頭預覽">
              ⛶ 放大
            </button>
            <button id="live-card-flip-btn" type="button" class="px-2.5 py-1 rounded-lg bg-black/80 hover:bg-black text-[10px] text-slate-200 border border-slate-700 font-mono flex items-center gap-1 shadow-md active:scale-95 transition">
              🔄 切換
            </button>
          </div>
        </div>

        <!-- Live Wave Spectrum Canvas -->
        <div class="h-8 w-full flex items-center justify-center bg-black/50 rounded-xl px-2">
          <canvas id="live-card-canvas" width="280" height="32" class="w-full h-full"></canvas>
        </div>

        <!-- Real-time Dialogue Subtitles (純 Live 對話區) -->
        <div id="live-card-transcript" class="space-y-1.5 text-xs max-h-48 overflow-y-auto pr-1">
          <div id="live-card-placeholder" class="text-slate-500 text-center text-[11px] font-mono py-1">💬 請說話...</div>
        </div>

      </div>
    `;

    if (messagesContainer) {
      messagesContainer.appendChild(card);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // Attach Inline Controls
    const voiceSelect = card.querySelector('#live-card-voice-select');
    if (voiceSelect) {
      voiceSelect.addEventListener('change', async () => {
        const newVoice = voiceSelect.value;
        localStorage.setItem(VOICE_KEY, newVoice);
        if (liveVoiceSelect) liveVoiceSelect.value = newVoice;
        if (isConnected) {
          await endLiveSession();
          setTimeout(startLiveSession, 300);
        }
      });
    }

    const muteBtn = card.querySelector('#live-card-mute-btn');
    if (muteBtn) muteBtn.addEventListener('click', toggleMute);

    const cameraBtn = card.querySelector('#live-card-camera-btn');
    if (cameraBtn) cameraBtn.addEventListener('click', toggleCamera);

    const snapBtn = card.querySelector('#live-card-snap-btn');
    if (snapBtn) snapBtn.addEventListener('click', snapPhoto);

    const expandBtn = card.querySelector('#live-card-expand-btn');
    if (expandBtn) expandBtn.addEventListener('click', toggleCameraExpand);

    const flipBtn = card.querySelector('#live-card-flip-btn');
    if (flipBtn) flipBtn.addEventListener('click', flipCamera);

    const hangupBtn = card.querySelector('#live-card-hangup-btn');
    if (hangupBtn) hangupBtn.addEventListener('click', endLiveSession);

    return card;
  }

  function removeInlineCard() {
    const existing = document.getElementById('live-inline-card');
    if (existing) existing.remove();
  }

  function updateCardStatus(state, text) {
    const statusText = document.getElementById('live-card-status-text');
    const statusDot = document.getElementById('live-card-status-dot');
    if (statusText) statusText.textContent = text;
    if (statusDot) {
      if (state === 'speaking') {
        statusDot.className = 'w-2 h-2 rounded-full bg-indigo-400 animate-pulse';
        if (statusText) statusText.className = 'text-indigo-300 font-bold text-xs font-mono truncate';
      } else if (state === 'muted') {
        statusDot.className = 'w-2 h-2 rounded-full bg-rose-500';
        if (statusText) statusText.className = 'text-rose-400 font-bold text-xs font-mono truncate';
      } else if (state === 'error') {
        statusDot.className = 'w-2 h-2 rounded-full bg-rose-500';
        if (statusText) statusText.className = 'text-rose-400 font-bold text-xs font-mono truncate';
      } else if (state === 'connecting') {
        statusDot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse';
        if (statusText) statusText.className = 'text-amber-300 font-bold text-xs font-mono truncate';
      } else {
        statusDot.className = 'w-2 h-2 rounded-full bg-teal-400 animate-pulse';
        if (statusText) statusText.className = 'text-teal-300 font-bold text-xs font-mono truncate';
      }
    }
  }

  function appendCardTranscript(role, text) {
    const drawer = document.getElementById('live-card-transcript');
    if (!drawer || !text) return;

    const placeholder = document.getElementById('live-card-placeholder');
    if (placeholder) placeholder.remove();

    const p = document.createElement('div');
    p.className = `p-2 rounded-xl border leading-relaxed text-xs transition-all ${
      role === 'user' ? 'bg-indigo-950/60 border-indigo-500/30 text-indigo-200' :
      role === 'system' ? 'bg-amber-950/60 border-amber-500/30 text-amber-300 text-[11px] font-mono' :
      'bg-slate-900/90 border-teal-500/30 text-slate-100'
    }`;
    p.innerHTML = (role === 'user' ? '🗣️ <b>我：</b> ' : role === 'system' ? '⚠️ ' : '✨ <b>Gemini：</b> ') + escapeHtml(text);
    drawer.appendChild(p);
    drawer.scrollTop = drawer.scrollHeight;

    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }

  // ==========================================
  // 🎨 Real-time Audio Spectrum Visualizer
  // ==========================================
  function startVisualizer() {
    const canvas = document.getElementById('live-card-canvas');
    if (!canvas) return;
    const canvasCtx = canvas.getContext('2d');
    const bufferLength = analyser ? analyser.frequencyBinCount : 32;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
      animFrameId = requestAnimationFrame(draw);
      const width = canvas.width;
      const height = canvas.height;

      if (analyser) {
        analyser.getByteFrequencyData(dataArray);
      }

      canvasCtx.clearRect(0, 0, width, height);

      if (isMuted) {
        canvasCtx.strokeStyle = '#475569';
        canvasCtx.lineWidth = 2;
        canvasCtx.beginPath();
        canvasCtx.moveTo(10, height / 2);
        canvasCtx.lineTo(width - 10, height / 2);
        canvasCtx.stroke();
        return;
      }

      const barCount = 28;
      const barWidth = (width / barCount) * 0.7;
      const gap = (width / barCount) * 0.3;

      for (let i = 0; i < barCount; i++) {
        const val = dataArray[i * 2] || 0;
        const percent = val / 255;
        const barHeight = Math.max(3, percent * height * 0.85);
        const x = i * (barWidth + gap) + gap / 2;
        const y = (height - barHeight) / 2;

        const gradient = canvasCtx.createLinearGradient(0, y, 0, y + barHeight);
        if (isConnected) {
          gradient.addColorStop(0, '#2dd4bf'); // teal
          gradient.addColorStop(0.5, '#6366f1'); // indigo
          gradient.addColorStop(1, '#ec4899'); // pink
        } else {
          gradient.addColorStop(0, '#64748b');
          gradient.addColorStop(1, '#334155');
        }

        canvasCtx.fillStyle = gradient;
        canvasCtx.beginPath();
        canvasCtx.roundRect(x, y, barWidth, barHeight, 3);
        canvasCtx.fill();
      }
    }
    draw();
  }

  function stopVisualizer() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  // ==========================================
  // 🎙️ Pure Native Audio Pipeline (No OS Chimes)
  // ==========================================
  // Gemini 2.0 Live directly understands 16kHz raw PCM audio.
  // SpeechRecognition is removed to eliminate repetitive Android OS mic activation chimes ("噔噔噔").
  function stopSpeechRecognition() {
    if (speechRecognizer) {
      try { speechRecognizer.stop(); } catch (e) {}
      speechRecognizer = null;
    }
  }

  // ==========================================
  // 🔇 Mute, 📷 Smart Camera & 📸 Snapshot Controls
  // ==========================================
  function updateCameraBadge(isSending, text) {
    const badgeDot = document.getElementById('live-camera-badge-dot');
    const badgeText = document.getElementById('live-camera-badge-text');
    if (badgeText) badgeText.textContent = text;
    if (badgeDot) {
      badgeDot.className = isSending 
        ? 'w-1.5 h-1.5 rounded-full bg-teal-400 animate-ping' 
        : 'w-1.5 h-1.5 rounded-full bg-slate-500';
    }
  }

  function toggleCameraExpand() {
    isCameraExpanded = !isCameraExpanded;
    const video = document.getElementById('live-card-video');
    const expandBtn = document.getElementById('live-card-expand-btn');

    if (video) {
      if (isCameraExpanded) {
        video.classList.remove('max-h-52');
        video.classList.add('max-h-[70vh]', 'h-[50vh]');
        if (expandBtn) expandBtn.innerHTML = '🗗 縮小';
      } else {
        video.classList.remove('max-h-[70vh]', 'h-[50vh]');
        video.classList.add('max-h-52');
        if (expandBtn) expandBtn.innerHTML = '⛶ 放大';
      }
    }

    setTimeout(() => {
      const liveCard = document.getElementById('live-inline-card');
      if (liveCard) {
        liveCard.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    }, 120);
  }

  async function snapPhoto() {
    const video = document.getElementById('live-card-video');
    const snapBtn = document.getElementById('live-card-snap-btn');
    if (!video || video.videoWidth === 0) return;

    try {
      const snapCanvas = document.createElement('canvas');
      // Full original sensor resolution (1080p / 720p)
      snapCanvas.width = video.videoWidth;
      snapCanvas.height = video.videoHeight;
      const snapCtx = snapCanvas.getContext('2d');
      snapCtx.drawImage(video, 0, 0);

      const dataUrl = snapCanvas.toDataURL('image/jpeg', 0.9);
      const cleanBase64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');

      // 1. Send high-res snapshot to Gemini Live for immediate inspection
      if (ws && ws.readyState === WebSocket.OPEN) {
        const videoMsg = {
          realtimeInput: {
            mediaChunks: [
              {
                mimeType: "image/jpeg",
                data: cleanBase64
              }
            ]
          }
        };
        ws.send(JSON.stringify(videoMsg));
        updateCameraBadge(true, '📸 已傳送高清截圖給 AI');
      }

      // 2. Save snapshot locally to uploads directory
      fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: `snapshot_${Date.now()}.jpg`,
          imageBase64: dataUrl
        })
      }).catch(e => console.warn('[Snapshot Upload Warn]', e));

      if (snapBtn) {
        snapBtn.innerHTML = '✅ 已存檔';
        setTimeout(() => {
          if (snapBtn) snapBtn.innerHTML = '📸 截圖存檔';
        }, 1500);
      }
    } catch (err) {
      console.warn('[Snapshot Error]', err);
    }
  }

  function toggleMute() {
    isMuted = !isMuted;
    if (micMediaStream) {
      micMediaStream.getAudioTracks().forEach(t => {
        t.enabled = !isMuted;
      });
    }

    const btn = document.getElementById('live-card-mute-btn');
    const icon = document.getElementById('live-card-mute-icon');
    const label = document.getElementById('live-card-mute-label');

    if (isMuted) {
      if (btn) {
        btn.classList.replace('bg-slate-800', 'bg-rose-900/80');
        btn.classList.replace('border-slate-700', 'border-rose-500');
      }
      if (icon) icon.textContent = '🔇';
      if (label) label.textContent = '已靜音';
      updateCardStatus('muted', '🔇 已靜音');
    } else {
      if (btn) {
        btn.classList.replace('bg-rose-900/80', 'bg-slate-800');
        btn.classList.replace('border-rose-500', 'border-slate-700');
      }
      if (icon) icon.textContent = '🎙️';
      if (label) label.textContent = '靜音';
      updateCardStatus('listening', '🎙️ 可以開始說話');
    }
  }

  async function toggleCamera() {
    isCameraOn = !isCameraOn;
    const box = document.getElementById('live-card-camera-box');
    const video = document.getElementById('live-card-video');
    const btn = document.getElementById('live-card-camera-btn');
    const label = document.getElementById('live-card-camera-label');

    if (isCameraOn) {
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: cameraFacingMode, width: { ideal: 1920 }, height: { ideal: 1080 } }
        });
        if (video) video.srcObject = cameraStream;
        if (box) box.classList.remove('hidden');
        if (btn) {
          btn.classList.replace('bg-slate-800', 'bg-indigo-600');
          btn.classList.replace('border-slate-700', 'border-indigo-400');
        }
        if (label) label.textContent = '關閉相機';

        // Auto-scroll down smoothly so the user sees the camera view immediately
        setTimeout(() => {
          const liveCard = document.getElementById('live-inline-card');
          if (liveCard) {
            liveCard.scrollIntoView({ behavior: 'smooth', block: 'end' });
          } else if (messagesContainer) {
            messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' });
          }
        }, 120);

        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');

        if (cameraInterval) clearInterval(cameraInterval);
        cameraInterval = setInterval(() => {
          if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN || !isCameraOn || !video) return;

          // 1. If Gemini is speaking, pause camera transmission to prioritize audio stream & avoid echo
          if (audioPlayer && audioPlayer.activeSources.length > 0) {
            updateCameraBadge(false, 'AI 說話中 (暫停傳圖)');
            return;
          }

          // 2. Smart VAD: only send when user is speaking or just spoke within 2.5s
          const isUserSpeaking = (Date.now() - lastUserSpokeTime) <= 2500;
          if (!isUserSpeaking) {
            updateCameraBadge(false, '待命中 (說話時自動發送)');
            return;
          }

          // 3. Smart Throttle: Send at most 1 frame every 2.0 seconds (2000ms)
          if (Date.now() - lastVideoFrameSentTime < 2000) return;

          if (video.videoWidth > 0) {
            lastVideoFrameSentTime = Date.now();
            tempCanvas.width = 480;
            tempCanvas.height = Math.round((video.videoHeight / video.videoWidth) * 480);
            tempCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);
            const jpegDataUrl = tempCanvas.toDataURL('image/jpeg', 0.6);
            const cleanBase64 = jpegDataUrl.replace(/^data:image\/\w+;base64,/, '');

            const videoMsg = {
              realtimeInput: {
                mediaChunks: [
                  {
                    mimeType: "image/jpeg",
                    data: cleanBase64
                  }
                ]
              }
            };
            ws.send(JSON.stringify(videoMsg));
            updateCameraBadge(true, '🟢 正在傳送畫面 (2s/幀)');
          }
        }, 500);

      } catch (err) {
        alert('無法開啟相機：' + err.message);
        isCameraOn = false;
      }
    } else {
      if (cameraInterval) {
        clearInterval(cameraInterval);
        cameraInterval = null;
      }
      if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
        cameraStream = null;
      }
      if (video) {
        video.srcObject = null;
        video.classList.remove('max-h-[70vh]', 'h-[50vh]');
        video.classList.add('max-h-52');
      }
      isCameraExpanded = false;
      const expandBtn = document.getElementById('live-card-expand-btn');
      if (expandBtn) expandBtn.innerHTML = '⛶ 放大';

      if (box) box.classList.add('hidden');
      if (btn) {
        btn.classList.replace('bg-indigo-600', 'bg-slate-800');
        btn.classList.replace('border-indigo-400', 'border-slate-700');
      }
      if (label) label.textContent = '相機';
    }
  }

  async function flipCamera() {
    cameraFacingMode = cameraFacingMode === 'environment' ? 'user' : 'environment';
    if (isCameraOn) {
      if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
      const video = document.getElementById('live-card-video');
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: cameraFacingMode, width: { ideal: 1920 }, height: { ideal: 1080 } }
        });
        if (video) video.srcObject = cameraStream;
      } catch (e) {
        console.warn('Flip Camera Failed', e);
      }
    }
  }

  // ==========================================
  // 🔌 WebSocket Live Session Manager (Singleton)
  // ==========================================
  function getApiKey() {
    return (localStorage.getItem(STORAGE_KEY) || '').trim();
  }

  function getSelectedVoice() {
    return localStorage.getItem(VOICE_KEY) || DEFAULT_VOICE;
  }

  function getSelectedModel() {
    let m = localStorage.getItem(MODEL_KEY) || DEFAULT_MODEL;
    if (!m.startsWith('models/')) m = 'models/' + m;
    return m;
  }

  async function startLiveSession() {
    // Prevent duplicate sessions
    if (isConnected || ws) {
      console.warn('[Live] Session already active, resetting...');
      await endLiveSession();
      await new Promise(r => setTimeout(r, 200));
    }

    const apiKey = getApiKey();
    if (!apiKey) {
      showKeyModal();
      return;
    }

    // 1. Create Inline Live Card in Chat Timeline
    createInlineCardElement();
    updateCardStatus('connecting', '⚡ 準備中...');

    // Update Header Live Button
    if (liveVoiceBtn) {
      liveVoiceBtn.classList.add('bg-rose-950/80', 'text-rose-300', 'border-rose-500/50');
      const span = liveVoiceBtn.querySelector('span:last-child');
      if (span) span.textContent = '通話中';
    }
    
    audioSendBuffer = [];
    isMuted = false;
    isCameraOn = false;
    liveCallStartTs = Date.now();

    try {
      // 2. Web Audio Context
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioCtxClass();
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      analyser = audioContext.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.8;

      audioPlayer = new LiveAudioPlayer(audioContext);

      // 3. Microphone Capture
      try {
        micMediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
      } catch (micErr) {
        updateCardStatus('error', '⚠️ 麥克風未開啟');
        appendCardTranscript('system', '請允許麥克風權限：' + micErr.message);
        return;
      }

      micAudioSource = audioContext.createMediaStreamSource(micMediaStream);
      micAudioSource.connect(analyser);

      silentGainNode = audioContext.createGain();
      silentGainNode.gain.value = 0;

      micProcessorNode = audioContext.createScriptProcessor(1024, 1, 1);
      micAudioSource.connect(micProcessorNode);
      micProcessorNode.connect(silentGainNode);
      silentGainNode.connect(audioContext.destination);

      // 4. Connect to Google Gemini Bidi WebSocket
      const model = getSelectedModel();
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(apiKey)}`;
      
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[Gemini Live] WebSocket opened with model:', model);
        isConnected = true;
        updateCardStatus('connecting', '⚡ 準備中...');

        const voiceName = getSelectedVoice();
        const setupMessage = {
          setup: {
            model: model,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: voiceName
                  }
                }
              }
            },
            systemInstruction: {
              parts: [
                {
                  text: (typeof getCrewLocale === 'function' && getCrewLocale() === 'en')
                    ? "You are Crew Pocket, an expert AI handheld companion assisting the user with travel, coding, and daily tasks. You are speaking directly with the user over high-fidelity real-time voice. Keep replies concise, warm, natural, proactive, and conversational. Speak English and always output the exact English transcript of everything you speak in the text parts."
                    : "You are Crew Pocket (口袋特勤隊), an expert AI handheld companion assisting the user with travel, coding, and daily tasks. You are speaking directly with the user over high-fidelity real-time voice. Keep your replies concise, warm, natural, and friendly in Traditional Chinese (Taiwan). Be proactive and conversational. Always output the exact Traditional Chinese text transcript of everything you speak in the text parts."
                }
              ]
            }
          }
        };
        ws.send(JSON.stringify(setupMessage));
        startVisualizer();
      };

      ws.onmessage = async (event) => {
        let response;
        try {
          if (event.data instanceof Blob) {
            response = JSON.parse(await event.data.text());
          } else {
            response = JSON.parse(event.data);
          }
        } catch (parseErr) {
          console.error('[Gemini Live JSON Parse Error]', parseErr);
          return;
        }

        // Setup Complete
        const isSetupDone = response.setupComplete || response.setup_complete;
        if (isSetupDone) {
          console.log('[Gemini Live] Setup complete, ready to talk!');
          updateCardStatus('listening', '🎙️ 可以開始說話');
          return;
        }

        // Server Content
        const sc = response.serverContent || response.server_content;
        if (sc) {
          if (sc.interrupted) {
            console.log('[Gemini Live] Interrupted by user!');
            audioPlayer.stopAll();
            updateCardStatus('listening', '🎙️ 聆聽中...');
            return;
          }

          const modelTurn = sc.modelTurn || sc.model_turn;
          if (modelTurn && modelTurn.parts) {
            updateCardStatus('speaking', '🔊 Gemini 說話中...');
            for (const part of modelTurn.parts) {
              const inlineData = part.inlineData || part.inline_data;
              if (inlineData && inlineData.data) {
                const float32 = base64ToFloat32PCM(inlineData.data);
                audioPlayer.playChunk(float32, 24000);
              }
              if (part.text) {
                currentTurnModel += part.text;
                appendCardTranscript('model', part.text);
              }
            }
          }

          const isTurnDone = sc.turnComplete || sc.turn_complete;
          if (isTurnDone) {
            if (currentTurnUser || currentTurnModel) {
              sessionDialogueTurns.push({
                user: currentTurnUser,
                model: currentTurnModel
              });
              currentTurnUser = '';
              currentTurnModel = '';
            }
          }
        }
      };

      ws.onerror = (err) => {
        console.error('[Gemini Live WebSocket Error]', err);
        updateCardStatus('error', '⚠️ 連線出錯');
      };

      ws.onclose = (e) => {
        console.log('[Gemini Live] Closed code:', e.code, 'reason:', e.reason);
        isConnected = false;
        stopSpeechRecognition();
        if (e.code !== 1000) {
          updateCardStatus('error', `⚠️ 連線中斷 (${e.code})`);
          let helpText = `連線中斷 (${e.code})`;
          if (e.code === 1008) {
            helpText += '：API Key 設有限制，請在 AI Studio 改為「無限制」';
          }
          appendCardTranscript('system', helpText);
        }
      };

      // 5. Mic PCM Stream (100ms buffering & Adaptive RMS Voice Activity Detection)
      micProcessorNode.onaudioprocess = (e) => {
        if (!isConnected || isMuted || !ws || ws.readyState !== WebSocket.OPEN) return;
        const inputData = e.inputBuffer.getChannelData(0);

        // Audio energy calculation to track active user speech
        let sumSquares = 0;
        for (let i = 0; i < inputData.length; i++) {
          sumSquares += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sumSquares / inputData.length);
        const isAiSpeaking = audioPlayer && audioPlayer.activeSources.length > 0;
        const vadThreshold = isAiSpeaking ? 0.045 : 0.015;

        if (rms > vadThreshold) {
          lastUserSpokeTime = Date.now();
        }

        const downsampled = downsampleBuffer(inputData, audioContext.sampleRate, 16000);

        for (let i = 0; i < downsampled.length; i++) {
          audioSendBuffer.push(downsampled[i]);
        }

        // Send every ~100ms (1600 samples at 16kHz)
        if (audioSendBuffer.length >= 1600) {
          const chunkToSend = new Float32Array(audioSendBuffer);
          audioSendBuffer = [];
          const pcmBuffer = floatTo16BitPCM(chunkToSend);
          const base64Audio = arrayBufferToBase64(pcmBuffer);

          const realTimeMessage = {
            realtimeInput: {
              mediaChunks: [
                {
                  mimeType: "audio/pcm;rate=16000",
                  data: base64Audio
                }
              ]
            }
          };
          ws.send(JSON.stringify(realTimeMessage));
        }
      };

    } catch (err) {
      console.error('[Live Session Error]', err);
      updateCardStatus('error', '⚠️ 啟動失敗');
      appendCardTranscript('system', '錯誤：' + err.message);
    }
  }

  // ==========================================
  // 📝 Post-Call Markdown Summary Memo Card
  // ==========================================
  function buildCallSummaryCardHtml(turns, durationSec, voiceName) {
    const mins = Math.floor(durationSec / 60);
    const secs = durationSec % 60;
    const durationText = mins > 0 ? `${mins} 分 ${secs} 秒` : `${secs} 秒`;
    const timeStr = new Date().toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' });

    const card = document.createElement('div');
    card.className = 'flex w-full max-w-2xl mx-auto min-w-0 justify-start my-3 animate-fadeIn select-text';

    let dialogHtml = '';
    turns.forEach(t => {
      if (t.user) {
        dialogHtml += `<div class="p-2.5 rounded-xl bg-indigo-950/40 border border-indigo-500/20 text-indigo-200 text-xs mb-1.5"><span class="font-bold text-indigo-300">🗣️ 您：</span>${escapeHtml(t.user)}</div>`;
      }
      if (t.model) {
        const formattedModel = typeof formatMessageContent === 'function' ? formatMessageContent(t.model) : escapeHtml(t.model);
        dialogHtml += `<div class="p-2.5 rounded-xl bg-slate-900/90 border border-teal-500/30 text-slate-200 text-xs mb-1.5"><span class="font-bold text-teal-300">✨ Gemini：</span><div class="mt-0.5">${formattedModel}</div></div>`;
      }
    });

    card.innerHTML = `
      <div class="bg-gradient-to-b from-slate-900 via-slate-900 to-teal-950/30 border border-teal-500/50 text-slate-200 rounded-2xl p-3.5 sm:p-4 text-xs sm:text-sm shadow-xl w-full">
        <div class="flex items-center justify-between border-b border-teal-800/60 pb-2 mb-2.5">
          <div class="flex items-center gap-1.5">
            <span class="px-2.5 py-0.5 rounded-full bg-teal-500/20 text-teal-300 border border-teal-500/40 text-[10px] font-mono font-bold flex items-center gap-1">
              <span>🎙️</span>
              <span>語音通話備忘卡</span>
            </span>
            <span class="text-[10px] text-teal-400 font-mono">⏱️ ${durationText}</span>
          </div>
          <span class="text-[10px] text-slate-400 font-mono">${timeStr}</span>
        </div>

        <div class="space-y-1 max-h-72 overflow-y-auto pr-1">
          ${dialogHtml || '<div class="text-slate-400 text-xs italic">通話結束（未記錄到發言）</div>'}
        </div>

        <div class="mt-2.5 pt-2 border-t border-slate-800/80 text-[10px] text-slate-400 font-mono flex items-center justify-between">
          <span>💡 內容已自動記錄至歷史對話</span>
          <span class="text-teal-400">✨ Gemini 2.0 Live (${escapeHtml(voiceName)})</span>
        </div>
      </div>
    `;

    return card;
  }

  async function endLiveSession() {
    isConnected = false;
    stopVisualizer();
    stopSpeechRecognition();

    if (cameraInterval) {
      clearInterval(cameraInterval);
      cameraInterval = null;
    }
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      cameraStream = null;
    }
    isCameraOn = false;

    if (audioPlayer) {
      audioPlayer.stopAll();
      audioPlayer = null;
    }

    if (micProcessorNode) {
      try { micProcessorNode.disconnect(); } catch (e) {}
      micProcessorNode = null;
    }
    if (silentGainNode) {
      try { silentGainNode.disconnect(); } catch (e) {}
      silentGainNode = null;
    }
    if (micAudioSource) {
      try { micAudioSource.disconnect(); } catch (e) {}
      micAudioSource = null;
    }
    if (micMediaStream) {
      micMediaStream.getTracks().forEach(t => t.stop());
      micMediaStream = null;
    }
    if (audioContext) {
      try { audioContext.close(); } catch (e) {}
      audioContext = null;
    }
    if (ws) {
      try { ws.close(); } catch (e) {}
      ws = null;
    }

    // Reset Header Live Button
    if (liveVoiceBtn) {
      liveVoiceBtn.classList.remove('bg-rose-950/80', 'text-rose-300', 'border-rose-500/50');
      const span = liveVoiceBtn.querySelector('span:last-child');
      if (span) span.textContent = 'Live 通話';
    }

    // Remove active inline card cleanly
    removeInlineCard();

    // Collect any remaining turn
    if (currentTurnUser || currentTurnModel) {
      sessionDialogueTurns.push({
        user: currentTurnUser,
        model: currentTurnModel
      });
      currentTurnUser = '';
      currentTurnModel = '';
    }

    // 🔒 Silent Background Sync & Visual Summary Memo Card
    const turnsToSync = sessionDialogueTurns.slice();
    sessionDialogueTurns = [];

    if (turnsToSync.length > 0) {
      const activeConvId = (typeof currentConversationId !== 'undefined' && currentConversationId) ? currentConversationId : null;
      const combinedUser = turnsToSync.map(t => t.user).filter(Boolean).join('\n');
      const combinedModel = turnsToSync.map(t => t.model).filter(Boolean).join('\n\n');

      if (combinedUser || combinedModel) {
        // Render beautiful Summary Memo Card to chat timeline
        const durationSec = liveCallStartTs > 0 ? Math.max(1, Math.round((Date.now() - liveCallStartTs) / 1000)) : 0;
        const voiceName = getSelectedVoice();
        const memoCard = buildCallSummaryCardHtml(turnsToSync, durationSec, voiceName);
        if (messagesContainer) {
          messagesContainer.appendChild(memoCard);
          if (typeof enhanceCodeBlocks === 'function') enhanceCodeBlocks(memoCard);
          if (typeof scrollToBottom === 'function') scrollToBottom(true);
        }

        console.log('[Live Silent Sync] Writing turns to brain log in background...', { user: combinedUser, model: combinedModel });
        fetch('/api/live-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversation_id: activeConvId,
            user_message: combinedUser,
            assistant_message: combinedModel
          })
        }).then(res => res.json()).then(data => {
          if (data.success && data.conversation_id && (typeof currentConversationId !== 'undefined' && !currentConversationId)) {
            currentConversationId = data.conversation_id;
            localStorage.setItem('agy_active_conv_id', data.conversation_id);
          }
        }).catch(err => {
          console.warn('[Live Silent Sync Warning]', err);
        });
      }
    }
  }

  // Key Modal Handlers
  function showKeyModal() {
    if (liveApiKeyInput) liveApiKeyInput.value = getApiKey();
    if (liveModelSelect) liveModelSelect.value = getSelectedModel();
    if (liveVoiceSelect) liveVoiceSelect.value = getSelectedVoice();
    liveKeyModal.classList.remove('hidden');
  }

  function hideKeyModal() {
    liveKeyModal.classList.add('hidden');
  }

  // Event Listeners
  if (liveVoiceBtn) {
    liveVoiceBtn.addEventListener('click', () => {
      if (isConnected) {
        endLiveSession();
      } else {
        const key = getApiKey();
        if (!key) {
          showKeyModal();
        } else {
          startLiveSession();
        }
      }
    });
  }

  if (liveCloseKeyBtn) {
    liveCloseKeyBtn.addEventListener('click', hideKeyModal);
  }

  if (liveSaveKeyBtn) {
    liveSaveKeyBtn.addEventListener('click', () => {
      const key = liveApiKeyInput ? liveApiKeyInput.value.trim() : '';
      const model = liveModelSelect ? liveModelSelect.value : DEFAULT_MODEL;
      const voice = liveVoiceSelect ? liveVoiceSelect.value : DEFAULT_VOICE;
      if (key) {
        localStorage.setItem(STORAGE_KEY, key);
        localStorage.setItem(MODEL_KEY, model);
        localStorage.setItem(VOICE_KEY, voice);
        hideKeyModal();
        startLiveSession();
      } else {
        localStorage.removeItem(STORAGE_KEY);
        hideKeyModal();
      }
    });
  }

  if (liveVoiceSelect) {
    liveVoiceSelect.value = getSelectedVoice();
    liveVoiceSelect.addEventListener('change', () => {
      localStorage.setItem(VOICE_KEY, liveVoiceSelect.value);
    });
  }

  if (liveModelSelect) {
    liveModelSelect.value = getSelectedModel();
    liveModelSelect.addEventListener('change', () => {
      localStorage.setItem(MODEL_KEY, liveModelSelect.value);
    });
  }

})();
