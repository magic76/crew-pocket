/**
 * 🎙️ Crew Pocket - Option A: Pure Inline Live Voice Card (No Distracting Background Sync)
 * Direct Real-Time Multimodal Communication in Dedicated Live Card UI.
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'crew_pocket_gemini_api_key';
  const VOICE_KEY = 'crew_pocket_live_voice';
  const MODEL_KEY = 'crew_pocket_live_model';
  const PROMPT_KEY = 'crew_pocket_live_prompt';
  const DEFAULT_VOICE = 'Puck';
  const DEFAULT_MODEL = 'models/gemini-3.1-flash-live-preview';
  const GEMINI_LIVE_VOICES = [
    ['Zephyr', '明亮'], ['Puck', '歡快'], ['Charon', '資訊豐富'], ['Kore', '堅定'], ['Fenrir', '興奮'],
    ['Leda', '年輕'], ['Orus', '堅定'], ['Aoede', '輕快'], ['Callirrhoe', '悠閒'], ['Autonoe', '明亮'],
    ['Enceladus', '氣聲'], ['Iapetus', '清晰'], ['Umbriel', '輕鬆'], ['Algieba', '圓潤'], ['Despina', '柔順'],
    ['Erinome', '清楚'], ['Algenib', '沙啞'], ['Rasalgethi', '資訊豐富'], ['Laomedeia', '活潑'], ['Achernar', '柔和'],
    ['Alnilam', '堅定'], ['Schedar', '平穩'], ['Gacrux', '成熟'], ['Pulcherrima', '前進感'], ['Achird', '友善'],
    ['Zubenelgenubi', '隨和'], ['Vindemiatrix', '溫柔'], ['Sadachbia', '生動'], ['Sadaltager', '博學'], ['Sulafat', '溫暖']
  ];

  // State
  let ws = null;
  let audioContext = null;
  let micMediaStream = null;
  let micAudioSource = null;
  let micProcessorNode = null;
  let silentGainNode = null;
  let audioPlayer = null;
  let isConnected = false;
  let isLiveSetupReady = false;
  let isMuted = false;
  let isCameraOn = false;
  let cameraFacingMode = 'environment';
  let cameraStream = null;
  let cameraInterval = null;
  let analyser = null;
  let animFrameId = null;
  let audioSendBuffer = [];
  // Keep the first couple of seconds spoken while Gemini is completing setup.
  // Without this, the mic is already open but the initial PCM frames are dropped.
  let preSetupAudioBuffer = [];
  const PRE_SETUP_AUDIO_MAX_SAMPLES = 32000; // ~2 seconds at 16 kHz
  
  // Real-time STT & Session Dialogue Tracker
  let speechRecognizer = null;
  let sessionDialogueTurns = [];
  let currentTurnUser = '';
  let currentTurnInputTranscript = '';
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
  let sessionExecutedTools = [];
  // Live API can surface the same function call in both toolCall and
  // serverContent.parts. Keep tool execution serialized and de-duplicated so
  // a tool response cannot race the audio stream or get sent twice.
  let liveToolQueue = Promise.resolve();
  let liveToolCallKeys = new Set();
  let liveSessionMode = 'operation';
  let voicePreviewSource = null;
  const voicePreviewCache = new Map();
  let lastVoicePreviewAt = 0;

  // DOM References
  const liveVoiceBtn = document.getElementById('live-voice-btn');
  const liveSettingsBtn = document.getElementById('live-settings-btn');
  const liveKeyModal = document.getElementById('live-key-modal');
  const liveApiKeyInput = document.getElementById('live-api-key-input');
  const liveModelSelect = document.getElementById('live-model-select');
  const liveVoiceSelect = document.getElementById('live-voice-select');
  const liveVoicePreviewBtn = document.getElementById('live-voice-preview-btn');
  const liveVoicePreviewStatus = document.getElementById('live-voice-preview-status');
  const livePromptInput = document.getElementById('live-prompt-input');
  const liveSaveKeyBtn = document.getElementById('live-save-key-btn');
  const liveCloseKeyBtn = document.getElementById('live-close-key-btn');
  const messagesContainer = document.getElementById('messages-container');

  // ==========================================
  // 🔊 Gapless 24kHz PCM Audio Stream Player (single HTML5 media output path)
  // ==========================================
  class LiveAudioPlayer {
    constructor(ctx) {
      this.ctx = ctx;
      this.nextStartTime = 0;
      this.activeSources = [];
      this.jitterBufferSec = 0.035; // 35ms smooth jitter buffer to eliminate pops/stutters

      // Route the rendered response through a real HTML5 audio element. On
      // Android Chrome this keeps hardware volume keys on STREAM_MUSIC rather
      // than the in-call stream. Do not also connect sources to destination:
      // two output paths cause doubled audio and echo.
      try {
        this.mediaStreamDest = this.ctx.createMediaStreamDestination();
        this.audioEl = document.createElement('audio');
        this.audioEl.autoplay = true;
        this.audioEl.playsInline = true;
        this.audioEl.controls = false;
        this.audioEl.volume = 1;
        this.audioEl.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10px;top:-10px;';
        this.audioEl.srcObject = this.mediaStreamDest.stream;
        document.body.appendChild(this.audioEl);
        this.audioEl.play().catch(() => {});

        // Keep the media track active between response chunks so Android does
        // not fall back to the communication stream during short pauses.
        if (typeof this.ctx.createConstantSource === 'function') {
          const silentOsc = this.ctx.createConstantSource();
          const silentGain = this.ctx.createGain();
          silentGain.gain.value = 0.00001;
          silentOsc.connect(silentGain);
          silentGain.connect(this.mediaStreamDest);
          silentOsc.start();
          this.silentOsc = silentOsc;
        }
      } catch (e) {
        this.mediaStreamDest = null;
        this.audioEl = null;
      }
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

      if (this.mediaStreamDest) {
        try {
          source.connect(this.mediaStreamDest);
        } catch (e) {
          source.connect(this.ctx.destination);
        }
      } else {
        source.connect(this.ctx.destination);
      }

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
      if (this.silentOsc) {
        try { this.silentOsc.stop(); } catch (e) {}
        this.silentOsc = null;
      }
      if (this.audioEl) {
        try {
          this.audioEl.pause();
          this.audioEl.srcObject = null;
          this.audioEl.remove();
        } catch (e) {}
        this.audioEl = null;
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
            artist: 'Crew Pocket 口袋指揮',
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
  // 🧬 3D-Speaker Deep Neural Voiceprint Engine (CAM++ 192-Dim Embeddings)
  // ==========================================
  const VOICEPRINT_KEY = 'crew_voiceprint_embedding_v2';
  let userVoiceprintProfile = null;
  let isCalibratingVoiceprint = false;
  let voiceprintCalibrationSamples = [];
  let voiceprintOnnxSession = null;
  let melFbankExtractor = null;

  function loadUserVoiceprint() {
    try {
      const raw = localStorage.getItem(VOICEPRINT_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length === 192) {
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

  // 🧬 80-Channel Log Mel FilterBank Feature Extractor (Kaldi 16kHz compatible)
  class MelFbankExtractor {
    constructor(sampleRate = 16000, numMelBins = 80, frameLengthMs = 25, frameShiftMs = 10, nFft = 512) {
      this.sampleRate = sampleRate;
      this.numMelBins = numMelBins;
      this.frameLength = Math.floor(sampleRate * frameLengthMs / 1000); // 400
      this.frameShift = Math.floor(sampleRate * frameShiftMs / 1000);   // 160
      this.nFft = nFft; // 512
      this.numFftBins = Math.floor(nFft / 2) + 1; // 257

      this.window = new Float32Array(this.frameLength);
      for (let i = 0; i < this.frameLength; i++) {
        this.window[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (this.frameLength - 1));
      }

      this.melFilters = this.createMelFilterbank(numMelBins, this.numFftBins, sampleRate, 20, 7600);
    }

    hzToMel(hz) {
      return 2595.0 * Math.log10(1.0 + hz / 700.0);
    }

    melToHz(mel) {
      return 700.0 * (Math.pow(10.0, mel / 2595.0) - 1.0);
    }

    createMelFilterbank(numBins, numFftBins, sampleRate, lowFreq = 20, highFreq = 7600) {
      const lowMel = this.hzToMel(lowFreq);
      const highMel = this.hzToMel(highFreq);
      const melPoints = new Float32Array(numBins + 2);
      for (let i = 0; i < numBins + 2; i++) {
        melPoints[i] = lowMel + i * (highMel - lowMel) / (numBins + 1);
      }

      const filters = [];
      for (let m = 1; m <= numBins; m++) {
        const filter = new Float32Array(numFftBins);
        const leftMel = melPoints[m - 1];
        const centerMel = melPoints[m];
        const rightMel = melPoints[m + 1];

        for (let k = 0; k < numFftBins; k++) {
          const hz = k * sampleRate / this.nFft;
          const mel = this.hzToMel(hz);
          if (mel >= leftMel && mel <= centerMel) {
            filter[k] = (mel - leftMel) / (centerMel - leftMel);
          } else if (mel > centerMel && mel <= rightMel) {
            filter[k] = (rightMel - mel) / (rightMel - centerMel);
          }
        }
        filters.push(filter);
      }
      return filters;
    }

    extractFbank(audioSamples) {
      if (!audioSamples || audioSamples.length < this.frameLength) return null;
      const numFrames = Math.floor((audioSamples.length - this.frameLength) / this.frameShift) + 1;
      if (numFrames <= 0) return null;

      // Kaldi standard: Scale PCM to [-32768, 32767] if audio is in [-1.0, 1.0]
      let scale = 1.0;
      let maxAbs = 0;
      for (let i = 0; i < Math.min(1000, audioSamples.length); i++) {
        const a = Math.abs(audioSamples[i]);
        if (a > maxAbs) maxAbs = a;
      }
      if (maxAbs <= 1.5) {
        scale = 32768.0;
      }

      const fbank = new Float32Array(numFrames * this.numMelBins);

      for (let f = 0; f < numFrames; f++) {
        const start = f * this.frameShift;
        const re = new Float32Array(this.nFft);
        const im = new Float32Array(this.nFft);
        let prev = (start > 0 ? audioSamples[start - 1] : audioSamples[start]) * scale;
        for (let n = 0; n < this.frameLength; n++) {
          const curr = audioSamples[start + n] * scale;
          re[n] = (curr - 0.97 * prev) * this.window[n];
          prev = curr;
        }

        this.fft(re, im);
        const powerSpectrum = new Float32Array(this.numFftBins);
        for (let k = 0; k < this.numFftBins; k++) {
          powerSpectrum[k] = re[k] * re[k] + im[k] * im[k];
        }

        for (let m = 0; m < this.numMelBins; m++) {
          const filter = this.melFilters[m];
          let melEnergy = 0;
          for (let k = 0; k < this.numFftBins; k++) {
            melEnergy += powerSpectrum[k] * filter[k];
          }
          fbank[f * this.numMelBins + m] = Math.log(Math.max(1e-6, melEnergy));
        }
      }

      // Global CMVN
      for (let m = 0; m < this.numMelBins; m++) {
        let sum = 0;
        for (let f = 0; f < numFrames; f++) {
          sum += fbank[f * this.numMelBins + m];
        }
        const mean = sum / numFrames;
        for (let f = 0; f < numFrames; f++) {
          fbank[f * this.numMelBins + m] -= mean;
        }
      }

      return { data: fbank, numFrames, numMelBins: this.numMelBins };
    }

    fft(re, im) {
      const n = 512;
      let j = 0;
      for (let i = 0; i < n - 1; i++) {
        if (i < j) {
          let tempRe = re[i]; re[i] = re[j]; re[j] = tempRe;
          let tempIm = im[i]; im[i] = im[j]; im[j] = tempIm;
        }
        let k = n >> 1;
        while (k <= j) {
          j -= k;
          k >>= 1;
        }
        j += k;
      }
      for (let len = 2; len <= n; len <<= 1) {
        const halfLen = len >> 1;
        const angle = -2 * Math.PI / len;
        const wStepRe = Math.cos(angle);
        const wStepIm = Math.sin(angle);
        for (let i = 0; i < n; i += len) {
          let wRe = 1.0;
          let wIm = 0.0;
          for (let k = 0; k < halfLen; k++) {
            const uRe = re[i + k];
            const uIm = im[i + k];
            const vRe = re[i + k + halfLen] * wRe - im[i + k + halfLen] * wIm;
            const vIm = re[i + k + halfLen] * wIm + im[i + k + halfLen] * wRe;
            re[i + k] = uRe + vRe;
            im[i + k] = uIm + vIm;
            re[i + k + halfLen] = uRe - vRe;
            im[i + k + halfLen] = uIm - vIm;
            const nextWRe = wRe * wStepRe - wIm * wStepIm;
            const nextWIm = wRe * wStepIm + wIm * wStepRe;
            wRe = nextWRe;
            wIm = nextWIm;
          }
        }
      }
    }
  }

  async function initVoiceprintEngine() {
    if (voiceprintOnnxSession) return voiceprintOnnxSession;
    try {
      if (typeof ort === 'undefined') {
        console.warn('[Voiceprint ONNX] ort library not found in window');
        return null;
      }
      if (!melFbankExtractor) melFbankExtractor = new MelFbankExtractor(16000, 80, 25, 10, 512);
      ort.env.wasm.wasmPaths = window.location.origin + '/js/';
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.simd = true;
      voiceprintOnnxSession = await ort.InferenceSession.create('/models/3dspeaker_campplus.onnx', {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      });
      console.log('✅ [Voiceprint ONNX] 3D-Speaker CAM++ Model Ready!');
      return voiceprintOnnxSession;
    } catch (err) {
      console.warn('[Voiceprint ONNX] Failed to load 3D-Speaker model:', err);
      return null;
    }
  }

  async function computeSpeakerEmbedding(audioSamples) {
    if (!voiceprintOnnxSession) {
      const sess = await initVoiceprintEngine();
      if (!sess) throw new Error('ONNX 聲紋模型尚未載入完成，請確認網路或稍候重試');
    }
    if (!melFbankExtractor) melFbankExtractor = new MelFbankExtractor(16000, 80, 25, 10, 512);

    if (!audioSamples || audioSamples.length < 3200) {
      throw new Error(`錄音樣本數不足 (${audioSamples ? audioSamples.length : 0} 點)，請說話至少 1 秒`);
    }

    const fbankResult = melFbankExtractor.extractFbank(audioSamples);
    if (!fbankResult || fbankResult.numFrames < 15) {
      throw new Error(`有效語音特徵幀數不足 (${fbankResult ? fbankResult.numFrames : 0} 幀)`);
    }

    try {
      const inputTensor = new ort.Tensor('float32', fbankResult.data, [1, fbankResult.numFrames, fbankResult.numMelBins]);
      const inputName = (voiceprintOnnxSession.inputNames && voiceprintOnnxSession.inputNames[0]) ? voiceprintOnnxSession.inputNames[0] : 'x';
      const feeds = {};
      feeds[inputName] = inputTensor;

      const results = await voiceprintOnnxSession.run(feeds);
      const outputName = (voiceprintOnnxSession.outputNames && voiceprintOnnxSession.outputNames[0]) ? voiceprintOnnxSession.outputNames[0] : Object.keys(results)[0];
      const outputTensor = results[outputName] || results.embedding || results.output;
      if (!outputTensor || !outputTensor.data) throw new Error('模型未返回有效特徵輸出');
      const embedding = new Float32Array(outputTensor.data);

      let norm = 0;
      for (let i = 0; i < embedding.length; i++) {
        if (!isNaN(embedding[i])) norm += embedding[i] * embedding[i];
      }
      norm = Math.sqrt(norm);
      if (norm > 1e-6 && !isNaN(norm)) {
        for (let i = 0; i < embedding.length; i++) embedding[i] /= norm;
      } else {
        throw new Error('神經網路特徵計算結果異常 (norm is zero or NaN)');
      }
      return embedding;
    } catch (e) {
      console.warn('[Speaker Embedding Error]', e);
      throw new Error('神經網路運算異常：' + (e.message || e));
    }
  }

  function computeVoiceprintSimilarity(v1, v2) {
    if (!v1 || !v2 || v1.length !== v2.length) return 0;
    let dot = 0;
    for (let i = 0; i < v1.length; i++) {
      if (!isNaN(v1[i]) && !isNaN(v2[i])) {
        dot += v1[i] * v2[i];
      }
    }
    if (isNaN(dot)) return 0;
    return Math.max(-1.0, Math.min(1.0, dot));
  }

  // 🎛️ Voice & Voiceprint Real-time Tuning Configuration
  const TUNING_CONFIG = {
    SIMILARITY_THRESHOLD: parseFloat(localStorage.getItem('crew_live_similarity_threshold')) || 0.45,
    RMS_THRESHOLD: parseFloat(localStorage.getItem('crew_live_rms_threshold')) || 0.028,
    BARGEIN_FRAMES: parseInt(localStorage.getItem('crew_live_bargein_frames'), 10) || 3,
    GAIN_BOOST: parseFloat(localStorage.getItem('crew_live_gain_boost')) || 1.4,
    save() {
      localStorage.setItem('crew_live_similarity_threshold', this.SIMILARITY_THRESHOLD);
      localStorage.setItem('crew_live_rms_threshold', this.RMS_THRESHOLD);
      localStorage.setItem('crew_live_bargein_frames', this.BARGEIN_FRAMES);
      localStorage.setItem('crew_live_gain_boost', this.GAIN_BOOST);
    },
    reset() {
      this.SIMILARITY_THRESHOLD = 0.45;
      this.RMS_THRESHOLD = 0.028;
      this.BARGEIN_FRAMES = 3;
      this.GAIN_BOOST = 1.4;
      this.save();
    }
  };

  // ==========================================
  // 🧬 Standalone Dedicated Voiceprint Studio Modal Manager
  // ==========================================
  const voiceprintModal = document.getElementById('voiceprint-modal');
  const openVoiceprintModalBtn = document.getElementById('open-voiceprint-modal-btn');
  const closeVoiceprintModalBtn = document.getElementById('close-voiceprint-modal-btn');
  const modalVpDoneBtn = document.getElementById('modal-vp-done-btn');
  const modalVpClearBtn = document.getElementById('modal-vp-clear-btn');
  const modalVpRecordBtn = document.getElementById('modal-vp-record-btn');
  const modalVpTestBtn = document.getElementById('modal-vp-test-btn');

  function updateVoiceprintModalUI() {
    const badge = document.getElementById('modal-voiceprint-status-badge');
    const clearBtn = document.getElementById('modal-vp-clear-btn');
    const testBox = document.getElementById('modal-vp-test-box');
    const recText = document.getElementById('modal-vp-record-text');

    if (userVoiceprintProfile) {
      if (badge) {
        badge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold font-mono bg-teal-950 text-teal-300 border border-teal-500/50';
        badge.textContent = '🟢 已鎖定 (192-Dim CAM++)';
      }
      if (clearBtn) clearBtn.classList.remove('hidden');
      if (testBox) testBox.classList.remove('hidden');
      if (recText) recText.textContent = '重新錄音校準 (3 秒)';
    } else {
      if (badge) {
        badge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold font-mono bg-slate-800 text-slate-400 border border-slate-700';
        badge.textContent = '⚪ 尚未建立';
      }
      if (clearBtn) clearBtn.classList.add('hidden');
      if (testBox) testBox.classList.add('hidden');
      if (recText) recText.textContent = '開始錄音校準 (3 秒)';
    }

    // Also update in-call card badges if present
    const liveVpText = document.getElementById('live-voiceprint-text');
    const liveVpDot = document.getElementById('live-voiceprint-dot');
    if (liveVpText) liveVpText.textContent = userVoiceprintProfile ? '🧬 聲紋已鎖' : '🧬 校準聲紋';
    if (liveVpDot) liveVpDot.className = userVoiceprintProfile ? 'w-1.5 h-1.5 rounded-full bg-teal-400' : 'w-1.5 h-1.5 rounded-full bg-slate-500';
  }

  function openVoiceprintModal() {
    if (!voiceprintModal) return;
    initVoiceprintEngine();
    updateVoiceprintModalUI();
    voiceprintModal.classList.remove('opacity-0', 'pointer-events-none');
    voiceprintModal.classList.add('opacity-100');
    const drawer = document.getElementById('drawer');
    const overlay = document.getElementById('drawer-overlay');
    if (drawer) drawer.classList.add('-translate-x-full');
    if (overlay) { overlay.classList.remove('opacity-100'); overlay.classList.add('opacity-0', 'pointer-events-none'); }
    if (typeof window.haptic === 'function') window.haptic('light');
  }

  function closeVoiceprintModal() {
    if (!voiceprintModal) return;
    voiceprintModal.classList.remove('opacity-100');
    voiceprintModal.classList.add('opacity-0', 'pointer-events-none');
  }

  if (openVoiceprintModalBtn) openVoiceprintModalBtn.addEventListener('click', openVoiceprintModal);
  if (closeVoiceprintModalBtn) closeVoiceprintModalBtn.addEventListener('click', closeVoiceprintModal);
  if (modalVpDoneBtn) modalVpDoneBtn.addEventListener('click', closeVoiceprintModal);

  if (modalVpClearBtn) {
    modalVpClearBtn.addEventListener('click', () => {
      if (confirm('確定要清除已儲存的專屬聲紋嗎？清除後將還原為近場能量過濾模式。')) {
        clearUserVoiceprint();
        updateVoiceprintModalUI();
        if (typeof window.haptic === 'function') window.haptic('medium');
      }
    });
  }

  // 🎙️ Standalone Recording Routine (Completely Isolated from AI)
  let isStandaloneRecording = false;
  async function startStandaloneVoiceprintCalibration() {
    if (isStandaloneRecording) return;
    isStandaloneRecording = true;

    const recBtn = document.getElementById('modal-vp-record-btn');
    const recText = document.getElementById('modal-vp-record-text');
    const recIcon = document.getElementById('modal-vp-record-icon');
    const instruction = document.getElementById('modal-vp-instruction');
    const progressBar = document.getElementById('modal-vp-progress-bar');

    if (recBtn) recBtn.disabled = true;
    if (recIcon) recIcon.textContent = '⏳';
    if (recText) recText.textContent = '正在準備神經網路模型...';

    await initVoiceprintEngine();

    if (recIcon) recIcon.textContent = '🔴';
    if (recText) recText.textContent = '正在錄音採樣中...';
    if (instruction) instruction.innerHTML = '🎙️ 請念出：<span class="text-indigo-300 font-semibold">「今天天氣真好，幫我看一下今天的行程」</span>';
    if (typeof window.haptic === 'function') window.haptic('medium');

    let stream = null;
    let audioCtx = null;
    let recordedSamples = [];

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioCtxClass();
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(2048, 1, 1);

      processor.onaudioprocess = (e) => {
        if (!isStandaloneRecording) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const downsampled = downsampleBuffer(inputData, audioCtx.sampleRate, 16000);
        for (let i = 0; i < downsampled.length; i++) {
          recordedSamples.push(downsampled[i]);
        }
        const pct = Math.min(100, Math.round((recordedSamples.length / 32000) * 100));
        if (progressBar) progressBar.style.width = `${pct}%`;
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      // Record for 3.0 seconds
      await new Promise(resolve => setTimeout(resolve, 3000));

      isStandaloneRecording = false;
      source.disconnect();
      processor.disconnect();
      stream.getTracks().forEach(t => t.stop());
      audioCtx.close();

      if (recIcon) recIcon.textContent = '🧠';
      if (recText) recText.textContent = '神經網路特徵計算中...';

      try {
        const embedding = await computeSpeakerEmbedding(new Float32Array(recordedSamples));
        if (embedding && embedding.length === 192) {
          saveUserVoiceprint(embedding);
          updateVoiceprintModalUI();
          if (instruction) instruction.textContent = '✅ 聲紋校準成功！已建立專屬 192 維神經特徵！';
          if (progressBar) progressBar.style.width = '100%';
          if (typeof window.haptic === 'function') window.haptic('heavy');
        } else {
          if (instruction) instruction.textContent = '⚠️ 聲音特徵不足，請再試一次';
          if (progressBar) progressBar.style.width = '0%';
        }
      } catch (embErr) {
        console.warn('[Voiceprint Embedding Calc Error]', embErr);
        if (instruction) instruction.textContent = `⚠️ ${embErr.message || '特徵提取失敗'}`;
        if (progressBar) progressBar.style.width = '0%';
      }
    } catch (err) {
      console.warn('[Standalone Voiceprint Recording Error]', err);
      if (instruction) instruction.textContent = '⚠️ 麥克風異常：' + err.message;
    } finally {
      isStandaloneRecording = false;
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (audioCtx && audioCtx.state !== 'closed') audioCtx.close();
      if (recBtn) recBtn.disabled = false;
      if (recIcon) recIcon.textContent = '🎙️';
      if (recText) recText.textContent = userVoiceprintProfile ? '重新錄音校準 (3 秒)' : '開始錄音校準 (3 秒)';
    }
  }
  if (modalVpRecordBtn) modalVpRecordBtn.addEventListener('click', startStandaloneVoiceprintCalibration);

  // 🧪 Standalone Live Voice Test Routine
  let isTesting = false;
  async function startStandaloneVoiceprintTest() {
    if (isTesting || !userVoiceprintProfile) return;
    isTesting = true;

    const testBtn = document.getElementById('modal-vp-test-btn');
    const testVal = document.getElementById('modal-vp-test-val');

    if (testBtn) testBtn.innerHTML = '<span>🎙️</span><span>請說話測試 (1.5 秒)...</span>';
    if (testVal) { testVal.textContent = '聆聽分析中...'; testVal.className = 'font-bold text-amber-300'; }

    let stream = null;
    let audioCtx = null;
    let testSamples = [];

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }
      });
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioCtxClass();
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(2048, 1, 1);

      processor.onaudioprocess = (e) => {
        if (!isTesting) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const downsampled = downsampleBuffer(inputData, audioCtx.sampleRate, 16000);
        for (let i = 0; i < downsampled.length; i++) testSamples.push(downsampled[i]);
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      await new Promise(resolve => setTimeout(resolve, 1500));

      source.disconnect();
      processor.disconnect();
      stream.getTracks().forEach(t => t.stop());
      audioCtx.close();

      const embedding = await computeSpeakerEmbedding(new Float32Array(testSamples));
      if (embedding) {
        const similarity = computeVoiceprintSimilarity(embedding, userVoiceprintProfile);
        const isMatch = similarity >= TUNING_CONFIG.SIMILARITY_THRESHOLD;
        if (testVal) {
          testVal.textContent = `${similarity.toFixed(2)} ${isMatch ? '✅ (主講人吻合)' : '❌ (旁人/不匹配)'}`;
          testVal.className = isMatch ? 'font-bold text-teal-300' : 'font-bold text-rose-400';
        }
        if (typeof window.haptic === 'function') window.haptic(isMatch ? 'light' : 'heavy');
      } else {
        if (testVal) { testVal.textContent = '聲音過短，無法計算'; testVal.className = 'font-bold text-slate-400'; }
      }
    } catch (err) {
      if (testVal) testVal.textContent = '測試失敗：' + err.message;
    } finally {
      isTesting = false;
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (audioCtx && audioCtx.state !== 'closed') audioCtx.close();
      if (testBtn) testBtn.innerHTML = '<span>🧪</span><span>按住或點擊測試我的聲音</span>';
    }
  }
  if (modalVpTestBtn) modalVpTestBtn.addEventListener('click', startStandaloneVoiceprintTest);

  // ==========================================
  // 🧮 Audio Data Conversion Utilities
  // ==========================================
  function floatTo16BitPCM(float32Array, gainBoost = 1.1) {
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
    card.className = 'flex w-full max-w-2xl mx-auto justify-start transition-all duration-300 animate-fadeIn';
    
    card.innerHTML = `
      <div class="bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 border border-teal-500/50 rounded-2xl p-3.5 text-xs sm:text-sm shadow-2xl shadow-teal-950/50 w-full min-w-0 space-y-3 relative overflow-hidden">
        
        <!-- CARD TOP TOOLBAR: 狀態指示 (靠左) + 調音/音色膠囊 (靠右) -->
        <div class="border-b border-slate-800/80 pb-2 flex items-center justify-between gap-1.5 min-w-0">
          <div class="flex items-center gap-1.5 min-w-0">
            ${liveSessionMode === 'discussion' ? '<span class="px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[10px] font-bold shrink-0">🗣️ 討論</span>' : ''}
            <span id="live-card-status-dot" class="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0"></span>
            <span id="live-card-status-text" class="text-amber-300 font-bold text-xs font-mono truncate">⚡ 準備中...</span>
          </div>
          
          <div class="flex items-center gap-1.5 shrink-0">
            <!-- 🎛️ Live Tuning Panel Toggle Button -->
            <button id="live-card-tuning-toggle-btn" type="button" class="w-6 h-6 rounded-full bg-slate-800/90 hover:bg-slate-700 active:scale-95 border border-slate-700 text-[11px] text-slate-300 flex items-center justify-center transition shadow-sm cursor-pointer" title="開啟/收合即時調音台">🎛️</button>

            <!-- 🗣️ Voice Selector Pill (音色切換膠囊 · 靠右放置) -->
            <div class="relative inline-flex items-center shrink-0">
              <select id="live-card-voice-select" class="appearance-none bg-teal-950/80 hover:bg-teal-900 active:scale-95 border border-teal-500/50 text-teal-300 text-[11px] font-semibold rounded-full pl-2 pr-4 py-0.5 outline-none transition cursor-pointer shadow-sm" title="點擊切換音色">
                ${renderVoiceOptions(selectedVoice)}
              </select>
              <span class="pointer-events-none absolute right-1 text-[8px] text-teal-400 font-mono">▾</span>
            </div>
          </div>
        </div>

        <!-- 🎙️ In-card call controls: keep the composer area unobstructed. -->
        <div id="live-card-action-row" class="flex items-center gap-1.5 border-b border-slate-800/70 pb-2">
          <button id="live-card-mute-btn" type="button" class="flex-1 min-h-[40px] px-2 rounded-lg bg-slate-800/90 hover:bg-slate-700 active:scale-95 border border-slate-700 text-slate-200 text-[11px] font-semibold flex items-center justify-center gap-1.5 transition" title="點擊切換靜音">
            <span id="live-card-mute-icon">🎙️</span><span id="live-card-mute-label">靜音</span>
          </button>
          <button id="live-card-camera-btn" type="button" class="flex-1 min-h-[40px] px-2 rounded-lg bg-slate-800/90 hover:bg-slate-700 active:scale-95 border border-slate-700 text-slate-200 text-[11px] font-semibold flex items-center justify-center gap-1.5 transition" title="開啟/關閉相機">
            <span>📷</span><span id="live-card-camera-label">相機</span>
          </button>
          <button id="live-card-hangup-btn" type="button" class="flex-1 min-h-[40px] px-2 rounded-lg bg-rose-600/90 hover:bg-rose-500 active:scale-95 border border-rose-500/60 text-white text-[11px] font-semibold flex items-center justify-center gap-1.5 transition" title="結束通話">
            <span>⏹</span><span>掛斷</span>
          </button>
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

        <!-- 🎛️ REAL-TIME VOICE TUNING CONSOLE (調音台抽屜) -->
        <div id="live-card-tuning-drawer" class="hidden p-3 rounded-xl bg-slate-950/90 border border-teal-500/40 space-y-2.5 transition-all text-xs select-none">
          <div class="flex items-center justify-between border-b border-slate-800 pb-1.5">
            <div class="flex items-center gap-1.5 font-bold text-teal-300 text-[11px]">
              <span>🎛️</span>
              <span>口袋指揮調音台 (即時可視化反饋)</span>
            </div>
            <button id="live-tuning-reset-btn" type="button" class="text-[10px] text-slate-400 hover:text-rose-300 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 transition">重設預設</button>
          </div>

          <!-- Real-time Live Meters -->
          <div class="grid grid-cols-2 gap-2 bg-slate-900/80 p-2 rounded-lg border border-slate-800 font-mono text-[10px]">
            <div>
              <div class="flex justify-between text-slate-400 mb-0.5">
                <span>即時音量 (RMS)</span>
                <span id="live-meter-rms-val" class="text-teal-300">0.000</span>
              </div>
              <div class="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div id="live-meter-rms-bar" class="bg-teal-400 h-full w-0 transition-all duration-75"></div>
              </div>
            </div>
            <div>
              <div class="flex justify-between text-slate-400 mb-0.5">
                <span>聲紋吻合度</span>
                <span id="live-meter-sim-val" class="text-indigo-300">--</span>
              </div>
              <div class="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div id="live-meter-sim-bar" class="bg-indigo-400 h-full w-0 transition-all duration-75"></div>
              </div>
            </div>
          </div>

          <!-- Sliders -->
          <div class="space-y-2 text-[11px]">
            <!-- Slider 1: Similarity Threshold -->
            <div>
              <div class="flex justify-between items-center mb-1">
                <span class="text-slate-300 flex items-center gap-1">
                  <span>🧬</span>
                  <span>聲紋匹配門檻 (防旁人插嘴)</span>
                </span>
                <span id="live-tuning-sim-label" class="font-mono text-teal-300 text-[10px] bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">${TUNING_CONFIG.SIMILARITY_THRESHOLD.toFixed(2)}</span>
              </div>
              <input id="live-tuning-sim-slider" type="range" min="0.20" max="0.88" step="0.01" value="${TUNING_CONFIG.SIMILARITY_THRESHOLD}" class="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-teal-400">
              <div class="flex justify-between text-[9px] text-slate-500 font-mono mt-0.5">
                <span>0.20 (超靈敏)</span>
                <span>0.45 (建議)</span>
                <span>0.88 (極嚴格)</span>
              </div>
            </div>

            <!-- Slider 2: RMS Energy Threshold -->
            <div>
              <div class="flex justify-between items-center mb-1">
                <span class="text-slate-300 flex items-center gap-1">
                  <span>🔊</span>
                  <span>插話音量門檻 (防環境噪音)</span>
                </span>
                <span id="live-tuning-rms-label" class="font-mono text-teal-300 text-[10px] bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">${TUNING_CONFIG.RMS_THRESHOLD.toFixed(3)}</span>
              </div>
              <input id="live-tuning-rms-slider" type="range" min="0.015" max="0.060" step="0.002" value="${TUNING_CONFIG.RMS_THRESHOLD}" class="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-teal-400">
              <div class="flex justify-between text-[9px] text-slate-500 font-mono mt-0.5">
                <span>0.015 (輕聲)</span>
                <span>0.028 (建議)</span>
                <span>0.060 (大聲)</span>
              </div>
            </div>

            <!-- Slider 3: Barge-in Reaction Speed (Frames) -->
            <div>
              <div class="flex justify-between items-center mb-1">
                <span class="text-slate-300 flex items-center gap-1">
                  <span>⚡</span>
                  <span>打斷反應時間 (防短暫咳嗽)</span>
                </span>
                <span id="live-tuning-frames-label" class="font-mono text-teal-300 text-[10px] bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">${TUNING_CONFIG.BARGEIN_FRAMES} 幀 (${TUNING_CONFIG.BARGEIN_FRAMES * 60}ms)</span>
              </div>
              <input id="live-tuning-frames-slider" type="range" min="2" max="6" step="1" value="${TUNING_CONFIG.BARGEIN_FRAMES}" class="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-teal-400">
              <div class="flex justify-between text-[9px] text-slate-500 font-mono mt-0.5">
                <span>2幀 (120ms 極速)</span>
                <span>3幀 (180ms 穩定)</span>
                <span>6幀 (360ms 穩健)</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Real-time Dialogue Subtitles (純 Live 對話區) -->
        <div id="live-card-transcript" class="space-y-1.5 text-xs max-h-48 overflow-y-auto pr-1">
          <div id="live-card-placeholder" class="text-slate-500 text-center text-[11px] font-mono py-1">💬 請說話...</div>
        </div>

      </div>
    `;

    if (liveSessionMode === 'discussion') {
      const cameraButton = card.querySelector('#live-card-camera-btn');
      const cameraBox = card.querySelector('#live-card-camera-box');
      const tuningButton = card.querySelector('#live-card-tuning-toggle-btn');
      if (cameraButton) cameraButton.classList.add('hidden');
      if (cameraBox) cameraBox.classList.add('hidden');
      if (tuningButton) tuningButton.classList.add('hidden');
    }

    if (messagesContainer) {
      messagesContainer.appendChild(card);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // Attach Inline Controls
    const cardMuteBtn = card.querySelector('#live-card-mute-btn');
    if (cardMuteBtn) cardMuteBtn.addEventListener('click', toggleMute);
    const cardCameraBtn = card.querySelector('#live-card-camera-btn');
    if (cardCameraBtn) cardCameraBtn.addEventListener('click', toggleCamera);
    const cardHangupBtn = card.querySelector('#live-card-hangup-btn');
    if (cardHangupBtn) cardHangupBtn.addEventListener('click', endLiveSession);
    updateCardCallControls();

    const tuningToggleBtn = card.querySelector('#live-card-tuning-toggle-btn');
    const tuningDrawer = card.querySelector('#live-card-tuning-drawer');
    if (tuningToggleBtn && tuningDrawer) {
      tuningToggleBtn.addEventListener('click', () => {
        tuningDrawer.classList.toggle('hidden');
        if (navigator.vibrate) navigator.vibrate(15);
      });
    }

    // Slider 1: Sim Slider
    const simSlider = card.querySelector('#live-tuning-sim-slider');
    const simLabel = card.querySelector('#live-tuning-sim-label');
    if (simSlider && simLabel) {
      simSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        TUNING_CONFIG.SIMILARITY_THRESHOLD = val;
        simLabel.textContent = val.toFixed(2);
        TUNING_CONFIG.save();
      });
    }

    // Slider 2: RMS Slider
    const rmsSlider = card.querySelector('#live-tuning-rms-slider');
    const rmsLabel = card.querySelector('#live-tuning-rms-label');
    if (rmsSlider && rmsLabel) {
      rmsSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        TUNING_CONFIG.RMS_THRESHOLD = val;
        rmsLabel.textContent = val.toFixed(3);
        TUNING_CONFIG.save();
      });
    }

    // Slider 3: Frames Slider
    const framesSlider = card.querySelector('#live-tuning-frames-slider');
    const framesLabel = card.querySelector('#live-tuning-frames-label');
    if (framesSlider && framesLabel) {
      framesSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        TUNING_CONFIG.BARGEIN_FRAMES = val;
        framesLabel.textContent = `${val} 幀 (${val * 60}ms)`;
        TUNING_CONFIG.save();
      });
    }

    // Reset Button
    const resetBtn = card.querySelector('#live-tuning-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        TUNING_CONFIG.reset();
        if (simSlider) simSlider.value = TUNING_CONFIG.SIMILARITY_THRESHOLD;
        if (simLabel) simLabel.textContent = TUNING_CONFIG.SIMILARITY_THRESHOLD.toFixed(2);
        if (rmsSlider) rmsSlider.value = TUNING_CONFIG.RMS_THRESHOLD;
        if (rmsLabel) rmsLabel.textContent = TUNING_CONFIG.RMS_THRESHOLD.toFixed(3);
        if (framesSlider) framesSlider.value = TUNING_CONFIG.BARGEIN_FRAMES;
        if (framesLabel) framesLabel.textContent = `${TUNING_CONFIG.BARGEIN_FRAMES} 幀 (${TUNING_CONFIG.BARGEIN_FRAMES * 60}ms)`;
        if (navigator.vibrate) navigator.vibrate(20);
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
          setTimeout(() => startLiveSession(liveSessionMode), 300);
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
  // 🎙️ Real-time Speech-to-Text (STT) Engine
  // ==========================================
  function startSpeechRecognition() {
    // Deliberately disabled: Android Web Speech repeatedly acquires audio
    // focus and emits system chimes. Gemini Live already receives raw PCM.
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

  function updateCardCallControls() {
    const muteBtn = document.getElementById('live-card-mute-btn');
    const muteIcon = document.getElementById('live-card-mute-icon');
    const muteLabel = document.getElementById('live-card-mute-label');
    const cameraBtn = document.getElementById('live-card-camera-btn');
    const cameraLabel = document.getElementById('live-card-camera-label');
    const isAiSpeaking = isAiResponding || (audioPlayer && audioPlayer.activeSources.length > 0);

    if (muteBtn) {
      if (isAiSpeaking) {
        muteBtn.className = 'flex-1 min-h-[40px] px-2 rounded-lg bg-amber-600/90 hover:bg-amber-500 active:scale-95 border border-amber-400/60 text-white text-[11px] font-semibold flex items-center justify-center gap-1.5 transition';
        muteBtn.title = 'AI 說話中 · 點擊打斷';
        if (muteIcon) muteIcon.textContent = '⏸️';
        if (muteLabel) muteLabel.textContent = '打斷';
      } else if (isMuted) {
        muteBtn.className = 'flex-1 min-h-[40px] px-2 rounded-lg bg-rose-900/90 hover:bg-rose-800 active:scale-95 border border-rose-500/60 text-rose-200 text-[11px] font-semibold flex items-center justify-center gap-1.5 transition';
        muteBtn.title = '麥克風已靜音 · 點擊開啟';
        if (muteIcon) muteIcon.textContent = '🔇';
        if (muteLabel) muteLabel.textContent = '開麥';
      } else {
        muteBtn.className = 'flex-1 min-h-[40px] px-2 rounded-lg bg-slate-800/90 hover:bg-slate-700 active:scale-95 border border-slate-700 text-slate-200 text-[11px] font-semibold flex items-center justify-center gap-1.5 transition';
        muteBtn.title = '通話收音中 · 點擊靜音';
        if (muteIcon) muteIcon.textContent = '🎙️';
        if (muteLabel) muteLabel.textContent = '靜音';
      }
    }

    if (cameraBtn) {
      cameraBtn.className = isCameraOn
        ? 'flex-1 min-h-[40px] px-2 rounded-lg bg-indigo-600/90 hover:bg-indigo-500 active:scale-95 border border-indigo-400/70 text-white text-[11px] font-semibold flex items-center justify-center gap-1.5 transition'
        : 'flex-1 min-h-[40px] px-2 rounded-lg bg-slate-800/90 hover:bg-slate-700 active:scale-95 border border-slate-700 text-slate-200 text-[11px] font-semibold flex items-center justify-center gap-1.5 transition';
      cameraBtn.title = isCameraOn ? '關閉相機' : '開啟相機';
      if (cameraLabel) cameraLabel.textContent = isCameraOn ? '關相機' : '相機';
    }
  }

  function updateDockControls() {
    updateCardCallControls();
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
        try { cameraStream.getTracks().forEach(t => t.stop()); } catch (e) {}
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
    localStorage.setItem(MODEL_KEY, DEFAULT_MODEL);
    return DEFAULT_MODEL;
  }

  function getLivePrompt() {
    return (localStorage.getItem(PROMPT_KEY) || '').trim();
  }

  function getDiscussionContext() {
    const title = document.getElementById('header-title')?.textContent?.trim() || '目前對話';
    const provider = typeof currentProvider !== 'undefined' ? currentProvider : 'antigravity';
    const convId = typeof currentConversationId !== 'undefined' ? currentConversationId : '';
    const container = document.getElementById('messages-container');
    const text = container ? String(container.innerText || '').replace(/\s+/g, ' ').trim() : '';
    const recent = text.length > 3000 ? text.slice(-3000) : text;
    return `【目前討論上下文】\nSession：${title}\nProvider：${provider}\n${convId ? `Session ID：${convId}\n` : ''}最近畫面內容：\n${recent || '（目前沒有可用的歷史訊息）'}`;
  }

  function sendLiveAudioChunk(samples) {
    if (!samples || samples.length === 0 || !ws || ws.readyState !== WebSocket.OPEN || !isConnected) return;
    const pcmBuffer = floatTo16BitPCM(samples);
    const base64Audio = arrayBufferToBase64(pcmBuffer);
    ws.send(JSON.stringify({
      realtimeInput: {
        audio: {
          mimeType: 'audio/pcm;rate=16000',
          data: base64Audio
        }
      }
    }));
  }

  function flushPreSetupAudio() {
    if (!preSetupAudioBuffer.length) return;
    audioSendBuffer = preSetupAudioBuffer.concat(audioSendBuffer);
    preSetupAudioBuffer = [];
    while (audioSendBuffer.length >= 640 && isLiveSetupReady && ws && ws.readyState === WebSocket.OPEN) {
      sendLiveAudioChunk(new Float32Array(audioSendBuffer.splice(0, 640)));
    }
  }

  function renderVoiceOptions(selectedVoice) {
    return GEMINI_LIVE_VOICES.map(([name, description]) =>
      `<option value="${name}" ${selectedVoice === name ? 'selected' : ''}>${name} · ${description}</option>`
    ).join('');
  }

  function populateVoiceSelect(select, selectedVoice) {
    if (select) select.innerHTML = renderVoiceOptions(selectedVoice);
  }

  async function previewSelectedVoice() {
    const apiKey = getApiKey();
    const voiceName = liveVoiceSelect ? liveVoiceSelect.value : DEFAULT_VOICE;
    if (!apiKey) {
      if (liveVoicePreviewStatus) liveVoicePreviewStatus.textContent = '請先保存 API Key 才能試聽。';
      return;
    }
    if (Date.now() - lastVoicePreviewAt < 1500) return;
    lastVoicePreviewAt = Date.now();
    if (liveVoicePreviewBtn) {
      liveVoicePreviewBtn.disabled = true;
      liveVoicePreviewBtn.textContent = '⏳ 播放中';
    }
    if (liveVoicePreviewStatus) liveVoicePreviewStatus.textContent = `正在試聽 ${voiceName}…`;
    try {
      let audioBase64 = voicePreviewCache.get(voiceName);
      if (!audioBase64) {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent?key=${encodeURIComponent(apiKey)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Read aloud exactly this Traditional Chinese transcript. Do not answer it, explain it, or add any words:「你好，這是 Gemini Live 語音試聽。」' }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } }
            }
          })
        });
        const data = await response.json();
        if (!response.ok) {
          const limitHint = response.status === 429 ? '（試聽配額或速率限制，請稍後再試）' : '';
          throw new Error((data.error?.message || '試聽請求失敗') + limitHint);
        }
        const part = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData || p.inline_data);
        const inlineData = part?.inlineData || part?.inline_data;
        audioBase64 = inlineData?.data;
        if (audioBase64) voicePreviewCache.set(voiceName, audioBase64);
      }
      if (!audioBase64) throw new Error('沒有收到音訊資料');

      if (!audioContext || audioContext.state === 'closed') audioContext = new AudioContext();
      await audioContext.resume();
      if (voicePreviewSource) {
        try { voicePreviewSource.stop(); } catch (e) {}
      }
      const binary = atob(audioBase64);
      const samples = new Int16Array(binary.length / 2);
      for (let i = 0; i < samples.length; i++) samples[i] = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
      const buffer = audioContext.createBuffer(1, samples.length, 24000);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;
      voicePreviewSource = audioContext.createBufferSource();
      voicePreviewSource.buffer = buffer;
      voicePreviewSource.connect(audioContext.destination);
      voicePreviewSource.onended = () => {
        if (liveVoicePreviewStatus) liveVoicePreviewStatus.textContent = `${voiceName} 試聽完成。`;
      };
      voicePreviewSource.start();
    } catch (err) {
      console.error('[Live Voice Preview Error]', err);
      if (liveVoicePreviewStatus) liveVoicePreviewStatus.textContent = `試聽失敗：${err.message}`;
    } finally {
      if (liveVoicePreviewBtn) {
        liveVoicePreviewBtn.disabled = false;
        liveVoicePreviewBtn.textContent = '🔊 試聽';
      }
    }
  }

  async function startLiveSession(mode = 'operation') {
    // Prevent duplicate sessions
    if (isConnected || ws) {
      console.warn('[Live] Session already active, resetting...');
      await endLiveSession();
      await new Promise(r => setTimeout(r, 200));
    }

    liveSessionMode = mode === 'discussion' ? 'discussion' : 'operation';
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

    // 📱 Keep the normal composer visible during Live so the voice model can
    // draft a handoff into it without the call controls covering the input.
    const standardInputBar = document.getElementById('standard-input-bar');
    const liveBottomDock = document.getElementById('live-bottom-dock');
    if (standardInputBar) standardInputBar.classList.remove('hidden');
    if (liveBottomDock) {
      // Controls now live inside the Live card so the composer can be shown
      // later without a fixed bottom dock covering it.
      liveBottomDock.classList.add('hidden');
      liveBottomDock.classList.remove('flex');
    }
    updateDockControls();
    setMediaSessionActive(true);
    
    audioSendBuffer = [];
    preSetupAudioBuffer = [];
    isLiveSetupReady = false;
    sessionSnapshots = [];
    sessionExecutedTools = [];
    currentTurnInputTranscript = '';
    liveToolQueue = Promise.resolve();
    liveToolCallKeys = new Set();
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
        const discussionToolAllowed = name === 'record_call_turn' || name === 'draft_message';
        if (liveSessionMode === 'discussion' && !discussionToolAllowed) {
          toolResult = { success: false, error: '目前是語音討論模式，此工具被停用；只允許記錄對話，或在使用者明確要求時把草稿填入主輸入框。' };
          appendCardTranscript('system', `🛡️ 討論模式已阻擋：${name}`);
        } else if (name === 'record_call_turn') {
          const transcriptText = currentTurnInputTranscript.trim();
          // Prefer Gemini Live's provider transcription. The function-call
          // argument is model-generated and may paraphrase or mishear names.
          const userText = transcriptText || '🗣️（使用者語音，未取得原始轉錄）';
          const assistantText = String(args.assistant_text || '').trim();
          if (!userText && !assistantText) {
            toolResult = { success: false, error: '缺少通話文字' };
          } else {
            const turn = {
              user: userText || '🗣️（使用者語音）',
              model: assistantText || '🎙️（Gemini 語音回覆）'
            };
            const lastTurn = sessionDialogueTurns[sessionDialogueTurns.length - 1];
            if (!lastTurn || lastTurn.user !== turn.user || lastTurn.model !== turn.model) {
              sessionDialogueTurns.push(turn);
              if (userText) appendCardTranscript('user', userText);
              if (assistantText) appendCardTranscript('model', assistantText);
            }
            currentTurnUser = '';
            currentTurnInputTranscript = '';
            currentTurnModel = '';
            toolResult = { success: true, recorded: true, turn_count: sessionDialogueTurns.length };
          }

        } else if (name === 'swipe_screen') {
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

        } else if (name === 'draft_message') {
          const draftText = String(args.text || args.message || '').trim();
          const mode = String(args.mode || 'replace').toLowerCase() === 'append' ? 'append' : 'replace';
          const input = document.getElementById('prompt-input');
          if (!input) {
            toolResult = { success: false, error: '找不到 Crew Pocket 主輸入框' };
          } else if (!draftText) {
            toolResult = { success: false, error: '草稿內容不可為空' };
          } else {
            const existing = String(input.value || '').trim();
            input.value = mode === 'append' && existing ? `${existing}\n\n${draftText}` : draftText;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.style.height = 'auto';
            input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
            input.dataset.voiceDraft = 'true';
            const standardInputBar = document.getElementById('standard-input-bar');
            if (standardInputBar) standardInputBar.classList.remove('hidden');
            toolResult = { success: true, mode, chars: draftText.length, drafted: true };
            if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
            appendCardTranscript('system', mode === 'append' ? '📝 已將內容追加到主輸入框' : '📝 已將內容填入主輸入框（尚未送出）');
          }

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
          // Gemini Live expects the function result under `response.result`.
          // Using `output` can leave the model waiting without resuming audio.
          response: { result: toolResult },
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

    function enqueueLiveToolCall(call) {
      if (!call || !call.name) return;
      let key;
      try {
        key = call.id || `${call.name}:${JSON.stringify(call.args || {})}`;
      } catch (e) {
        key = call.id || `${call.name}:${Date.now()}`;
      }
      if (liveToolCallKeys.has(key)) {
        console.debug('[Gemini Live] Ignoring duplicate tool call:', key);
        return;
      }
      liveToolCallKeys.add(key);
      // Never let a failed tool poison the queue; the next tool still needs to
      // return a response so the model can continue speaking.
      liveToolQueue = liveToolQueue
        .catch(() => {})
        .then(() => handleLiveToolCall(call))
        .catch(err => console.error('[Gemini Live Tool Queue Error]', err));
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

      // 3. Microphone Capture. On Android, disabling browser telephony
      // processing keeps the hardware volume keys on the media stream.
      try {
        const isAndroid = /Android/i.test(navigator.userAgent || '');
        micMediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: !isAndroid,
            noiseSuppression: !isAndroid,
            autoGainControl: !isAndroid
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
        isLiveSetupReady = false;
        updateCardStatus('connecting', '⚡ 準備中...');

        const voiceName = getSelectedVoice();
        const baseSystemPrompt = (typeof getCrewLocale === 'function' && getCrewLocale() === 'en')
          ? "You are Crew Pocket, an expert AI handheld companion. MANDATORY dialogue protocol: for EVERY user turn that receives a substantive answer, first silently call record_call_turn exactly once with the user's request and the exact answer you intend to speak. Wait for the successful tool response, then speak that same answer. Never speak a substantive answer before recording it. Do not mention this recording tool aloud. This rule applies on every turn, even when no other tool is needed. You can control the phone (swipe_screen, tap_screen, press_key, take_screenshot), read/write workspace files (write_file, read_file), and use draft_message only when the user explicitly asks you to put a handoff draft into Crew Pocket's main input box. draft_message never submits the message. Speak concisely and warmly."
          : "你是 Crew Pocket（口袋指揮）。【強制逐輪記錄協定】每一輪使用者問題只要需要實質回答，必須先靜默呼叫一次 record_call_turn，填入使用者問題與你準備口頭回答的完整原文；收到工具成功回覆後，才可以說出同一份回答。絕對不要先回答再記錄，也不要漏掉任何一輪；即使沒有使用其他工具也一樣。使用者問題請以輸入語音轉錄的原文為準，不得自行改寫、猜測或替換字詞；若關鍵字聽不清楚，先用語音向使用者確認。不要在語音中提到 record_call_turn。你也可使用 swipe_screen、tap_screen、press_key、take_screenshot 操作手機，以及 write_file、read_file 讀寫工作區；只有使用者明確要求交接或填入輸入框時，才使用 draft_message，而且只填入、不自動送出。請以繁體中文簡潔自然地回應。";
        const discussionPrompt = liveSessionMode === 'discussion'
          ? `\n\n【語音討論模式】\n你現在只負責協助使用者釐清目前議題、追問需求、重述共識，並把零散想法整理成可交給目前 Session 的問題或開發任務。你已收到目前 Session 的摘要與最近畫面內容，但不要把暫時想法當成已確認需求。\n\n嚴格限制：不得操作手機畫面、不得截圖、不得點擊、不得滑動、不得按系統按鍵、不得寫檔、不得直接送出訊息。唯一的受控例外是：當使用者明確要求「幫我輸入」「放到輸入框」「填入這段文字」時，可以呼叫 draft_message，把指定草稿填入主輸入框，但絕對不能自動送出。只有使用者明確要求「整理成交接稿」時，才產生一份完整草稿供使用者確認；只有使用者明確要求「傳給目前 Session」時，才提示前端進入傳送確認。對「好」「可以」「嗯」等模糊回覆，不得視為送出授權。\n\n協助輸入時，請先說明你整理出的內容；收到明確輸入指令後才呼叫 draft_message，並告知使用者「已填入，尚未送出」。\n\n${getDiscussionContext()}`
          : '';
        const customPrompt = getLivePrompt();
        const userSystemPrompt = customPrompt
          ? `${baseSystemPrompt}\n\n【使用者本次語音 Prompt】\n${customPrompt}`
          : baseSystemPrompt;
        const systemPrompt = `${userSystemPrompt}${discussionPrompt}\n\n【系統強制規則／MANDATORY】每次實質回答前，先呼叫 record_call_turn 並等待成功；每輪恰好一次，工具成功後才開口，口頭內容必須與 assistant_text 完全一致。使用者輸入請以原始語音轉錄為準，不得為了讓句子通順而改寫專有名詞、數字或指令；無法確定時先詢問使用者。`;
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
            // Request Gemini Live's native microphone transcription so the
            // memo does not depend on model-generated user_text.
            inputAudioTranscription: {},
            tools: [
              {
                functionDeclarations: [
                  {
                    name: "record_call_turn",
                    description: "MANDATORY: Record exactly one dialogue turn BEFORE speaking the answer. Call this on EVERY substantive user turn, even when no other tool is needed; wait for success, then speak the exact assistant_text. Never skip this call and never call it more than once for the same turn.",
                    parameters: {
                      type: "OBJECT",
                      properties: {
                        user_text: { type: "STRING", description: "The user's spoken request, faithfully transcribed or paraphrased without adding facts." },
                        assistant_text: { type: "STRING", description: "The exact substantive answer Gemini just spoke to the user." }
                      },
                      required: ["user_text", "assistant_text"]
                    }
                  },
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
                    name: "draft_message",
                    description: "Only when the user explicitly asks to hand off, draft, or put the discussed content into Crew Pocket's main text input. Write the complete polished question or request into the input box; never submit it automatically.",
                    parameters: {
                      type: "OBJECT",
                      properties: {
                        text: { type: "STRING", description: "The complete draft question or instruction to place in the main input box." },
                        mode: {
                          type: "STRING",
                          description: "Replace the current input or append after it.",
                          enum: ["replace", "append"]
                        }
                      },
                      required: ["text"]
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
                ].filter(tool => liveSessionMode !== 'discussion' || ['record_call_turn', 'draft_message'].includes(tool.name))
              }
            ],
            systemInstruction: {
              parts: [
                {
                  text: systemPrompt
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
          isLiveSetupReady = true;
          flushPreSetupAudio();
          updateCardStatus('listening', '🎙️ 可以開始說話');
      // Browser SpeechRecognition may emit periodic start/stop beeps on
      // mobile. Gemini Live audio remains fully functional without it.
      // Transcript capture is handled by the Live audio/session turns.
          return;
        }

        // 🕹️ Tool Call Handling
        const tc = response.toolCall || response.tool_call;
        if (tc && tc.functionCalls) {
          console.log('[Gemini Live Tool Call]', tc.functionCalls);
          for (const call of tc.functionCalls) {
            enqueueLiveToolCall(call);
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

          // Keep the provider's raw input transcript separate from the model's
          // tool arguments. The latter may paraphrase or guess pronunciation.
          const inputTranscript = sc.inputTranscription || sc.input_transcription;
          if (inputTranscript && inputTranscript.text) {
            currentTurnInputTranscript += String(inputTranscript.text);
            console.debug('[Gemini Live Input Transcript]', inputTranscript.text);
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
                enqueueLiveToolCall(fc);
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
            const hasTextTurn = currentTurnUser || (currentTurnModel && currentTurnModel !== '🎙️ (AI 即時語音回覆)');
            if (hasTextTurn) {
              sessionDialogueTurns.push({
                user: currentTurnUser || currentTurnInputTranscript.trim() || '🗣️ (您的語音提問)',
                model: currentTurnModel || '🎙️ (AI 語音回覆)'
              });
              currentTurnUser = '';
              currentTurnInputTranscript = '';
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
        isLiveSetupReady = false;
        preSetupAudioBuffer = [];
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
      let recentSpeechRollingBuffer = [];
      let lastEmbeddingCheckTime = 0;
      let currentSpeechSimilarity = 0.5;

      // 5. Mic PCM Stream with 3D-Speaker Neural Voiceprint & Barge-In Interruption Detector
      micProcessorNode.onaudioprocess = (e) => {
        if (isMuted || !audioContext) return;

        const inputData = e.inputBuffer.getChannelData(0);

        // Audio energy calculation
        let sumSquares = 0;
        for (let i = 0; i < inputData.length; i++) {
          sumSquares += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sumSquares / inputData.length);

        const downsampled = downsampleBuffer(inputData, audioContext.sampleRate, 16000);

        // The microphone can become active before the Gemini setup response.
        // Buffer those frames instead of silently dropping the user's opening words.
        if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN || !isLiveSetupReady) {
          for (let i = 0; i < downsampled.length; i++) preSetupAudioBuffer.push(downsampled[i]);
          if (preSetupAudioBuffer.length > PRE_SETUP_AUDIO_MAX_SAMPLES) {
            preSetupAudioBuffer = preSetupAudioBuffer.slice(-PRE_SETUP_AUDIO_MAX_SAMPLES);
          }
          return;
        }

        // 🧬 3D-Speaker Neural Calibration Mode (Collect ~1.75s active voice samples)
        if (isCalibratingVoiceprint) {
          if (rms > 0.012) {
            for (let i = 0; i < downsampled.length; i++) {
              voiceprintCalibrationSamples.push(downsampled[i]);
            }
            const vpText = document.getElementById('live-voiceprint-text');
            const pct = Math.min(100, Math.round((voiceprintCalibrationSamples.length / 28000) * 100));
            if (vpText) vpText.textContent = `🎙️ 採樣 ${pct}%`;

            if (voiceprintCalibrationSamples.length >= 28000) { // ~1.75s @ 16kHz
              isCalibratingVoiceprint = false;
              if (vpText) vpText.textContent = '🧬 計算特徵中...';
              const rawAudio = new Float32Array(voiceprintCalibrationSamples);
              voiceprintCalibrationSamples = [];
              computeSpeakerEmbedding(rawAudio).then(emb => {
                if (emb && emb.length === 192) {
                  saveUserVoiceprint(emb);
                  const vpTextEl = document.getElementById('live-voiceprint-text');
                  const vpDot = document.getElementById('live-voiceprint-dot');
                  const vpBtn = document.getElementById('live-card-voiceprint-btn');
                  if (vpTextEl) vpTextEl.textContent = '🧬 聲紋已鎖';
                  if (vpDot) vpDot.className = 'w-1.5 h-1.5 rounded-full bg-teal-400';
                  if (vpBtn) vpBtn.className = 'px-2 py-0.5 rounded-full bg-slate-800/90 hover:bg-slate-700 active:scale-95 border border-teal-500/50 text-teal-300 text-[10px] font-medium flex items-center gap-1 transition shadow-sm';
                  if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
                  appendCardTranscript('system', '✅ 3D-Speaker 192 維神經聲紋校準完成！已鎖定主講人生理聲帶共振特徵，100% 免疫旁人干擾！');
                } else {
                  const vpTextEl = document.getElementById('live-voiceprint-text');
                  if (vpTextEl) vpTextEl.textContent = '🧬 重新校準';
                  appendCardTranscript('system', '⚠️ 聲紋採樣特徵不足，請對著麥克風念出完整句子再試一次。');
                }
              }).catch(err => {
                console.warn('[Voiceprint Calibration Error]', err);
                const vpTextEl = document.getElementById('live-voiceprint-text');
                if (vpTextEl) vpTextEl.textContent = '🧬 重新校準';
                appendCardTranscript('system', '⚠️ 聲紋模型推論異常：' + err.message);
              });
            }
          }
        }

        // Maintain Rolling Speech Buffer for Neural Verification
        if (rms > 0.015) {
          for (let i = 0; i < downsampled.length; i++) {
            recentSpeechRollingBuffer.push(downsampled[i]);
          }
          if (recentSpeechRollingBuffer.length > 6400) { // Keep last 400ms
            recentSpeechRollingBuffer = recentSpeechRollingBuffer.slice(recentSpeechRollingBuffer.length - 6400);
          }
        } else {
          recentSpeechRollingBuffer = [];
        }

        // 🎛️ Update Live Visual Tuning Meters & Continuous Voiceprint Verification
        const tuningDrawer = document.getElementById('live-card-tuning-drawer');
        if (userVoiceprintProfile && recentSpeechRollingBuffer.length >= 2400 && (Date.now() - lastEmbeddingCheckTime > 120)) {
          lastEmbeddingCheckTime = Date.now();
          computeSpeakerEmbedding(new Float32Array(recentSpeechRollingBuffer)).then(emb => {
            if (emb) {
              const curSim = computeVoiceprintSimilarity(emb, userVoiceprintProfile);
              currentSpeechSimilarity = curSim;

              if (tuningDrawer && !tuningDrawer.classList.contains('hidden')) {
                const simVal = document.getElementById('live-meter-sim-val');
                const simBar = document.getElementById('live-meter-sim-bar');
                if (simVal) {
                  const isMatch = curSim >= TUNING_CONFIG.SIMILARITY_THRESHOLD;
                  simVal.textContent = `${curSim.toFixed(2)} ${isMatch ? '✅' : '❌'}`;
                  simVal.className = isMatch ? 'text-teal-300 font-bold' : 'text-rose-300';
                }
                if (simBar) {
                  const pct = Math.min(100, Math.max(0, Math.round(((curSim - 0.2) / 0.7) * 100)));
                  simBar.style.width = `${pct}%`;
                  simBar.className = curSim >= TUNING_CONFIG.SIMILARITY_THRESHOLD ? 'bg-teal-400 h-full transition-all duration-75' : 'bg-rose-500 h-full transition-all duration-75';
                }
              }

              // Barge-in Check (Interrupt AI only if verified speaker)
              const isAiSpeaking = isAiResponding || (audioPlayer && audioPlayer.activeSources.length > 0);
              if (isAiSpeaking && curSim >= TUNING_CONFIG.SIMILARITY_THRESHOLD && rms > TUNING_CONFIG.RMS_THRESHOLD) {
                if (audioPlayer) audioPlayer.stopAll();
                isAiResponding = false;
                lastAiSpokeTime = 0;
                if (navigator.vibrate) navigator.vibrate(20);
                updateDockControls();
                updateCameraBadge(false, '待命中 (說話時自動發送)');
                updateCardStatus('listening', '🎙️ 3D-Speaker 聲紋驗證通過 · 聆聽中');
              }
            }
          }).catch(() => {});
        }

        if (tuningDrawer && !tuningDrawer.classList.contains('hidden')) {
          const rmsVal = document.getElementById('live-meter-rms-val');
          const rmsBar = document.getElementById('live-meter-rms-bar');
          if (rmsVal) rmsVal.textContent = rms.toFixed(3);
          if (rmsBar) rmsBar.style.width = `${Math.min(100, Math.round((rms / 0.08) * 100))}%`;
        }

        const isAiSpeaking = isAiResponding || (audioPlayer && audioPlayer.activeSources.length > 0);
        const inAiCooldown = (Date.now() - lastAiSpokeTime) < 350;

        // When AI is actively speaking and not yet barge-in verified, discard input to avoid self-echo
        if (isAiSpeaking || inAiCooldown) {
          if (!userVoiceprintProfile) {
            // Near-field threshold fallback
            if (rms > (TUNING_CONFIG.RMS_THRESHOLD * 2.2)) {
              bargeInSpeechCount++;
              if (bargeInSpeechCount >= (TUNING_CONFIG.BARGEIN_FRAMES + 2)) {
                if (audioPlayer) audioPlayer.stopAll();
                isAiResponding = false;
                lastAiSpokeTime = 0;
                bargeInSpeechCount = 0;
                if (navigator.vibrate) navigator.vibrate(20);
                updateDockControls();
                updateCameraBadge(false, '待命中 (說話時自動發送)');
                updateCardStatus('listening', '🎙️ 已插話打斷 · 聆聽中');
              }
            }
          }
          audioSendBuffer = [];
          return;
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

        // Continuous streaming buffer with selective bystander mute
        const isBystander = userVoiceprintProfile && (rms > TUNING_CONFIG.RMS_THRESHOLD) && (currentSpeechSimilarity < TUNING_CONFIG.SIMILARITY_THRESHOLD);

        for (let i = 0; i < downsampled.length; i++) {
          audioSendBuffer.push(isBystander ? 0 : downsampled[i]);
        }

        // Send every ~40ms (640 samples at 16kHz) to keep VAD boundaries and
        // short Mandarin consonants from being hidden in a large chunk.
        if (audioSendBuffer.length >= 640) {
          while (audioSendBuffer.length >= 640 && isLiveSetupReady && ws && ws.readyState === WebSocket.OPEN) {
            sendLiveAudioChunk(new Float32Array(audioSendBuffer.splice(0, 640)));
          }
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
  const CALL_MEMO_PLACEHOLDERS = new Set([
    '🗣️（使用者語音）',
    '🎙️（Gemini 語音回覆）',
    '🗣️ (您的語音提問)',
    '🎙️ (AI 語音回覆)',
    '🗣️ (雙向語音通話)',
    '🎙️ (AI 即時語音回覆)'
  ]);

  function hasSubstantiveCallContent(turns) {
    return (Array.isArray(turns) ? turns : []).some(t => {
      if (!t || t.speaker === 'system') return false;
      const isUserSpeaker = t.speaker === 'user' || t.role === 'user' || Boolean(t.user);
      const text = String(t.user || t.model || (isUserSpeaker ? t.text : t.text) || '').trim();
      return Boolean(text) && !CALL_MEMO_PLACEHOLDERS.has(text);
    });
  }

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

    // 2. Build Visual Snapshots Gallery (if camera was used)
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
    let turnsToSave = [];
    let toolsToSave = [];
    let snapshotsToSave = [];
    let durationSec = 0;
    let voiceName = 'Gemini';
    let durationText = '0 秒';
    let memoId = null;
    let activeConvId = null;
    let activeProvider = 'antigravity';
    let initialSummary = [];
    let shouldSaveMemo = false;
    try {
      console.log('[Live] endLiveSession initiated...');

      // Render first: teardown must never prevent the user-visible memo.
      turnsToSave = sessionDialogueTurns.slice();
      const hasPendingTextTurn = currentTurnUser || (currentTurnModel && currentTurnModel !== '🎙️ (AI 即時語音回覆)');
      if (hasPendingTextTurn) {
        turnsToSave.push({
          user: currentTurnUser || '🗣️ (雙向語音通話)',
          model: currentTurnModel || '🎙️ (AI 即時語音回覆)'
        });
      }
      toolsToSave = sessionExecutedTools.slice();
      snapshotsToSave = sessionSnapshots.slice();
      shouldSaveMemo = hasSubstantiveCallContent(turnsToSave);
      durationSec = liveCallStartTs > 0 ? Math.max(1, Math.round((Date.now() - liveCallStartTs) / 1000)) : 1;
      voiceName = getSelectedVoice();
      const earlyMins = Math.floor(durationSec / 60);
      const earlySecs = durationSec % 60;
      durationText = earlyMins > 0 ? `${earlyMins} 分 ${earlySecs} 秒` : `${earlySecs} 秒`;
      memoId = `call-memo-${Date.now()}`;
      initialSummary = [];
      // Empty calls are cleaned up but do not create a memo or history entry.
      if (shouldSaveMemo) {
        try {
          const earlyCard = buildCallSummaryCardHtml(turnsToSave, durationSec, voiceName, snapshotsToSave, memoId, initialSummary);
          const earlyContainer = document.getElementById('messages-container');
          if (earlyContainer && earlyCard) {
            earlyContainer.appendChild(earlyCard);
            earlyContainer.scrollTop = earlyContainer.scrollHeight;
          }
          if (typeof scrollToBottom === 'function') scrollToBottom(true);
        } catch (cardErr) {
          console.error('[Live Memo Render Error]', cardErr);
        }
      }

      isConnected = false;
      isLiveSetupReady = false;
      preSetupAudioBuffer = [];
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
        try { audioPlayer.stopAll(); } catch (e) {}
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
        try { micMediaStream.getTracks().forEach(t => t.stop()); } catch (e) {}
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

      if (typeof window.haptic === 'function') {
        try { window.haptic('heavy'); } catch (e) {}
      }

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

      try { setMediaSessionActive(false); } catch (e) {}

      // 🧹 1. Cleanly remove the in-call Live card from screen
      removeInlineCard();

      // 🔒 Extract dialogue turns and full audio
      sessionExecutedTools = [];
      sessionDialogueTurns = [];
      sessionSnapshots = [];
      currentTurnUser = '';
      currentTurnInputTranscript = '';
      currentTurnModel = '';

      activeConvId = (typeof currentConversationId !== 'undefined' && currentConversationId) ? currentConversationId : null;
      activeProvider = (typeof currentProvider !== 'undefined' && currentProvider)
        ? currentProvider
        : (localStorage.getItem('crew_current_provider') || 'antigravity');
      const userText = turnsToSave.map(t => t.user || '').filter(Boolean).join('；') || `🗣️ 雙向語音通話 (${durationText})`;
      const modelText = turnsToSave.map(t => t.model || '').filter(Boolean).join('\n') || `✨ Gemini Live 雙向語音通話完成 (音色：${voiceName} · 時長：${durationText})`;

      // 💾 3. Sync substantive dialogue to database/transcript
      if (shouldSaveMemo) fetch('/api/live-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: activeConvId,
          provider: activeProvider,
          user_message: userText,
          assistant_message: modelText,
          call_memo: {
            duration_sec: durationSec,
            voice_name: voiceName,
            summary: initialSummary,
            transcript: turnsToSave,
            tools: toolsToSave
          }
        })
      }).then(res => res.json()).then(data => {
        if (data.success && data.conversation_id && (typeof currentConversationId !== 'undefined' && !currentConversationId)) {
          currentConversationId = data.conversation_id;
          localStorage.setItem('agy_active_conv_id', data.conversation_id);
        }
        if (typeof window.loadConversations === 'function') window.loadConversations();
      }).catch(e => console.warn('[Live Sync Fetch Failed]', e));
    } catch (fatalErr) {
      console.error('[Live endLiveSession Fatal Error]', fatalErr);
      // Teardown fallback: even if one cleanup operation fails, restore the
      // normal input UI and release the connection state.
      isConnected = false;
      isLiveSetupReady = false;
      preSetupAudioBuffer = [];
      const fallbackDock = document.getElementById('live-bottom-dock');
      const fallbackInput = document.getElementById('standard-input-bar');
      if (fallbackDock) {
        fallbackDock.classList.add('hidden');
        fallbackDock.classList.remove('flex');
      }
      if (fallbackInput) fallbackInput.classList.remove('hidden');
      try { removeInlineCard(); } catch (_) {}
    }
  }

  // Expose the close path for the red hangup control and any re-rendered dock.
  window.endLiveSession = endLiveSession;
  window.startDiscussionLive = () => startLiveSession('discussion');
  window.isLiveSessionActive = () => Boolean(isConnected || (ws && ws.readyState !== WebSocket.CLOSED));

  // Key Modal Handlers
  function showKeyModal() {
    if (liveApiKeyInput) liveApiKeyInput.value = getApiKey();
    if (liveModelSelect) liveModelSelect.value = getSelectedModel();
    if (liveVoiceSelect) liveVoiceSelect.value = getSelectedVoice();
    if (livePromptInput) livePromptInput.value = getLivePrompt();
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

  if (liveSettingsBtn) {
    liveSettingsBtn.addEventListener('click', () => {
      if (!isConnected) showKeyModal();
    });
  }

  if (liveSaveKeyBtn) {
    liveSaveKeyBtn.addEventListener('click', () => {
      const key = liveApiKeyInput ? liveApiKeyInput.value.trim() : '';
      const model = liveModelSelect ? liveModelSelect.value : DEFAULT_MODEL;
      const voice = liveVoiceSelect ? liveVoiceSelect.value : DEFAULT_VOICE;
      const prompt = livePromptInput ? livePromptInput.value.trim() : '';
      if (key) {
        localStorage.setItem(STORAGE_KEY, key);
        localStorage.setItem(MODEL_KEY, model);
        localStorage.setItem(VOICE_KEY, voice);
        if (prompt) localStorage.setItem(PROMPT_KEY, prompt);
        else localStorage.removeItem(PROMPT_KEY);
        hideKeyModal();
        startLiveSession(liveSessionMode);
      } else {
        localStorage.removeItem(STORAGE_KEY);
        hideKeyModal();
      }
    });
  }

  if (liveVoiceSelect) {
    populateVoiceSelect(liveVoiceSelect, getSelectedVoice());
    liveVoiceSelect.value = getSelectedVoice();
    liveVoiceSelect.addEventListener('change', () => {
      localStorage.setItem(VOICE_KEY, liveVoiceSelect.value);
    });
  }

  if (liveVoicePreviewBtn) {
    liveVoicePreviewBtn.addEventListener('click', previewSelectedVoice);
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
