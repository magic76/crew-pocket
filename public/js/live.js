/**
 * 🎙️ Crew Pocket - Option A: Inline Live Multimodal Assistant
 * Embedded Directly Inside the Chat Timeline with Mute, Camera Vision & Real-time Transcription.
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
  let isSyncing = false;
  
  // Real-time STT & Audio Accumulation
  let speechRecognizer = null;
  let turnUserPcmChunks = [];
  let turnModelPcmChunks = [];
  let currentTurnModelText = '';
  let currentTurnUserText = '';

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
  // 🔊 Gapless 24kHz PCM Audio Stream Player
  // ==========================================
  class LiveAudioPlayer {
    constructor(ctx) {
      this.ctx = ctx;
      this.nextStartTime = 0;
      this.activeSources = [];
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
      const startTime = Math.max(currentTime, this.nextStartTime);
      source.start(startTime);
      this.nextStartTime = startTime + audioBuffer.duration;

      this.activeSources.push(source);
      source.onended = () => {
        const idx = this.activeSources.indexOf(source);
        if (idx > -1) this.activeSources.splice(idx, 1);
        if (this.activeSources.length === 0 && isConnected && !isMuted) {
          updateCardStatus('listening', '🎙️ 聆聽中 (隨時說話)');
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
  // 🧮 Audio Data & WAV Conversion Utilities
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

  function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  function pcmFloat32ArrayToWavBase64(float32Chunks, sampleRate) {
    let totalLength = 0;
    for (const chunk of float32Chunks) totalLength += chunk.length;
    if (totalLength === 0) return '';

    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of float32Chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = totalLength * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    let pcmOffset = 44;
    for (let i = 0; i < totalLength; i++, pcmOffset += 2) {
      let s = Math.max(-1, Math.min(1, merged[i]));
      view.setInt16(pcmOffset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }

    return arrayBufferToBase64(buffer);
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

    const card = document.createElement('div');
    card.id = 'live-inline-card';
    card.className = 'flex gap-2.5 w-full max-w-2xl mx-auto justify-start transition-all duration-300 animate-fadeIn';
    
    card.innerHTML = `
      <div class="w-7 h-7 rounded-full bg-teal-500/20 border border-teal-500/50 text-teal-300 flex items-center justify-center shrink-0 text-xs font-bold mt-0.5 shadow-sm shadow-teal-500/30">
        🎙️
      </div>

      <div class="bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 border border-teal-500/50 rounded-2xl rounded-tl-none p-3.5 text-xs sm:text-sm shadow-2xl shadow-teal-950/50 flex-1 max-w-[92%] space-y-3 relative overflow-hidden">
        
        <!-- CARD TOP TOOLBAR: Status + Mute + Camera + Hangup -->
        <div class="flex items-center justify-between border-b border-slate-800 pb-2.5 gap-2">
          
          <!-- Status Pill -->
          <div class="flex items-center gap-1.5 min-w-0">
            <span id="live-card-status-dot" class="w-2 h-2 rounded-full bg-teal-400 animate-pulse shrink-0"></span>
            <span id="live-card-status-text" class="text-teal-300 font-bold text-xs font-mono truncate">⚡ 連線中...</span>
          </div>

          <!-- Controls Group -->
          <div class="flex items-center gap-1.5 shrink-0">
            
            <!-- 🔇 Mute Button -->
            <button id="live-card-mute-btn" type="button" class="px-2.5 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 border border-slate-700 text-slate-200 text-[11px] font-semibold flex items-center gap-1 transition shadow-sm" title="靜音 / 開啟麥克風">
              <span id="live-card-mute-icon">🎙️</span>
              <span id="live-card-mute-label">靜音</span>
            </button>

            <!-- 📷 Camera Toggle Button -->
            <button id="live-card-camera-btn" type="button" class="px-2.5 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 border border-slate-700 text-slate-200 text-[11px] font-semibold flex items-center gap-1 transition shadow-sm" title="開啟相機 (視覺辨識)">
              <span>📷</span>
              <span id="live-card-camera-label">相機</span>
            </button>

            <!-- 🛑 Hangup Button -->
            <button id="live-card-hangup-btn" type="button" class="px-2.5 py-1 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-95 text-white text-[11px] font-bold shadow-md shadow-rose-600/30 transition">
              掛斷
            </button>

          </div>
        </div>

        <!-- 📷 CAMERA EXPANSION VIEW (相機展開區) -->
        <div id="live-card-camera-box" class="hidden transition-all duration-300 overflow-hidden rounded-xl border border-indigo-500/40 bg-slate-950 relative">
          <video id="live-card-video" autoplay playsinline muted class="w-full max-h-52 object-contain bg-black rounded-lg"></video>
          <div class="absolute bottom-2 right-2 flex gap-1.5 z-10">
            <button id="live-card-flip-btn" type="button" class="px-2.5 py-1 rounded-lg bg-black/80 hover:bg-black text-[10px] text-teal-300 border border-teal-500/40 font-mono flex items-center gap-1 shadow-md active:scale-95 transition">
              🔄 前後切換
            </button>
          </div>
        </div>

        <!-- Live Wave Spectrum Canvas -->
        <div class="h-8 w-full flex items-center justify-center bg-black/50 rounded-xl px-2">
          <canvas id="live-card-canvas" width="280" height="32" class="w-full h-full"></canvas>
        </div>

        <!-- Real-time Dialogue Subtitles -->
        <div id="live-card-transcript" class="space-y-1.5 text-xs max-h-36 overflow-y-auto pr-1">
          <div class="text-slate-400 text-center text-[11px] font-mono py-1">💬 語音通道建立中...</div>
        </div>

      </div>
    `;

    if (messagesContainer) {
      messagesContainer.appendChild(card);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // Attach Inline Controls
    const muteBtn = card.querySelector('#live-card-mute-btn');
    if (muteBtn) muteBtn.addEventListener('click', toggleMute);

    const cameraBtn = card.querySelector('#live-card-camera-btn');
    if (cameraBtn) cameraBtn.addEventListener('click', toggleCamera);

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
      } else {
        statusDot.className = 'w-2 h-2 rounded-full bg-teal-400 animate-pulse';
        if (statusText) statusText.className = 'text-teal-300 font-bold text-xs font-mono truncate';
      }
    }
  }

  function appendCardTranscript(role, text) {
    const drawer = document.getElementById('live-card-transcript');
    if (!drawer || !text) return;

    // Clear initial placeholder if present
    if (drawer.children.length === 1 && drawer.children[0].classList.contains('text-slate-400')) {
      drawer.innerHTML = '';
    }

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
  // 🎙️ Browser-Native Realtime STT (Web Speech API)
  // ==========================================
  function startSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    try {
      if (speechRecognizer) {
        try { speechRecognizer.stop(); } catch (e) {}
      }
      speechRecognizer = new SpeechRecognition();
      speechRecognizer.continuous = true;
      speechRecognizer.interimResults = true;
      speechRecognizer.lang = 'zh-TW';

      speechRecognizer.onresult = (event) => {
        let interim = '';
        let final = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            final += event.results[i][0].transcript;
          } else {
            interim += event.results[i][0].transcript;
          }
        }
        const spoken = (final || interim).trim();
        if (spoken) {
          currentTurnUserText = spoken;
          console.log('[Live STT Transcribed]', spoken);
          appendCardTranscript('user', spoken);
        }
      };

      speechRecognizer.onerror = (err) => {
        console.warn('[Live STT Warning]', err.error);
      };

      speechRecognizer.onend = () => {
        if (isConnected && speechRecognizer) {
          try { speechRecognizer.start(); } catch (e) {}
        }
      };

      speechRecognizer.start();
    } catch (e) {
      console.warn('[Live STT Init Error]', e);
    }
  }

  function stopSpeechRecognition() {
    if (speechRecognizer) {
      try { speechRecognizer.stop(); } catch (e) {}
      speechRecognizer = null;
    }
  }

  // ==========================================
  // 🔇 Mute & 📷 Camera Vision Controls
  // ==========================================
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
      updateCardStatus('muted', '🔇 麥克風已靜音');
    } else {
      if (btn) {
        btn.classList.replace('bg-rose-900/80', 'bg-slate-800');
        btn.classList.replace('border-rose-500', 'border-slate-700');
      }
      if (icon) icon.textContent = '🎙️';
      if (label) label.textContent = '靜音';
      updateCardStatus('listening', '🎙️ 聆聽中 (雙向)');
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
          video: { facingMode: cameraFacingMode, width: { ideal: 640 }, height: { ideal: 480 } }
        });
        if (video) video.srcObject = cameraStream;
        if (box) box.classList.remove('hidden');
        if (btn) {
          btn.classList.replace('bg-slate-800', 'bg-indigo-600');
          btn.classList.replace('border-slate-700', 'border-indigo-400');
        }
        if (label) label.textContent = '關閉相機';

        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');

        if (cameraInterval) clearInterval(cameraInterval);
        cameraInterval = setInterval(() => {
          if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN || !isCameraOn || !video) return;
          if (video.videoWidth > 0) {
            tempCanvas.width = 480;
            tempCanvas.height = Math.round((video.videoHeight / video.videoWidth) * 480);
            tempCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);
            const jpegDataUrl = tempCanvas.toDataURL('image/jpeg', 0.6);
            const cleanBase64 = jpegDataUrl.replace(/^data:image\/\w+;base64,/, '');

            const videoMsg = {
              realtimeInput: {
                video: {
                  mimeType: "image/jpeg",
                  data: cleanBase64
                }
              }
            };
            ws.send(JSON.stringify(videoMsg));
          }
        }, 1000);

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
      if (video) video.srcObject = null;
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
          video: { facingMode: cameraFacingMode, width: { ideal: 640 }, height: { ideal: 480 } }
        });
        if (video) video.srcObject = cameraStream;
      } catch (e) {
        console.warn('Flip Camera Failed', e);
      }
    }
  }

  // ==========================================
  // 🔌 WebSocket Live Session Manager
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

  // ⚡ Transcribe and Sync Full Dialogue into Active Session
  async function processTurnAndSync() {
    if (isSyncing) return;
    const userChunks = turnUserPcmChunks.slice();
    const modelChunks = turnModelPcmChunks.slice();
    
    // Clear buffer for next turn
    turnUserPcmChunks = [];
    turnModelPcmChunks = [];

    const apiKey = getApiKey();
    const userWav = pcmFloat32ArrayToWavBase64(userChunks, 16000);
    const modelWav = pcmFloat32ArrayToWavBase64(modelChunks, 24000);

    if (!userWav && !modelWav && !currentTurnUserText && !currentTurnModelText) return;

    isSyncing = true;
    let finalUser = currentTurnUserText;
    let finalModel = currentTurnModelText;

    try {
      // 1. If text is missing, transcribe audio clips via Gemini Flash
      if ((!finalUser && userWav) || (!finalModel && modelWav)) {
        const transRes = await fetch('/api/live-transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: apiKey,
            user_audio: (!finalUser && userWav) ? userWav : null,
            model_audio: (!finalModel && modelWav) ? modelWav : null
          })
        });

        const transData = await transRes.json();
        console.log('[Live Transcribe Result]', transData);
        if (transData.success) {
          if (transData.user_text && !finalUser) finalUser = transData.user_text;
          if (transData.model_text && !finalModel) finalModel = transData.model_text;
        }
      }

      finalUser = finalUser || (userWav ? '🗣️ (語音輸入)' : '');
      finalModel = finalModel || (modelWav ? '🎙️ (已完成語音回覆)' : '');

      if (!finalUser && !finalModel) return;

      // 2. Show in card transcript drawer
      if (finalUser && finalUser !== '🗣️ (語音輸入)') appendCardTranscript('user', finalUser);
      if (finalModel && finalModel !== '🎙️ (已完成語音回覆)') appendCardTranscript('model', finalModel);

      // 3. Save to backend session logs
      const activeConvId = (typeof currentConversationId !== 'undefined' && currentConversationId) ? currentConversationId : null;
      const syncRes = await fetch('/api/live-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: activeConvId,
          user_message: finalUser,
          assistant_message: finalModel
        })
      });

      const syncData = await syncRes.json();
      
      // 4. Update session reference
      if (syncData.success && syncData.conversation_id) {
        currentConversationId = syncData.conversation_id;
        localStorage.setItem('agy_active_conv_id', syncData.conversation_id);
        if (typeof loadConversations === 'function') loadConversations();
      }

      // 5. Reset turn texts
      currentTurnUserText = '';
      currentTurnModelText = '';

    } catch (err) {
      console.error('[Process Turn Sync Error]', err);
    } finally {
      isSyncing = false;
    }
  }

  async function startLiveSession() {
    const apiKey = getApiKey();
    if (!apiKey) {
      showKeyModal();
      return;
    }

    // 1. Create Inline Live Card in Chat Timeline
    createInlineCardElement();
    updateCardStatus('connecting', '⚡ 連線 Google Gemini Live...');
    
    audioSendBuffer = [];
    turnUserPcmChunks = [];
    turnModelPcmChunks = [];
    currentTurnModelText = '';
    currentTurnUserText = '';
    isMuted = false;
    isCameraOn = false;

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
        updateCardStatus('error', '⚠️ 麥克風存取失敗');
        appendCardTranscript('system', '請允許麥克風權限以進行通話：' + micErr.message);
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
      
      if (ws) {
        try { ws.close(); } catch (e) {}
      }

      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[Gemini Live] WebSocket opened with model:', model);
        isConnected = true;
        updateCardStatus('connected', '✨ 初始化語音通道...');

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
                  text: "You are Crew Pocket (口袋特勤隊), an expert AI handheld companion assisting the user with travel, coding, and daily tasks. You are speaking directly with the user over high-fidelity real-time voice. Keep your replies concise, warm, natural, and friendly in Traditional Chinese (Taiwan). Be proactive and conversational. Always output the exact Traditional Chinese text transcript of everything you speak in the text parts."
                }
              ]
            }
          }
        };
        ws.send(JSON.stringify(setupMessage));
        startVisualizer();
        startSpeechRecognition();
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
          updateCardStatus('listening', '🎙️ 聆聽中 (雙向全雙工)');
          appendCardTranscript('system', `✅ ${model.replace('models/', '')} 已就緒，請隨時說話...`);
          return;
        }

        // Server Content
        const sc = response.serverContent || response.server_content;
        if (sc) {
          if (sc.interrupted) {
            console.log('[Gemini Live] Interrupted by user!');
            audioPlayer.stopAll();
            updateCardStatus('listening', '🎙️ 正在聆聽...');
            processTurnAndSync();
            return;
          }

          const modelTurn = sc.modelTurn || sc.model_turn;
          if (modelTurn && modelTurn.parts) {
            updateCardStatus('speaking', '🔊 Gemini 正在說話...');
            for (const part of modelTurn.parts) {
              const inlineData = part.inlineData || part.inline_data;
              if (inlineData && inlineData.data) {
                const float32 = base64ToFloat32PCM(inlineData.data);
                turnModelPcmChunks.push(float32);
                audioPlayer.playChunk(float32, 24000);
              }
              if (part.text) {
                currentTurnModelText += part.text;
                appendCardTranscript('model', part.text);
              }
            }
          }

          const isTurnDone = sc.turnComplete || sc.turn_complete;
          if (isTurnDone) {
            processTurnAndSync();
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
          let helpText = `連線已中斷 (代碼: ${e.code})。`;
          if (e.code === 1008) {
            helpText += '\n• 原因 1008 通常是「API Key 設有限制」，請在 Google AI Studio 將 API Key 改為「無限制 (None)」。';
          }
          if (e.reason) helpText += `\n• Google 回傳訊息: ${e.reason}`;
          appendCardTranscript('system', helpText);
        }
      };

      // 5. Mic PCM Stream (100ms buffering)
      micProcessorNode.onaudioprocess = (e) => {
        if (!isConnected || isMuted || !ws || ws.readyState !== WebSocket.OPEN) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const downsampled = downsampleBuffer(inputData, audioContext.sampleRate, 16000);
        
        turnUserPcmChunks.push(new Float32Array(downsampled));

        for (let i = 0; i < downsampled.length; i++) {
          audioSendBuffer.push(downsampled[i]);
        }

        // Send every ~100ms
        if (audioSendBuffer.length >= 1600) {
          const chunkToSend = new Float32Array(audioSendBuffer);
          audioSendBuffer = [];
          const pcmBuffer = floatTo16BitPCM(chunkToSend);
          const base64Audio = arrayBufferToBase64(pcmBuffer);

          const realTimeMessage = {
            realtimeInput: {
              audio: {
                mimeType: "audio/pcm;rate=16000",
                data: base64Audio
              }
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

    // Process last turn and replace card with permanent chat timeline
    await processTurnAndSync();
    
    // Remove active inline card
    removeInlineCard();

    // Reload permanent history
    const activeConvId = (typeof currentConversationId !== 'undefined' && currentConversationId) ? currentConversationId : null;
    if (activeConvId && typeof loadConversationHistory === 'function') {
      await loadConversationHistory(activeConvId);
    }

    if (typeof loadConversations === 'function') {
      loadConversations();
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
