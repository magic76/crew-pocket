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
  let isAiResponding = false;
  let hasSentFrameForCurrentTurn = false;
  let lastAiSpokeTime = 0;
  let sustainedSpeechCount = 0;
  let sessionSnapshots = [];
  let fullSessionAudioChunks = [];

  function recordAudioSegment(role, float32Data, inputSampleRate = 16000) {
    if (!float32Data || float32Data.length === 0) return;
    let resampled16k = float32Data;
    if (inputSampleRate !== 16000) {
      resampled16k = downsampleBuffer(float32Data, inputSampleRate, 16000);
    }
    if (fullSessionAudioChunks.length < 1800000) {
      for (let i = 0; i < resampled16k.length; i++) {
        fullSessionAudioChunks.push(resampled16k[i]);
      }
    }
  }

  function encodeWAV(samples, sampleRate = 16000) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    function writeString(offset, string) {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    }

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, samples.length * 2, true);

    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  async function generatePostCallSmartTranscript(audioBlob, apiKey, sampleCount = 0, durationSec = 0) {
    if (!audioBlob || audioBlob.size < 1000 || !apiKey) {
      return { success: false, error: '音訊過短 (錄音長度不足) 或未設定 API Key' };
    }

    const base64Audio = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(audioBlob);
    });

    try {
      const res = await fetch('/api/live-transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          audio_base64: base64Audio,
          mime_type: 'audio/wav',
          sample_count: sampleCount,
          duration_sec: durationSec
        })
      });
      const data = await res.json();
      return data;
    } catch (err) {
      return { success: false, error: '連線伺服器異常：' + err.message };
    }
  }

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
  // 🔊 Gapless 24kHz PCM Audio Stream Player (Single Pristine Audio Track)
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
      recordAudioSegment('model', float32Array, sampleRate);
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }

      const audioBuffer = this.ctx.createBuffer(1, float32Array.length, sampleRate);
      audioBuffer.getChannelData(0).set(float32Array);

      const source = this.ctx.createBufferSource();
      source.buffer = audioBuffer;

      // 🔊 Single pristine direct hardware connection (no duplicate media bridge)
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
        lastAiSpokeTime = Date.now();
        if (this.activeSources.length === 0 && isConnected) {
          // 350ms room echo clearance buffer before re-opening mic
          setTimeout(() => {
            if (this.activeSources.length === 0 && isConnected) {
              isAiResponding = false;
              hasSentFrameForCurrentTurn = false;
              updateDockControls();
              updateCameraBadge(false, '待命中 (說話時自動發送)');
              if (isMuted) {
                updateCardStatus('muted', '🔇 麥克風已靜音');
              } else {
                updateCardStatus('listening', '🎙️ 可以開始說話');
              }
            }
          }, 350);
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

  let screenWakeLock = null;

  function setMediaSessionActive(active) {
    if (active) {
      // 1. MediaSession Lock
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: 'Gemini Live 隨身語音特勤',
            artist: 'Crew Pocket 口袋特勤隊',
            album: '即時雙向語音通話'
          });
          navigator.mediaSession.playbackState = 'playing';

          navigator.mediaSession.setActionHandler('pause', () => {
            endLiveSession();
          });
          navigator.mediaSession.setActionHandler('stop', () => {
            endLiveSession();
          });
        } catch (e) {}
      }

      // 2. Screen WakeLock (prevent deep sleep during call)
      if ('wakeLock' in navigator) {
        navigator.wakeLock.request('screen').then(wl => {
          screenWakeLock = wl;
        }).catch(() => {});
      }
    } else {
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.playbackState = 'none';
        } catch (e) {}
      }
      if (screenWakeLock) {
        try { screenWakeLock.release(); } catch (e) {}
        screenWakeLock = null;
      }
    }
  }

  // ==========================================
  // 🧬 Local Voiceprint Speaker Verification Engine (Option B)
  // ==========================================
  const VOICEPRINT_KEY = 'crew_voiceprint_vector';
  let userVoiceprintProfile = null;
  let isCalibratingVoiceprint = false;
  let voiceprintCalibrationFrames = [];

  function loadUserVoiceprint() {
    try {
      const raw = localStorage.getItem(VOICEPRINT_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length === 16) {
          userVoiceprintProfile = new Float32Array(arr);
        }
      }
    } catch (e) {}
  }
  loadUserVoiceprint();

  function saveUserVoiceprint(profile) {
    userVoiceprintProfile = profile;
    localStorage.setItem(VOICEPRINT_KEY, JSON.stringify(Array.from(profile)));
  }

  function clearUserVoiceprint() {
    userVoiceprintProfile = null;
    localStorage.removeItem(VOICEPRINT_KEY);
  }

  // 🧬 16-Band Mel-like Spectral Profile Extractor (Fast Local Audio Analysis)
  function extractSpectralProfile(float32Data, sampleRate = 16000) {
    const N = float32Data.length;
    const numBands = 16;
    const bandEnergies = new Float32Array(numBands);
    const minFreq = 100;
    const maxFreq = 6500;

    for (let b = 0; b < numBands; b++) {
      const fStart = minFreq * Math.pow(maxFreq / minFreq, b / numBands);
      const fEnd = minFreq * Math.pow(maxFreq / minFreq, (b + 1) / numBands);
      const kStart = Math.max(1, Math.floor(fStart * N / sampleRate));
      const kEnd = Math.min(Math.floor(N / 2), Math.ceil(fEnd * N / sampleRate));

      let energy = 0;
      const step = Math.max(1, Math.floor(N / 64));
      for (let k = kStart; k <= kEnd; k++) {
        let real = 0, imag = 0;
        for (let n = 0; n < N; n += step) {
          const angle = 2 * Math.PI * k * n / N;
          const w = float32Data[n] * (0.54 - 0.46 * Math.cos(2 * Math.PI * n / (N - 1)));
          real += w * Math.cos(angle);
          imag -= w * Math.sin(angle);
        }
        energy += (real * real + imag * imag);
      }
      bandEnergies[b] = Math.log(1 + energy);
    }

    let norm = 0;
    for (let b = 0; b < numBands; b++) norm += bandEnergies[b] * bandEnergies[b];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let b = 0; b < numBands; b++) bandEnergies[b] /= norm;
    }
    return bandEnergies;
  }

  function computeVoiceprintSimilarity(v1, v2) {
    if (!v1 || !v2 || v1.length !== v2.length) return 0;
    let dot = 0;
    for (let i = 0; i < v1.length; i++) {
      dot += v1[i] * v2[i];
    }
    return dot;
  }

  // ==========================================
  // 🧮 Audio Data Conversion Utilities
  // ==========================================
  function floatTo16BitPCM(float32Array, gainBoost = 1.4) {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    let offset = 0;
    for (let i = 0; i < float32Array.length; i++, offset += 2) {
      let sample = float32Array[i] * gainBoost;
      let s = Math.max(-1, Math.min(1, sample));
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
        
        <!-- CARD TOP TOOLBAR: 狀態指示 (靠左) + 聲紋/音色膠囊 (靠右) -->
        <div class="border-b border-slate-800/80 pb-2 flex items-center justify-between gap-1.5 min-w-0">
          <div class="flex items-center gap-1.5 min-w-0">
            <span id="live-card-status-dot" class="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0"></span>
            <span id="live-card-status-text" class="text-amber-300 font-bold text-xs font-mono truncate">⚡ 準備中...</span>
          </div>
          
          <div class="flex items-center gap-1.5 shrink-0">
            <!-- 🧬 Voiceprint Status & Calibration Button -->
            <button id="live-card-voiceprint-btn" type="button" class="px-2 py-0.5 rounded-full bg-slate-800/90 hover:bg-slate-700 active:scale-95 border ${userVoiceprintProfile ? 'border-teal-500/50 text-teal-300' : 'border-slate-700 text-slate-400'} text-[10px] font-medium flex items-center gap-1 transition shadow-sm" title="點擊校準個人聲紋 (AI 專屬認你的聲音插話打斷，免疫旁人干擾)">
              <span id="live-voiceprint-dot" class="w-1.5 h-1.5 rounded-full ${userVoiceprintProfile ? 'bg-teal-400' : 'bg-slate-500'}"></span>
              <span id="live-voiceprint-text">${userVoiceprintProfile ? '🧬 聲紋已鎖' : '🧬 校準聲紋'}</span>
            </button>

            <!-- 🗣️ Voice Selector Pill (音色切換膠囊 · 靠右放置) -->
            <div class="relative inline-flex items-center shrink-0">
              <select id="live-card-voice-select" class="appearance-none bg-teal-950/80 hover:bg-teal-900 active:scale-95 border border-teal-500/50 text-teal-300 text-[11px] font-semibold rounded-full pl-2 pr-4 py-0.5 outline-none transition cursor-pointer shadow-sm" title="點擊切換音色">
                <option value="Puck" ${selectedVoice === 'Puck' ? 'selected' : ''}>🗣️ Puck</option>
                <option value="Charon" ${selectedVoice === 'Charon' ? 'selected' : ''}>🗣️ Charon</option>
                <option value="Kore" ${selectedVoice === 'Kore' ? 'selected' : ''}>🗣️ Kore</option>
                <option value="Fenrir" ${selectedVoice === 'Fenrir' ? 'selected' : ''}>🗣️ Fenrir</option>
                <option value="Aoede" ${selectedVoice === 'Aoede' ? 'selected' : ''}>🗣️ Aoede</option>
              </select>
              <span class="pointer-events-none absolute right-1 text-[8px] text-teal-400 font-mono">▾</span>
            </div>
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
    const voiceprintBtn = card.querySelector('#live-card-voiceprint-btn');
    if (voiceprintBtn) {
      voiceprintBtn.addEventListener('click', () => {
        if (isCalibratingVoiceprint) return;
        if (userVoiceprintProfile) {
          const confirmed = confirm('🧬 目前已啟用你的專屬聲紋！\n\n點擊「確定」重新錄音校準，點擊「取消」保留現有聲紋。');
          if (!confirmed) return;
        }
        isCalibratingVoiceprint = true;
        voiceprintCalibrationFrames = [];
        const vpText = document.getElementById('live-voiceprint-text');
        const vpDot = document.getElementById('live-voiceprint-dot');
        if (vpText) vpText.textContent = '🎙️ 採樣中...';
        if (vpDot) vpDot.className = 'w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping';
        appendCardTranscript('system', '🧬 正在校準專屬聲紋：請對著麥克風念出「特勤隊，我是主講人」，採樣 2 秒中...');
        if (navigator.vibrate) navigator.vibrate(30);
      });
    }

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

    const snapBtn = card.querySelector('#live-card-snap-btn');
    if (snapBtn) snapBtn.addEventListener('click', snapPhoto);

    const expandBtn = card.querySelector('#live-card-expand-btn');
    if (expandBtn) expandBtn.addEventListener('click', toggleCameraExpand);

    const flipBtn = card.querySelector('#live-card-flip-btn');
    if (flipBtn) flipBtn.addEventListener('click', flipCamera);

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

      const isAiSpeaking = audioPlayer && audioPlayer.activeSources.length > 0;

      if (isMuted && !isAiSpeaking) {
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
  // 🎙️ Real-time Speech Tracker (Native Gemini Audio - No System Chimes)
  // ==========================================
  function startSpeechRecognition() {
    // 🛡️ Disabled webkitSpeechRecognition to prevent Android OS audio focus conflicts,
    // double-recording status bar icons, and annoying system "ding ding ding" prompt sounds.
    // Gemini Live natively understands speech from the 16kHz PCM stream!
    speechRecognizer = null;
  }

  function stopSpeechRecognition() {
    speechRecognizer = null;
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
            video: {
              mimeType: "image/jpeg",
              data: cleanBase64
            }
          }
        };
        ws.send(JSON.stringify(videoMsg));
        updateCameraBadge(true, '📸 已傳送高清截圖給 AI');
      }

      if (sessionSnapshots.length < 6) {
        sessionSnapshots.push(dataUrl);
      }

      // 2. Save the manual snapshot locally to Pictures/crew-pocket
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

  function updateDockControls() {
    const dockMuteBtn = document.getElementById('live-dock-mute-btn');
    const dockMuteContainer = document.getElementById('live-dock-mute-icon-container');
    const dockCameraBtn = document.getElementById('live-dock-camera-btn');

    const isAiSpeaking = isAiResponding || (audioPlayer && audioPlayer.activeSources.length > 0);

    if (isAiSpeaking) {
      if (dockMuteBtn) {
        dockMuteBtn.className = 'flex-1 h-[52px] px-4 rounded-2xl bg-gradient-to-r from-amber-500 to-rose-600 hover:from-amber-400 hover:to-rose-500 active:scale-95 text-white shadow-xl shadow-amber-500/40 flex items-center justify-center transition border border-amber-300/50';
        dockMuteBtn.title = 'AI 說話中 · 點擊打斷';
      }
      if (dockMuteContainer) {
        dockMuteContainer.innerHTML = `
          <svg class="w-7 h-7 text-white animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/>
          </svg>
        `;
      }
    } else if (isMuted) {
      if (dockMuteBtn) {
        dockMuteBtn.className = 'flex-1 h-[52px] px-4 rounded-2xl bg-rose-900/90 hover:bg-rose-800 active:scale-95 text-rose-200 shadow-xl shadow-rose-950/60 flex items-center justify-center transition border border-rose-500/60';
        dockMuteBtn.title = '麥克風已靜音 · 點擊開啟';
      }
      if (dockMuteContainer) {
        dockMuteContainer.innerHTML = `
          <svg class="w-7 h-7 text-rose-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-1.294 4.072M12 18a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M9.88 9.88A3 3 0 0012 14a3 3 0 003-3V6a3 3 0 00-3-3 3 3 0 00-2.12.88M3 3l18 18"/>
          </svg>
        `;
      }
    } else {
      if (dockMuteBtn) {
        dockMuteBtn.className = 'flex-1 h-[52px] px-4 rounded-2xl bg-gradient-to-r from-teal-500 to-indigo-600 hover:from-teal-400 hover:to-indigo-500 active:scale-95 text-white shadow-xl shadow-teal-500/30 flex items-center justify-center transition border border-teal-400/50';
        dockMuteBtn.title = '通話收音中 · 點擊靜音';
      }
      if (dockMuteContainer) {
        dockMuteContainer.innerHTML = `
          <svg class="w-7 h-7 text-white animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/>
          </svg>
        `;
      }
    }

    if (isCameraOn) {
      if (dockCameraBtn) {
        dockCameraBtn.className = 'flex-1 max-w-[76px] h-[52px] rounded-2xl bg-indigo-600 hover:bg-indigo-500 active:scale-95 border border-indigo-400 text-white flex items-center justify-center transition shadow-lg shrink-0';
        dockCameraBtn.title = '關閉相機';
        dockCameraBtn.innerHTML = `
          <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M4 4h10a2 2 0 012 2v2.5l4.5-3a1 1 0 011.5.86v11.28a1 1 0 01-1.5.86L16 15.5V18a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2z"/>
          </svg>
        `;
      }
    } else {
      if (dockCameraBtn) {
        dockCameraBtn.className = 'flex-1 max-w-[76px] h-[52px] rounded-2xl bg-slate-800/90 hover:bg-slate-700 active:scale-95 border border-slate-700 text-slate-200 flex items-center justify-center transition shadow-lg shrink-0';
        dockCameraBtn.title = '開啟相機';
        dockCameraBtn.innerHTML = `
          <svg class="w-6 h-6 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
          </svg>
        `;
      }
    }
  }

  function toggleMute() {
    // 🛑 Tap-to-Interrupt: If AI is speaking, clicking center button instantly interrupts the AI
    if (isAiResponding || (audioPlayer && audioPlayer.activeSources.length > 0)) {
      if (audioPlayer) audioPlayer.stopAll();
      isAiResponding = false;
      hasSentFrameForCurrentTurn = false;
      lastAiSpokeTime = 0;
      updateCardStatus('listening', '🎙️ 可以開始說話');
      updateDockControls();
      if (navigator.vibrate) navigator.vibrate(30);
      return;
    }

    isMuted = !isMuted;

    // 🛡️ Smooth Silence Flush: send 100ms zeroed audio frame so Gemini server VAD cleanly detects turn completion
    if (isMuted && ws && ws.readyState === WebSocket.OPEN) {
      try {
        const silentPcm = new Float32Array(1600);
        const silentBuf = floatTo16BitPCM(silentPcm);
        const silentBase64 = arrayBufferToBase64(silentBuf);
        ws.send(JSON.stringify({
          realtimeInput: {
            audio: {
              mimeType: "audio/pcm;rate=16000",
              data: silentBase64
            }
          }
        }));
      } catch (e) {}
    }

    if (micMediaStream) {
      micMediaStream.getAudioTracks().forEach(t => {
        t.enabled = !isMuted;
      });
    }

    const btn = document.getElementById('live-card-mute-btn');
    const icon = document.getElementById('live-card-mute-icon');
    const label = document.getElementById('live-card-mute-label');

    const isAiSpeaking = audioPlayer && audioPlayer.activeSources.length > 0;

    if (isMuted) {
      if (btn) {
        btn.classList.replace('bg-slate-800', 'bg-rose-900/80');
        btn.classList.replace('border-slate-700', 'border-rose-500');
      }
      if (icon) icon.textContent = '🔇';
      if (label) label.textContent = '已靜音';
      if (!isAiSpeaking) {
        updateCardStatus('muted', '🔇 麥克風已靜音');
      }
    } else {
      if (btn) {
        btn.classList.replace('bg-rose-900/80', 'bg-slate-800');
        btn.classList.replace('border-rose-500', 'border-slate-700');
      }
      if (icon) icon.textContent = '🎙️';
      if (label) label.textContent = '靜音';
      if (!isAiSpeaking) {
        updateCardStatus('listening', '🎙️ 可以開始說話');
      }
    }

    updateDockControls();
    if (typeof window.haptic === 'function') window.haptic('medium');
  }

  async function toggleCamera() {
    isCameraOn = !isCameraOn;
    if (typeof window.haptic === 'function') window.haptic('medium');
    const box = document.getElementById('live-card-camera-box');
    const video = document.getElementById('live-card-video');
    const btn = document.getElementById('live-card-camera-btn');
    const label = document.getElementById('live-card-camera-label');

    if (isCameraOn) {
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: cameraFacingMode, width: { ideal: 1920 }, height: { ideal: 1080 } }
        });
        if (video) {
          video.muted = true;
          video.defaultMuted = true;
          video.playsInline = true;
          video.srcObject = cameraStream;
          video.play().catch(() => {});
        }
        if (audioContext && audioContext.state === 'suspended') {
          audioContext.resume().catch(() => {});
        }
        if (box) box.classList.remove('hidden');
        if (btn) {
          btn.classList.replace('bg-slate-800', 'bg-indigo-600');
          btn.classList.replace('border-slate-700', 'border-indigo-400');
        }
        if (label) label.textContent = '關閉相機';

        updateDockControls();

        // Auto-scroll down smoothly so the user sees the camera view immediately
        setTimeout(() => {
          const liveCard = document.getElementById('live-inline-card');
          if (liveCard) {
            liveCard.scrollIntoView({ behavior: 'smooth', block: 'end' });
          } else if (messagesContainer) {
            messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' });
          }
        }, 120);

        updateCameraBadge(false, '待命中 (說話時自動發送)');

      } catch (err) {
        alert('無法開啟相機：' + err.message);
        isCameraOn = false;
      }
    } else {
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
      updateDockControls();
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

  function trySendVideoFrame() {
    if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN || !isCameraOn) return;
    if (isAiResponding || (audioPlayer && audioPlayer.activeSources.length > 0) || (Date.now() - lastAiSpokeTime < 1200)) {
      updateCameraBadge(false, 'AI 說話中 (暫停傳圖)');
      return;
    }
    if (hasSentFrameForCurrentTurn) {
      return;
    }
    if (Date.now() - lastVideoFrameSentTime < 3000) {
      return;
    }

    const video = document.getElementById('live-card-video');
    if (!video || video.videoWidth === 0) return;

    try {
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
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
      hasSentFrameForCurrentTurn = true;
      lastVideoFrameSentTime = Date.now();
      if (sessionSnapshots.length < 6) {
        sessionSnapshots.push(jpegDataUrl);
      }
      updateCameraBadge(true, '📸 已捕捉畫面送出給 AI');
    } catch (e) {
      console.warn('[Video Frame Send Error]', e);
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
    if (m === 'models/gemini-2.0-flash-exp' || m === 'gemini-2.0-flash-exp') {
      m = DEFAULT_MODEL;
      localStorage.setItem(MODEL_KEY, m);
    }
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
    if (typeof window.haptic === 'function') window.haptic('success');

    // Update Header Live Button
    if (liveVoiceBtn) {
      liveVoiceBtn.classList.add('bg-rose-950/80', 'text-rose-300', 'border-rose-500/50');
      const span = liveVoiceBtn.querySelector('span:last-child');
      if (span) span.textContent = '通話中';
    }

    // 📱 Option A: Switch bottom bar to Live Voice Dock (Bottom Ergonomic Action Dock)
    const standardInputBar = document.getElementById('standard-input-bar');
    const liveBottomDock = document.getElementById('live-bottom-dock');
    if (standardInputBar) standardInputBar.classList.add('hidden');
    if (liveBottomDock) {
      liveBottomDock.classList.remove('hidden');
      liveBottomDock.classList.add('flex');
    }
    updateDockControls();
    setMediaSessionActive(true);
    
    audioSendBuffer = [];
    sessionSnapshots = [];
    fullSessionAudioChunks = [];
    let sessionExecutedTools = [];
    isMuted = false;
    isCameraOn = false;
    liveCallStartTs = Date.now();

    // 🕹️ Phone Screen Automation Handler for Gemini Live Tools
    async function handleLiveToolCall(call) {
      if (!call || !call.name) return;
      const name = call.name;
      const args = call.args || {};
      const callId = call.id || 'tool_' + Date.now();
      let toolResult = { success: true };

      console.log(`[Gemini Live Tool Executing] ${name}:`, args);

      try {
        if (name === 'swipe_screen') {
          const dir = (args.direction || 'up').toLowerCase();
          let x1 = 720, y1 = 1800, x2 = 720, y2 = 800, dur = 250;
          if (dir === 'down') { x1 = 720; y1 = 800; x2 = 720; y2 = 1800; }
          else if (dir === 'left') { x1 = 1100; y1 = 1500; x2 = 300; y2 = 1500; }
          else if (dir === 'right') { x1 = 300; y1 = 1500; x2 = 1100; y2 = 1500; }

          if (args.distance === 'long') {
            if (dir === 'up') { y1 = 2200; y2 = 400; }
            else if (dir === 'down') { y1 = 400; y2 = 2200; }
          } else if (args.distance === 'short') {
            if (dir === 'up') { y1 = 1600; y2 = 1200; }
            else if (dir === 'down') { y1 = 1200; y2 = 1600; }
          }

          const res = await fetch('/api/phone/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'SWIPE', x1, y1, x2, y2, durationMs: dur })
          });
          toolResult = await res.json().catch(() => ({ success: true, action: 'swiped' }));
          if (navigator.vibrate) navigator.vibrate(25);
          appendCardTranscript('system', `👆 語音觸發滑動：${dir}`);

        } else if (name === 'tap_screen') {
          let targetX = args.x;
          let targetY = args.y;

          if (args.label && (!targetX || !targetY)) {
            try {
              const nodeRes = await fetch('/api/phone/nodes');
              const nodeData = await nodeRes.json();
              if (nodeData.success && Array.isArray(nodeData.nodes)) {
                const match = nodeData.nodes.find(n => 
                  (n.text && n.text.toLowerCase().includes(args.label.toLowerCase())) ||
                  (n.desc && n.desc.toLowerCase().includes(args.label.toLowerCase()))
                );
                if (match && match.bounds) {
                  targetX = (match.bounds.left + match.bounds.right) / 2;
                  targetY = (match.bounds.top + match.bounds.bottom) / 2;
                }
              }
            } catch (e) {}
          }

          if (targetX && targetY) {
            const res = await fetch('/api/phone/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'TAP', x: targetX, y: targetY })
            });
            toolResult = await res.json().catch(() => ({ success: true, action: 'tapped' }));
            if (navigator.vibrate) navigator.vibrate([20, 30]);
            appendCardTranscript('system', `🎯 語音觸發點擊：(${Math.round(targetX)}, ${Math.round(targetY)}) ${args.label || ''}`);
          } else {
            toolResult = { success: false, error: '找不到指定按鈕座標' };
          }

        } else if (name === 'press_key') {
          const key = (args.key || 'HOME').toUpperCase();
          const res = await fetch('/api/phone/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'KEYEVENT', key })
          });
          toolResult = await res.json().catch(() => ({ success: true, action: 'keyed' }));
          if (navigator.vibrate) navigator.vibrate(30);
          appendCardTranscript('system', `🏠 語音觸發按鍵：${key}`);

        } else if (name === 'take_screenshot') {
          const res = await fetch('/api/phone/screenshot', { method: 'POST' });
          const shotData = await res.json().catch(() => ({ success: false, error: '截圖失敗' }));
          if (shotData && shotData.success && shotData.base64) {
            // 📸 Inject screenshot frame directly into Gemini Live's realtime multimodal vision pipeline!
            const cleanBase64 = shotData.base64.replace(/^data:image\/\w+;base64,/, '');
            const imageMsg = {
              realtimeInput: {
                video: {
                  mimeType: "image/jpeg",
                  data: cleanBase64
                }
              }
            };
            ws.send(JSON.stringify(imageMsg));
            toolResult = { success: true, message: "螢幕截圖已成功傳送至即時視覺管道，請直接根據最新傳送的畫面為使用者進行多模態辨識。" };
            if (navigator.vibrate) navigator.vibrate([20, 40]);
            appendCardTranscript('system', `📸 語音截取螢幕並注入即時視覺感知管道`);
          } else {
            toolResult = { success: false, error: shotData?.error || '截圖失敗' };
          }

        } else if (name === 'write_file') {
          const targetPath = args.path || args.targetPath || 'scratch/voice_note.md';
          const content = args.content || '';
          const res = await fetch('/api/file/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetPath, content })
          });
          const data = await res.json().catch(() => ({ success: false, error: '存檔解析失敗' }));
          if (data.success) {
            toolResult = { success: true, path: data.displayPath, filename: data.filename };
            if (navigator.vibrate) navigator.vibrate([30, 60, 30]);
            appendCardTranscript('system', `📝 語音寫入檔案：${data.displayPath}`);
          } else {
            toolResult = { success: false, error: data.error || '存檔失敗' };
          }

        } else if (name === 'read_file') {
          const targetPath = args.path || args.targetPath || '';
          const res = await fetch(`/api/file/read?path=${encodeURIComponent(targetPath)}`);
          const data = await res.json().catch(() => ({ success: false, error: '讀檔解析失敗' }));
          if (data.success) {
            toolResult = { success: true, content: data.content, path: targetPath };
            appendCardTranscript('system', `📖 語音讀取檔案：${targetPath}`);
          } else {
            toolResult = { success: false, error: data.error || '讀檔失敗' };
          }
        }
      } catch (err) {
        toolResult = { success: false, error: err.message };
      }

      sessionExecutedTools.push({
        name,
        args,
        time: new Date().toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' }),
        result: toolResult
      });

      if (ws && isConnected && ws.readyState === WebSocket.OPEN) {
        const responsePayload = {
          response: { output: toolResult },
          id: call.id || callId,
          name: name
        };
        const toolResponseMsg = {
          toolResponse: {
            functionResponses: [responsePayload]
          }
        };
        console.log('[Gemini Live Tool Response Sent]', toolResponseMsg);
        ws.send(JSON.stringify(toolResponseMsg));
      }
    }

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

      // 3. Microphone Capture with Acoustic Echo Cancellation
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
            tools: [
              {
                functionDeclarations: [
                  {
                    name: "swipe_screen",
                    description: "Scroll or swipe the phone screen. Use 'up' to scroll down/read more content, 'down' to scroll up/go to top, 'left' or 'right' to flip cards/tabs.",
                    parameters: {
                      type: "OBJECT",
                      properties: {
                        direction: {
                          type: "STRING",
                          description: "Direction of scroll: 'up' (scroll down), 'down' (scroll up), 'left', 'right'",
                          enum: ["up", "down", "left", "right"]
                        },
                        distance: {
                          type: "STRING",
                          description: "Scroll distance: 'short', 'normal', 'long'",
                          enum: ["short", "normal", "long"]
                        }
                      },
                      required: ["direction"]
                    }
                  },
                  {
                    name: "tap_screen",
                    description: "Tap on a button or coordinate on the phone screen. Provide label (e.g. '確認', '設定') or x, y pixel coordinates.",
                    parameters: {
                      type: "OBJECT",
                      properties: {
                        label: { type: "STRING", description: "The button label or text on screen to tap" },
                        x: { type: "NUMBER", description: "X pixel coordinate" },
                        y: { type: "NUMBER", description: "Y pixel coordinate" }
                      }
                    }
                  },
                  {
                    name: "press_key",
                    description: "Press an Android system physical key (HOME, BACK, RECENTS).",
                    parameters: {
                      type: "OBJECT",
                      properties: {
                        key: {
                          type: "STRING",
                          description: "The key to press",
                          enum: ["HOME", "BACK", "RECENTS"]
                        }
                      },
                      required: ["key"]
                    }
                  },
                  {
                    name: "take_screenshot",
                    description: "Capture the current phone screen to see what is displayed."
                  },
                  {
                    name: "write_file",
                    description: "Save or create a text/markdown document, notes, requirements, or code file in the Termux workspace (e.g. 'scratch/voice_note.md', 'docs/plan.md').",
                    parameters: {
                      type: "OBJECT",
                      properties: {
                        path: { type: "STRING", description: "Target file path relative to Home directory (e.g. 'scratch/note.md', 'docs/idea.md')" },
                        content: { type: "STRING", description: "Full text or markdown content to write" }
                      },
                      required: ["path", "content"]
                    }
                  },
                  {
                    name: "read_file",
                    description: "Read the content of a file in the Termux workspace.",
                    parameters: {
                      type: "OBJECT",
                      properties: {
                        path: { type: "STRING", description: "Path to read (e.g. 'scratch/note.md', 'GEMINI.md')" }
                      },
                      required: ["path"]
                    }
                  }
                ]
              }
            ],
            systemInstruction: {
              parts: [
                {
                  text: (typeof getCrewLocale === 'function' && getCrewLocale() === 'en')
                    ? "You are Crew Pocket, an expert AI handheld companion. You can directly control the user's phone (swipe_screen, tap_screen, press_key, take_screenshot) and write/read structured documents in the Termux workspace (write_file, read_file). When the user asks you to take notes, write down a plan, summarize dialogue, log issues, or operate the screen, immediately invoke write_file or the corresponding tool, and speak concisely and warmly in Traditional Chinese."
                    : "You are Crew Pocket (口袋特勤隊), an expert AI handheld companion. 你擁有直接操控手機（swipe_screen、tap_screen、press_key、take_screenshot）以及在 Termux 工作區讀寫結構化文件（write_file、read_file）的工具。當使用者請你記錄想法、摘要對話、記待辦事項、記錄問題或操作手機時，請主動調用 write_file 工具儲存結構化 Markdown 檔案（如 'scratch/note.md' 或 'logs/issue.md'），並以繁體中文簡潔自然地口頭回應。"
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
          startSpeechRecognition();
          return;
        }

        // 🕹️ Tool Call Handling
        const tc = response.toolCall || response.tool_call;
        if (tc && tc.functionCalls) {
          console.log('[Gemini Live Tool Call]', tc.functionCalls);
          for (const call of tc.functionCalls) {
            handleLiveToolCall(call);
          }
        }

        // Server Content
        const sc = response.serverContent || response.server_content;
        if (sc) {
          if (sc.interrupted) {
            console.log('[Gemini Live] Interrupted by user!');
            audioPlayer.stopAll();
            isAiResponding = false;
            hasSentFrameForCurrentTurn = false;
            updateDockControls();
            updateCameraBadge(false, '待命中 (說話時自動發送)');
            updateCardStatus('listening', '🎙️ 可以開始說話');
            return;
          }

          const modelTurn = sc.modelTurn || sc.model_turn;
          if (modelTurn && modelTurn.parts) {
            isAiResponding = true;
            updateDockControls();
            updateCameraBadge(false, 'AI 說話中 (暫停傳圖)');
            updateCardStatus('speaking', '🔊 Gemini 說話中 · 點擊按鈕可打斷');
            let hasAudioChunk = false;
            for (const part of modelTurn.parts) {
              const inlineData = part.inlineData || part.inline_data;
              if (inlineData && inlineData.data) {
                const float32 = base64ToFloat32PCM(inlineData.data);
                audioPlayer.playChunk(float32, 24000);
                hasAudioChunk = true;
              }
              const fc = part.functionCall || part.function_call;
              if (fc) {
                console.log('[Gemini Live Part FunctionCall]', fc);
                handleLiveToolCall(fc);
              }
              if (part.text) {
                currentTurnModel = (currentTurnModel && currentTurnModel !== '🎙️ (AI 即時語音回覆)') ? (currentTurnModel + part.text) : part.text;
                appendCardTranscript('model', part.text);
              }
            }
            if (hasAudioChunk && !currentTurnModel) {
              currentTurnModel = '🎙️ (AI 即時語音回覆)';
            }
          }

          const isTurnDone = sc.turnComplete || sc.turn_complete;
          if (isTurnDone) {
            if (currentTurnUser || currentTurnModel) {
              sessionDialogueTurns.push({
                user: currentTurnUser || '🗣️ (您的語音提問)',
                model: currentTurnModel || '🎙️ (AI 語音回覆)'
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
        isAiResponding = false;
        hasSentFrameForCurrentTurn = false;
        stopSpeechRecognition();
        if (e.code !== 1000) {
          updateCardStatus('error', `⚠️ 連線中斷 (${e.code})`);
          let helpText = `連線中斷 (${e.code})`;
          if (e.reason) {
            helpText += `：${e.reason}`;
          } else if (e.code === 1006) {
            helpText += '：網路連線中斷或 Google API 連線受阻，請檢查網路或 API Key';
          } else if (e.code === 1008) {
            helpText += '：API Key 設有限制，請在 AI Studio 改為「無限制」';
          }
          appendCardTranscript('system', helpText);
        }
      };

      let bargeInSpeechCount = 0;

      // 5. Mic PCM Stream with Smart Voiceprint & Barge-In Interruption Detector
      micProcessorNode.onaudioprocess = (e) => {
        if (!isConnected || isMuted || !ws || ws.readyState !== WebSocket.OPEN) return;

        const inputData = e.inputBuffer.getChannelData(0);

        // Audio energy calculation
        let sumSquares = 0;
        for (let i = 0; i < inputData.length; i++) {
          sumSquares += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sumSquares / inputData.length);

        const downsampled = downsampleBuffer(inputData, audioContext.sampleRate, 16000);

        // 🧬 Voiceprint Calibration Mode
        if (isCalibratingVoiceprint) {
          if (rms > 0.02) {
            const frameProfile = extractSpectralProfile(downsampled, 16000);
            voiceprintCalibrationFrames.push(frameProfile);
            if (voiceprintCalibrationFrames.length >= 12) {
              // Finish calibration! Average all spectral vectors
              const avgProfile = new Float32Array(16);
              for (const f of voiceprintCalibrationFrames) {
                for (let b = 0; b < 16; b++) avgProfile[b] += f[b];
              }
              let norm = 0;
              for (let b = 0; b < 16; b++) norm += avgProfile[b] * avgProfile[b];
              norm = Math.sqrt(norm);
              if (norm > 0) {
                for (let b = 0; b < 16; b++) avgProfile[b] /= norm;
              }
              saveUserVoiceprint(avgProfile);
              isCalibratingVoiceprint = false;
              voiceprintCalibrationFrames = [];
              const vpText = document.getElementById('live-voiceprint-text');
              const vpDot = document.getElementById('live-voiceprint-dot');
              const vpBtn = document.getElementById('live-card-voiceprint-btn');
              if (vpText) vpText.textContent = '🧬 聲紋已鎖';
              if (vpDot) vpDot.className = 'w-1.5 h-1.5 rounded-full bg-teal-400';
              if (vpBtn) vpBtn.className = 'px-2 py-0.5 rounded-full bg-slate-800/90 hover:bg-slate-700 active:scale-95 border border-teal-500/50 text-teal-300 text-[10px] font-medium flex items-center gap-1 transition shadow-sm';
              if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
              appendCardTranscript('system', '✅ 專屬聲紋校準完成！AI 將只認你的聲音打斷，100% 免疫旁人干擾！');
            }
          }
        }

        const isAiSpeaking = isAiResponding || (audioPlayer && audioPlayer.activeSources.length > 0);
        const inAiCooldown = (Date.now() - lastAiSpokeTime) < 350;

        // 🎙️ Smart Barge-In Interruption Detection (Option B: Voiceprint Speaker Verification)
        if (isAiSpeaking || inAiCooldown) {
          if (userVoiceprintProfile) {
            // 🧬 Voiceprint Matching Mode
            const profile = extractSpectralProfile(downsampled, 16000);
            const similarity = computeVoiceprintSimilarity(profile, userVoiceprintProfile);

            // Primary speaker voice matched (> 0.72) and has moderate vocal energy (> 0.028)
            if (similarity >= 0.72 && rms > 0.028) {
              bargeInSpeechCount++;
              if (bargeInSpeechCount >= 3) {
                // ⚡ Instant Verified Speaker Barge-In!
                if (audioPlayer) audioPlayer.stopAll();
                isAiResponding = false;
                lastAiSpokeTime = 0;
                bargeInSpeechCount = 0;
                if (navigator.vibrate) navigator.vibrate(20);
                updateDockControls();
                updateCameraBadge(false, '待命中 (說話時自動發送)');
                updateCardStatus('listening', '🎙️ 聲紋驗證通過 · 聆聽中');
                // Fall through to send user speech below!
              } else {
                audioSendBuffer = [];
                return;
              }
            } else {
              // Bystanders / Ambient noise -> filtered out completely!
              bargeInSpeechCount = Math.max(0, bargeInSpeechCount - 1);
              audioSendBuffer = [];
              sustainedSpeechCount = 0;
              return;
            }
          } else {
            // Fallback to high energy near-field gate if not calibrated yet
            if (rms > 0.065) {
              bargeInSpeechCount++;
              if (bargeInSpeechCount >= 5) {
                if (audioPlayer) audioPlayer.stopAll();
                isAiResponding = false;
                lastAiSpokeTime = 0;
                bargeInSpeechCount = 0;
                if (navigator.vibrate) navigator.vibrate(20);
                updateDockControls();
                updateCameraBadge(false, '待命中 (說話時自動發送)');
                updateCardStatus('listening', '🎙️ 已插話打斷 · 聆聽中');
              } else {
                audioSendBuffer = [];
                return;
              }
            } else {
              bargeInSpeechCount = Math.max(0, bargeInSpeechCount - 1);
              audioSendBuffer = [];
              sustainedSpeechCount = 0;
              return;
            }
          }
        } else {
          bargeInSpeechCount = 0;
        }

        // Active user speech tracking
        if (rms > 0.015) {
          sustainedSpeechCount++;
          lastUserSpokeTime = Date.now();

          // Require at least 2 consecutive speech frames (~120ms) before triggering camera snapshot
          if (isCameraOn && !isAiResponding && !hasSentFrameForCurrentTurn && sustainedSpeechCount >= 2) {
            if (Date.now() - lastVideoFrameSentTime > 3000) {
              trySendVideoFrame();
            }
          }
        } else {
          sustainedSpeechCount = Math.max(0, sustainedSpeechCount - 1);
        }

        recordAudioSegment('user', downsampled, 16000);

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

  // ==========================================
  // 📝 Post-Call Option 1: Smart Call Summary Memo Card (with Multimodal AI Transcription)
  // ==========================================
  // ==========================================
  // 📝 Post-Call Option 1: Smart Call Summary Memo Card (with Multimodal AI Transcription)
  // ==========================================
  function buildCallSummaryCardHtml(turns, durationSec, voiceName, snapshots = [], cardId = null, precomputedSummary = null) {
    const mins = Math.floor(durationSec / 60);
    const secs = durationSec % 60;
    const durationText = mins > 0 ? `${mins} 分 ${secs} 秒` : `${secs} 秒`;
    const timeStr = new Date().toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' });
    const memoId = cardId || `call-memo-${Date.now()}`;

    const card = document.createElement('div');
    card.id = `card-wrapper-${memoId}`;
    card.className = 'flex w-full max-w-2xl mx-auto min-w-0 justify-start my-3 animate-fadeIn select-text';

    // Normalize turns into { user, model } or { speaker, text }
    let dialogHtml = '';
    let plainTextSummary = `【Crew Pocket 語音通話備忘錄】\n時間：${timeStr} (時長：${durationText})\n音色：${voiceName}\n\n`;

    const rawTurns = Array.isArray(turns) ? turns : [];
    const hasRealContent = rawTurns.length > 0;

    if (hasRealContent) {
      rawTurns.forEach((t, i) => {
        const isUserSpeaker = t.speaker === 'user' || t.role === 'user' || Boolean(t.user);
        const userText = t.user || (isUserSpeaker ? t.text : '');
        const modelText = t.model || (!isUserSpeaker ? t.text : '');

        if (userText) {
          dialogHtml += `
            <div class="p-2.5 rounded-xl bg-indigo-950/40 border border-indigo-500/30 text-indigo-100 text-xs mb-2">
              <div class="flex items-center gap-1.5 font-bold text-indigo-300 mb-1">
                <span>🗣️ 您 (第 ${i + 1} 輪)：</span>
              </div>
              <div class="leading-relaxed pl-1">${escapeHtml(userText)}</div>
            </div>
          `;
          plainTextSummary += `[您]: ${userText}\n`;
        }
        if (modelText) {
          const formattedModel = typeof formatMessageContent === 'function' ? formatMessageContent(modelText) : escapeHtml(modelText);
          dialogHtml += `
            <div class="p-2.5 rounded-xl bg-slate-900/90 border border-teal-500/30 text-slate-100 text-xs mb-2">
              <div class="flex items-center gap-1.5 font-bold text-teal-300 mb-1">
                <span>✨ Gemini：</span>
              </div>
              <div class="prose prose-invert max-w-none text-xs leading-relaxed pl-1">${formattedModel}</div>
            </div>
          `;
          plainTextSummary += `[Gemini]: ${modelText}\n\n`;
        }
      });
    }

    // 2. Build Smart Key Takeaways
    let keyHighlightsHtml = '';
    if (precomputedSummary && Array.isArray(precomputedSummary) && precomputedSummary.length > 0) {
      keyHighlightsHtml = `
        <div class="p-3 rounded-xl bg-teal-950/40 border border-teal-500/40 mb-2.5">
          <div class="flex items-center gap-1.5 text-xs font-bold text-teal-300 mb-1.5">
            <span>📌</span>
            <span>本次對話重點整理</span>
          </div>
          <ul class="space-y-1 text-xs text-slate-200 list-disc list-inside">
            ${precomputedSummary.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
          </ul>
        </div>
      `;
    } else if (hasRealContent) {
      keyHighlightsHtml = `
        <div class="p-3 rounded-xl bg-teal-950/40 border border-teal-500/40 mb-2.5">
          <div class="flex items-center gap-1.5 text-xs font-bold text-teal-300 mb-1.5">
            <span>📌</span>
            <span>本次對話重點整理</span>
          </div>
          <ul class="space-y-1 text-xs text-slate-200 list-disc list-inside">
            ${rawTurns.slice(0, 3).map(t => {
              const u = t.user || (t.speaker === 'user' ? t.text : '');
              const m = t.model || (t.speaker !== 'user' ? t.text : '');
              const preview = u ? `討論：「${u.slice(0, 40)}${u.length > 40 ? '...' : ''}」` : (m ? `回覆摘要：${m.slice(0, 50)}...` : '');
              return preview ? `<li>${escapeHtml(preview)}</li>` : '';
            }).filter(Boolean).join('')}
          </ul>
        </div>
      `;
    } else {
      keyHighlightsHtml = `
        <div class="p-3 rounded-xl bg-teal-950/30 border border-teal-500/30 mb-2.5 flex items-center gap-2">
          <span class="w-3 h-3 rounded-full border-2 border-teal-400 border-t-transparent animate-spin shrink-0"></span>
          <span class="text-xs text-teal-300 animate-pulse font-mono">正在透過語音 AI 自動提煉對話逐字稿與重點...</span>
        </div>
      `;
    }

    // 3. Build Visual Snapshots Gallery (if camera was used)
    let snapshotsHtml = '';
    if (snapshots && snapshots.length > 0) {
      snapshotsHtml = `
        <div class="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 mb-2.5">
          <div class="flex items-center justify-between text-[11px] font-bold text-slate-300 mb-1.5">
            <span class="flex items-center gap-1">
              <span>📷</span>
              <span>通話中視覺捕捉 (${snapshots.length} 張)</span>
            </span>
            <span class="text-[10px] text-slate-400 font-normal">點擊放大</span>
          </div>
          <div class="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            ${snapshots.map((imgSrc, idx) => `
              <img src="${imgSrc}" class="w-16 h-16 object-cover rounded-lg border border-slate-700 hover:border-teal-400 cursor-pointer transition active:scale-95 shrink-0" alt="Snapshot ${idx + 1}" onclick="if (window.openLightbox) window.openLightbox('${imgSrc}');">
            `).join('')}
          </div>
        </div>
      `;
    }

    card.innerHTML = `
      <div id="${memoId}" class="bg-gradient-to-b from-slate-900 via-slate-900 to-teal-950/40 border border-teal-500/50 text-slate-200 rounded-2xl p-3.5 sm:p-4 text-xs sm:text-sm shadow-2xl w-full">
        <!-- Top Header Badge -->
        <div class="flex items-center justify-between border-b border-teal-800/60 pb-2.5 mb-3">
          <div class="flex items-center gap-2">
            <span class="px-2.5 py-1 rounded-full bg-teal-500/20 text-teal-300 border border-teal-500/40 text-[11px] font-mono font-bold flex items-center gap-1.5 shadow-sm">
              <span class="animate-pulse">🎙️</span>
              <span>語音通話備忘錄</span>
            </span>
            <span class="text-[10px] text-teal-400 font-mono bg-slate-800/80 px-2 py-0.5 rounded-md border border-slate-700">⏱️ ${durationText}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[10px] text-slate-400 font-mono">${timeStr}</span>
            <button type="button" class="copy-memo-btn px-2 py-0.5 text-[10px] font-mono bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-white rounded-md border border-slate-700 transition" title="複製備忘錄文字">
              📋 複製
            </button>
          </div>
        </div>

        <!-- 📌 Smart Key Highlights -->
        <div id="highlights-container-${memoId}">
          ${keyHighlightsHtml}
        </div>

        <!-- 📷 Visual Snapshots Gallery (if any) -->
        ${snapshotsHtml}

        <!-- 💬 Collapsible Full Transcript Accordion -->
        <details class="group mt-2 border border-slate-800/80 rounded-xl bg-slate-950/40 overflow-hidden" open>
          <summary class="flex items-center justify-between px-3 py-2 cursor-pointer select-none text-xs font-semibold text-teal-300 hover:bg-slate-900/60 transition">
            <span class="flex items-center gap-1.5">
              <span>💬</span>
              <span>完整逐字對話記錄</span>
            </span>
            <span class="text-slate-400 group-open:rotate-180 transition-transform duration-200">▼</span>
          </summary>
          <div id="transcript-container-${memoId}" class="p-3 border-t border-slate-800/80 max-h-80 overflow-y-auto space-y-2 bg-slate-950/20">
            ${dialogHtml || '<div class="text-slate-400 text-xs italic">通話已記錄</div>'}
          </div>
        </details>

        <!-- Footer Note -->
        <div class="mt-3 pt-2 border-t border-slate-800/80 text-[10px] text-slate-400 font-mono flex items-center justify-between">
          <span class="flex items-center gap-1">
            <span>🧠</span>
            <span class="text-slate-400">已同步至上下文記憶 · 可打字接續討論</span>
          </span>
          <span class="text-teal-400 font-bold">✨ Gemini Live (${escapeHtml(voiceName)})</span>
        </div>
      </div>
    `;

    // Bind copy button
    const copyBtn = card.querySelector('.copy-memo-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(plainTextSummary).then(() => {
          copyBtn.textContent = '✅ 已複製';
          setTimeout(() => { copyBtn.textContent = '📋 複製'; }, 1500);
        }).catch(() => {});
      });
    }

    return card;
  }

  // Expose globally for history rendering across sessions
  window.buildCallSummaryCardHtml = buildCallSummaryCardHtml;

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

    if (typeof window.haptic === 'function') window.haptic('heavy');

    // Reset Header Live Button
    if (liveVoiceBtn) {
      liveVoiceBtn.classList.remove('bg-rose-950/80', 'text-rose-300', 'border-rose-500/50');
      const span = liveVoiceBtn.querySelector('span:last-child');
      if (span) span.textContent = 'Live 通話';
    }

    // 📱 Option A: Restore bottom standard chat input bar
    const standardInputBar = document.getElementById('standard-input-bar');
    const liveBottomDock = document.getElementById('live-bottom-dock');
    if (liveBottomDock) {
      liveBottomDock.classList.add('hidden');
      liveBottomDock.classList.remove('flex');
    }
    if (standardInputBar) standardInputBar.classList.remove('hidden');

    setMediaSessionActive(false);

    // Remove active inline card cleanly
    removeInlineCard();

    // Collect any remaining turn
    if (currentTurnUser || currentTurnModel) {
      sessionDialogueTurns.push({
        user: currentTurnUser || '🗣️ (您的語音提問)',
        model: currentTurnModel || '🎙️ (AI 語音回覆)'
      });
      currentTurnUser = '';
      currentTurnModel = '';
    }

    // 🔒 Tool-centric Execution History & Action Summary (Option 2: 100% Tool-Driven Records)
    const toolsToSync = sessionExecutedTools.slice();
    sessionExecutedTools = [];
    sessionDialogueTurns = [];
    sessionSnapshots = [];
    fullSessionAudioChunks = [];

    const durationSec = liveCallStartTs > 0 ? Math.max(1, Math.round((Date.now() - liveCallStartTs) / 1000)) : 0;
    const voiceName = getSelectedVoice();
    const timeStr = new Date().toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' });
    const mins = Math.floor(durationSec / 60);
    const secs = durationSec % 60;
    const durationText = mins > 0 ? `${mins} 分 ${secs} 秒` : `${secs} 秒`;

    if (toolsToSync.length > 0) {
      const toolCard = document.createElement('div');
      toolCard.className = 'w-full max-w-2xl mx-auto my-3 p-4 rounded-2xl bg-gradient-to-br from-slate-900/90 via-slate-900/95 to-slate-950/90 border border-teal-500/30 text-slate-200 text-sm shadow-xl backdrop-blur-md animate-fadeIn select-text';

      let actionsHtml = toolsToSync.map((t) => {
        let icon = '⚡';
        let label = t.name;
        let detail = '';
        if (t.name === 'write_file') {
          icon = '📝';
          label = `建立/寫入文件`;
          detail = `<code class="text-xs bg-slate-800 text-teal-300 px-1.5 py-0.5 rounded font-mono">${escapeHtml(t.args?.path || '')}</code>`;
        } else if (t.name === 'read_file') {
          icon = '📖';
          label = `讀取文件`;
          detail = `<code class="text-xs bg-slate-800 text-teal-300 px-1.5 py-0.5 rounded font-mono">${escapeHtml(t.args?.path || '')}</code>`;
        } else if (t.name === 'swipe_screen') {
          icon = '👆';
          label = `滑動螢幕 (${t.args?.direction || 'up'})`;
        } else if (t.name === 'tap_screen') {
          icon = '🎯';
          label = `點擊螢幕 ${t.args?.label ? `[${t.args.label}]` : `(${Math.round(t.args?.x || 0)}, ${Math.round(t.args?.y || 0)})`}`;
        } else if (t.name === 'press_key') {
          icon = '🏠';
          label = `按鍵動作 [${t.args?.key || 'HOME'}]`;
        } else if (t.name === 'take_screenshot') {
          icon = '📸';
          label = `螢幕視覺分析截圖`;
        }
        return `
          <div class="flex items-center gap-2.5 p-2 rounded-xl bg-slate-800/40 border border-slate-700/40 text-xs">
            <span class="text-base">${icon}</span>
            <span class="font-medium text-slate-200">${label}</span>
            ${detail ? `<span class="ml-2">${detail}</span>` : ''}
            <span class="text-[10px] text-slate-500 font-mono ml-auto">${t.time}</span>
          </div>
        `;
      }).join('');

      toolCard.innerHTML = `
        <div class="flex items-center justify-between pb-2.5 border-b border-slate-700/50 mb-3">
          <div class="flex items-center gap-2">
            <div class="w-7 h-7 rounded-lg bg-teal-500/20 text-teal-400 flex items-center justify-center text-sm font-bold">🎙️</div>
            <div>
              <div class="font-bold text-slate-100 text-xs">Gemini Live 語音操作紀錄</div>
              <div class="text-[10px] text-slate-400">通話時長：${durationText} · 音色：${voiceName}</div>
            </div>
          </div>
          <span class="text-[10px] px-2 py-0.5 rounded-full bg-teal-950/80 border border-teal-500/30 text-teal-300 font-mono">${timeStr}</span>
        </div>
        <div class="space-y-1.5 mb-1">
          ${actionsHtml}
        </div>
      `;

      if (messagesContainer) {
        messagesContainer.appendChild(toolCard);
        if (typeof scrollToBottom === 'function') scrollToBottom(true);
      }

      // Sync tool action summary into server session history
      const activeConvId = (typeof currentConversationId !== 'undefined' && currentConversationId) ? currentConversationId : null;
      const toolLines = toolsToSync.map(t => `- ${t.name}: ${JSON.stringify(t.args)} (${t.time})`).join('\n');
      fetch('/api/live-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: activeConvId,
          user_message: `🗣️ 語音操作指令 (通話時長：${durationText})`,
          assistant_message: `✨ Gemini Live 執行了 ${toolsToSync.length} 項操作：\n${toolLines}`,
          call_memo: {
            duration_sec: durationSec,
            voice_name: voiceName,
            tools: toolsToSync
          }
        })
      }).then(res => res.json()).then(data => {
        if (data.success && data.conversation_id && (typeof currentConversationId !== 'undefined' && !currentConversationId)) {
          currentConversationId = data.conversation_id;
          localStorage.setItem('agy_active_conv_id', data.conversation_id);
        }
      }).catch(() => {});

    } else if (durationSec >= 3) {
      const badge = document.createElement('div');
      badge.className = 'w-full my-2 flex justify-center animate-fadeIn';
      badge.innerHTML = `
        <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/60 border border-slate-700/50 text-slate-400 text-xs">
          <span class="w-1.5 h-1.5 rounded-full bg-teal-500"></span>
          <span>Gemini Live 通話結束 (${durationText})</span>
        </div>
      `;
      if (messagesContainer) {
        messagesContainer.appendChild(badge);
        if (typeof scrollToBottom === 'function') scrollToBottom(true);
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

  // 📱 Option A: Bottom Voice Dock Event Listeners
  const dockMuteBtn = document.getElementById('live-dock-mute-btn');
  if (dockMuteBtn) {
    dockMuteBtn.addEventListener('click', toggleMute);
  }

  const dockCameraBtn = document.getElementById('live-dock-camera-btn');
  if (dockCameraBtn) {
    dockCameraBtn.addEventListener('click', toggleCamera);
  }

  const dockHangupBtn = document.getElementById('live-dock-hangup-btn');
  if (dockHangupBtn) {
    dockHangupBtn.addEventListener('click', endLiveSession);
  }

})();
