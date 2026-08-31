/**
 * 🎙️ Crew Pocket - Option A: Pure Inline Live Voice Card (No Distracting Background Sync)
 * Direct Real-Time Multimodal Communication in Dedicated Live Card UI.
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'crew_pocket_gemini_api_key';
  const VOICE_KEY = 'crew_pocket_live_voice';
  const VOLUME_KEY = 'crew_pocket_live_volume';
  const RESPONSE_PACE_KEY = 'crew_pocket_live_response_pace';
  const INTERRUPTION_MODE_KEY = 'crew_pocket_live_interruption_mode';
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
  let currentTurnOutputTranscript = '';
  let currentTurnModel = '';
  let currentTurnHadAudio = false;
  let lastUserSpokeTime = 0;
  let lastVideoFrameSentTime = 0;
  let isCameraExpanded = false;
  let liveCallStartTs = 0;
  // Video sessions have a shorter upstream limit. Start that clock only when
  // the camera opens, never from the beginning of the audio call.
  let cameraModeStartTs = 0;
  let isAiResponding = false;
  let isModelTurnComplete = true;
  let liveCardExpanded = false;
  let liveCardVisible = true;
  let hasSentFrameForCurrentTurn = false;
  let lastAiSpokeTime = 0;
  let sustainedSpeechCount = 0;
  let userSpeechActive = false;
  let cameraFrameSequence = 0;
  let sessionSnapshots = [];
  let latestLiveCameraSnapshot = null;
  let sessionExecutedTools = [];
  let pendingMainTask = null;
  let pendingMainTaskTimer = null;
  let mainTaskPollTimer = null;
  const MAIN_TASK_CONFIRM_TTL_MS = 60000;
  let isGoAwayClosing = false;
  let callProtectionTimer = null;
  let callProtectionWarned = false;
  // Live API can surface the same function call in both toolCall and
  // serverContent.parts. Keep tool execution serialized and de-duplicated so
  // a tool response cannot race the audio stream or get sent twice.
  let liveToolQueue = Promise.resolve();
  let liveToolCallKeys = new Set();
  let liveSessionMode = 'operation';
  let liveHealthTimer = null;
  let lastLiveHealthIssue = null;
  const LIVE_PHASE = Object.freeze({
    IDLE: 'idle',
    CONNECTING: 'connecting',
    LISTENING: 'listening',
    VERIFYING: 'verifying',
    SPEAKING: 'speaking',
    DRAINING: 'draining',
    COOLDOWN: 'cooldown'
  });
  let livePhase = LIVE_PHASE.IDLE;
  let voicePreviewSource = null;
  let mediaVolumeUpdateTimer = null;
  let mediaVolumeRequestSequence = 0;
  const voicePreviewCache = new Map();
  let lastVoicePreviewAt = 0;
  const AI_ECHO_GUARD_MS = 300;
  // Keep a whole opening phrase locally until its speaker is verified.  This
  // is deliberately longer than one embedding window so a verified user never
  // loses their first syllables while an unverified speaker never leaks a
  // partial command to Live.
  const VOICEPRINT_PENDING_MAX_SAMPLES = 48000; // 3s safety cap at 16 kHz
  const VOICEPRINT_SEGMENT_GAP_MS = 450;

  // DOM References
  const liveVoiceBtn = document.getElementById('live-voice-btn');
  const liveSettingsBtn = document.getElementById('live-settings-btn');
  const liveKeyModal = document.getElementById('live-key-modal');
  const liveApiKeyInput = document.getElementById('live-api-key-input');
  const liveApiKeyHint = document.getElementById('live-api-key-hint');
  const liveModelSelect = document.getElementById('live-model-select');
  const liveVoiceSelect = document.getElementById('live-voice-select');
  const liveVoicePreviewBtn = document.getElementById('live-voice-preview-btn');
  const liveVoicePreviewStatus = document.getElementById('live-voice-preview-status');
  const liveResponsePaceSelect = document.getElementById('live-response-pace-select');
  const liveInterruptionSelect = document.getElementById('live-interruption-select');
  const livePromptInput = document.getElementById('live-prompt-input');
  const liveSaveKeyBtn = document.getElementById('live-save-key-btn');
  const liveCloseKeyBtn = document.getElementById('live-close-key-btn');
  const liveSettingsSessionNote = document.getElementById('live-settings-session-note');
  const liveSettingsSummaryVoice = document.getElementById('live-settings-summary-voice');
  const liveSettingsSummaryPace = document.getElementById('live-settings-summary-pace');
  const liveSettingsSummaryInterruption = document.getElementById('live-settings-summary-interruption');
  const liveSettingsAdvanced = document.getElementById('live-settings-advanced');
  const messagesContainer = document.getElementById('messages-container');

  // ==========================================
  // 🔊 Gapless duplex AudioWorklet (single HTML5 media output path)
  // ==========================================
  class LiveAudioPlayer {
    constructor(ctx) {
      this.ctx = ctx;
      this.stopped = false;
      this.isPlaying = false;
      this.micFrameHandler = null;
      this.node = new AudioWorkletNode(ctx, 'crew-live-audio', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1]
      });
      this.node.port.onmessage = (event) => {
        const message = event.data || {};
        if (message.type === 'mic-frame' && this.micFrameHandler) {
          this.micFrameHandler({
            samples: new Float32Array(message.samples),
            rms: Number(message.rms) || 0
          });
        } else if (message.type === 'output-started') {
          this.isPlaying = true;
        } else if (message.type === 'output-drained') {
          const wasPlaying = this.isPlaying;
          this.isPlaying = false;
          if (wasPlaying && isConnected && isModelTurnComplete) {
            scheduleMicReopenAfterPlayback();
          }
        }
      };

      // Keep the proven AudioWorklet queue, but send it straight to the
      // device output. CrewHelper remains responsible for media volume.
      this.outputGain = this.ctx.createGain();
      this.outputGain.gain.value = 1;
      this.node.connect(this.outputGain);
      this.outputGain.connect(this.ctx.destination);
    }

    get activeSources() {
      return this.isPlaying ? [true] : [];
    }

    connectMic(source) {
      source.connect(this.node);
    }

    setMicFrameHandler(handler) {
      this.micFrameHandler = typeof handler === 'function' ? handler : null;
    }

    setCaptureEnabled(enabled) {
      if (this.node) this.node.port.postMessage({ type: 'capture', enabled: Boolean(enabled) });
    }

    markTurnComplete() {
      if (this.node) this.node.port.postMessage({ type: 'turn-complete' });
    }

    playChunk(float32Array, sampleRate = 24000) {
      if (!float32Array || float32Array.length === 0) return;
      this.stopped = false;
      this.isPlaying = true;
      // Keep low-cost capture active only when a local owner voiceprint can
      // safely authorize spoken barge-in. Without a profile, interruption
      // remains an explicit button action.
      this.setCaptureEnabled(canOwnerAutoInterrupt() && !isMuted);
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(err => console.warn('[Live Audio] AudioContext resume failed:', err.message));
      }
      const samples = float32Array instanceof Float32Array ? float32Array : new Float32Array(float32Array);
      this.node.port.postMessage({ type: 'output', samples: samples.buffer, sampleRate }, [samples.buffer]);
    }

    stopAll() {
      // Interrupt only the currently queued speech; keep direct device output
      // and microphone capture alive for the next Gemini turn.
      this.stopped = false;
      this.isPlaying = false;
      if (this.node) this.node.port.postMessage({ type: 'clear-output' });
    }

    destroy() {
      this.stopped = true;
      this.isPlaying = false;
      this.micFrameHandler = null;
      if (this.node) {
        try { this.node.port.postMessage({ type: 'clear-output' }); } catch (e) {}
        try { this.node.disconnect(); } catch (e) {}
        this.node = null;
      }
      if (this.outputGain) {
        try { this.outputGain.disconnect(); } catch (e) {}
        this.outputGain = null;
      }
    }
  }

  function scheduleMicReopenAfterPlayback() {
    lastAiSpokeTime = Date.now();
    livePhase = LIVE_PHASE.COOLDOWN;
    setTimeout(() => {
      const playbackEmpty = !audioPlayer || audioPlayer.activeSources.length === 0;
      if (!playbackEmpty || !isConnected || !isModelTurnComplete) return;
      isAiResponding = false;
      livePhase = LIVE_PHASE.LISTENING;
      if (audioPlayer) audioPlayer.setCaptureEnabled(!isMuted);
      hasSentFrameForCurrentTurn = false;
      updateDockControls();
      updateCameraBadge(false, '待命中（AI 需要時才擷取）');
      if (isMuted) {
        updateCardStatus('muted', '🔇 麥克風已靜音');
      } else {
        updateCardStatus('listening', '🎙️ 可以開始說話');
      }
    }, AI_ECHO_GUARD_MS);
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
  const legacyVoiceprintDisabled = localStorage.getItem('crew_voiceprint_enabled') === '0';
  let isCalibratingVoiceprint = false;
  let voiceprintCalibrationSamples = [];
  let voiceprintWorker = null;
  let voiceprintWorkerReady = false;
  let voiceprintWorkerInitPromise = null;
  let voiceprintRequestSequence = 0;
  const voiceprintRequests = new Map();

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

  function isVoiceprintActive() {
    return TUNING_CONFIG.SIMILARITY_THRESHOLD > 0 && Boolean(userVoiceprintProfile);
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
    if (voiceprintWorkerReady && voiceprintWorker) return voiceprintWorker;
    if (voiceprintWorkerInitPromise) return voiceprintWorkerInitPromise;

    voiceprintWorkerInitPromise = new Promise((resolve, reject) => {
      try {
        voiceprintWorker = new Worker('/js/voiceprint-worker.js?v=1787857600');
        voiceprintWorker.onmessage = (event) => {
          const message = event.data || {};
          if (message.type === 'ready') {
            voiceprintWorkerReady = true;
            console.log('✅ [Voiceprint Worker] 3D-Speaker CAM++ ready');
            resolve(voiceprintWorker);
            return;
          }
          if (message.type === 'error' && !message.id) {
            voiceprintWorkerReady = false;
            voiceprintWorkerInitPromise = null;
            reject(new Error(message.message || '聲紋 Worker 初始化失敗'));
            return;
          }
          if ((message.type === 'result' || message.type === 'error') && message.id) {
            const pending = voiceprintRequests.get(message.id);
            if (!pending) return;
            voiceprintRequests.delete(message.id);
            clearTimeout(pending.timer);
            if (message.type === 'result') {
              pending.resolve(new Float32Array(message.embedding));
            } else {
              pending.reject(new Error(message.message || '聲紋推論失敗'));
            }
          }
        };
        voiceprintWorker.onerror = (event) => {
          const error = new Error(event.message || '聲紋 Worker 啟動失敗');
          voiceprintWorkerReady = false;
          voiceprintWorkerInitPromise = null;
          for (const pending of voiceprintRequests.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
          }
          voiceprintRequests.clear();
          reject(error);
        };
        voiceprintWorker.postMessage({ type: 'init' });
      } catch (error) {
        voiceprintWorkerInitPromise = null;
        reject(error);
      }
    });
    return voiceprintWorkerInitPromise;
  }

  function releaseVoiceprintWorker() {
    for (const pending of voiceprintRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('聲紋引擎已釋放'));
    }
    voiceprintRequests.clear();
    if (voiceprintWorker) {
      try { voiceprintWorker.terminate(); } catch (_) {}
    }
    voiceprintWorker = null;
    voiceprintWorkerReady = false;
    voiceprintWorkerInitPromise = null;
  }

  async function computeSpeakerEmbedding(audioSamples) {
    if (!audioSamples || audioSamples.length < 3200) {
      throw new Error(`錄音樣本數不足 (${audioSamples ? audioSamples.length : 0} 點)`);
    }
    await initVoiceprintEngine();
    const requestId = `vp-${Date.now()}-${++voiceprintRequestSequence}`;
    const samples = audioSamples instanceof Float32Array ? audioSamples : new Float32Array(audioSamples);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        voiceprintRequests.delete(requestId);
        reject(new Error('聲紋判定逾時'));
      }, 3000);
      voiceprintRequests.set(requestId, { resolve, reject, timer });
      voiceprintWorker.postMessage({ type: 'embed', id: requestId, samples: samples.buffer }, [samples.buffer]);
    });
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
  const storedSimilarityThreshold = Number.parseFloat(localStorage.getItem('crew_live_similarity_threshold'));
  const TUNING_CONFIG = {
    SIMILARITY_THRESHOLD: legacyVoiceprintDisabled
      ? 0
      : (Number.isFinite(storedSimilarityThreshold)
        ? Math.max(0, Math.min(0.88, storedSimilarityThreshold))
        : 0.25),
    RMS_THRESHOLD: parseFloat(localStorage.getItem('crew_live_rms_threshold')) || 0.028,
    GAIN_BOOST: parseFloat(localStorage.getItem('crew_live_gain_boost')) || 1.4,
    save() {
      localStorage.setItem('crew_live_similarity_threshold', this.SIMILARITY_THRESHOLD);
      localStorage.removeItem('crew_voiceprint_enabled');
      localStorage.setItem('crew_live_rms_threshold', this.RMS_THRESHOLD);
      localStorage.setItem('crew_live_gain_boost', this.GAIN_BOOST);
    },
    reset() {
      this.SIMILARITY_THRESHOLD = 0.25;
      this.RMS_THRESHOLD = 0.028;
      this.GAIN_BOOST = 1.4;
      this.save();
    }
  };

  function getVoiceprintThresholdLabel(value = TUNING_CONFIG.SIMILARITY_THRESHOLD) {
    if (value <= 0) return '關閉';
    if (value <= 0.25) return `${value.toFixed(2)} · 日常建議`;
    if (value <= 0.35) return `${value.toFixed(2)} · 嚴格`;
    if (value <= 0.50) return `${value.toFixed(2)} · 很嚴格`;
    return `${value.toFixed(2)} · 極嚴格`;
  }

  function updateVoiceprintThresholdUI() {
    const slider = document.getElementById('live-voiceprint-threshold');
    const label = document.getElementById('live-voiceprint-threshold-label');
    const hint = document.getElementById('live-voiceprint-threshold-hint');
    const value = TUNING_CONFIG.SIMILARITY_THRESHOLD;
    if (slider) slider.value = value;
    if (label) label.textContent = getVoiceprintThresholdLabel(value);
    if (hint) hint.textContent = value <= 0
      ? '🎙️ 關閉：略過聲紋 Worker，任何語音直接送入 Live'
      : `🛡️ 門檻 ${value.toFixed(2)}：聲紋資料 100% 本地處理`;
  }

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
    if (liveVpText) liveVpText.textContent = isVoiceprintActive() ? '🧬 聲紋已鎖' : (userVoiceprintProfile ? '🧬 聲紋關閉' : '🧬 校準聲紋');
    if (liveVpDot) liveVpDot.className = isVoiceprintActive() ? 'w-1.5 h-1.5 rounded-full bg-teal-400' : 'w-1.5 h-1.5 rounded-full bg-slate-500';
  }

  function openVoiceprintModal() {
    if (!voiceprintModal) return;
    // Voiceprint Studio is a child setting flow; never leave the parent
    // Live settings modal stacked underneath it.
    hideKeyModal();
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
    liveCardExpanded = false;
    liveCardVisible = true;

    const selectedVoice = getSelectedVoice();
    const selectedVolume = getLiveVolumePercent();

    const card = document.createElement('div');
    card.id = 'live-inline-card';
    card.className = 'fixed left-2 right-2 top-[60px] z-40 flex justify-center transition-all duration-300 animate-fadeIn pointer-events-none';
    
    card.innerHTML = `
      <div class="bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 border border-teal-500/50 rounded-2xl p-2 sm:p-2.5 text-xs sm:text-sm shadow-2xl shadow-teal-950/50 w-full max-w-2xl min-w-0 space-y-1.5 relative max-h-[62dvh] overflow-y-auto overscroll-contain pointer-events-auto">
        
        <!-- Compact call HUD: status and the latest line stay visible; details are opt-in. -->
        <div class="flex items-center justify-between gap-1.5 min-w-0">
          <div class="flex items-center gap-1.5 min-w-0">
            ${liveSessionMode === 'discussion' ? '<span class="px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[10px] font-bold shrink-0">🗣️ 討論</span>' : ''}
            <span id="live-card-status-dot" class="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0"></span>
            <span id="live-card-status-text" class="text-amber-300 font-bold text-xs font-mono truncate">⚡ 準備中...</span>
          </div>
          
          <div class="flex items-center gap-1.5 shrink-0">
            <div class="h-7 w-16 sm:w-24 rounded-lg border border-slate-800 bg-black/45 px-1" title="即時聲音波形">
              <canvas id="live-card-canvas" width="120" height="28" class="w-full h-full"></canvas>
            </div>
            <span id="live-card-camera-state" class="hidden rounded-full border border-indigo-500/40 bg-indigo-950/80 px-2 py-1 text-[10px] font-mono text-indigo-300">📷 相機</span>
            <button id="live-card-expand-toggle-btn" type="button" class="min-w-[40px] min-h-[40px] rounded-xl bg-indigo-950/80 hover:bg-indigo-900 active:scale-95 border border-indigo-500/40 text-indigo-300 text-sm flex items-center justify-center transition shadow-sm cursor-pointer" title="展開通話資訊">⌃</button>
          </div>
        </div>

        <div class="flex items-center gap-2 min-w-0">
          <div id="live-card-latest-line" class="min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-950/65 px-2.5 py-2 text-[11px] text-slate-400 truncate">💬 請說話…</div>
          <div id="live-call-protection-status" class="shrink-0 max-w-[42%] truncate rounded-xl border border-slate-800 bg-slate-950/70 px-2 py-2 text-[10px] font-mono text-slate-400" title="長通話保護">🛡️ 待命</div>
        </div>

        <div id="live-main-task-card" class="hidden rounded-xl border border-amber-500/45 bg-amber-950/25 p-2.5 space-y-2">
          <div class="flex items-center justify-between gap-2">
            <span id="live-main-task-title" class="text-[11px] font-bold text-amber-300">📨 待交辦主對話</span>
            <span id="live-main-task-expiry" class="text-[10px] font-mono text-amber-400/80">60 秒內確認</span>
          </div>
          <p id="live-main-task-text" class="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-200"></p>
          <div class="flex gap-2">
            <button id="live-main-task-cancel-btn" type="button" class="flex-1 min-h-[40px] rounded-lg border border-slate-700 bg-slate-900 text-[11px] font-semibold text-slate-300 active:scale-95">取消</button>
            <button id="live-main-task-confirm-btn" type="button" class="flex-1 min-h-[40px] rounded-lg border border-amber-400/60 bg-amber-500/20 text-[11px] font-bold text-amber-200 active:scale-95">Confirm</button>
          </div>
        </div>

        <div id="live-card-details" class="hidden space-y-2">

        <!-- 📷 CAMERA EXPANSION VIEW (相機展開區) -->
        <div id="live-card-camera-box" class="hidden transition-all duration-300 overflow-hidden rounded-xl border border-indigo-500/40 bg-slate-950 relative">
          <video id="live-card-video" autoplay playsinline muted class="w-full max-h-52 object-contain bg-black rounded-lg transition-all duration-300"></video>
          
          <!-- Top Badge (智慧節流指示燈) -->
          <div id="live-card-camera-badge" class="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/80 border border-slate-700 text-[10px] text-slate-300 font-mono flex items-center gap-1 shadow-md pointer-events-none">
            <span id="live-camera-badge-dot" class="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
            <span id="live-camera-badge-text">待命中（AI 需要時才擷取）</span>
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

        <!-- Shared tab panel: only one diagnostic/control view is visible at a time. -->
        <div id="live-card-tools-panel" class="rounded-xl bg-slate-950/90 border border-teal-500/40 overflow-hidden text-xs select-none">
          <div class="grid grid-cols-2 gap-1 p-1 bg-slate-900/80 border-b border-slate-800">
            <button id="live-tools-audio-tab" type="button" class="min-h-[40px] rounded-lg bg-teal-500/20 border border-teal-500/35 text-teal-200 text-[11px] font-bold active:scale-95 transition">🔊 音訊調整</button>
            <button id="live-tools-health-tab" type="button" class="min-h-[40px] rounded-lg border border-transparent text-slate-400 hover:text-emerald-200 hover:bg-emerald-500/10 text-[11px] font-bold active:scale-95 transition">🩺 通話健康</button>
          </div>

          <div id="live-card-health-drawer" class="hidden p-2.5 space-y-2 text-[10px] font-mono">
            <div class="flex items-center justify-between gap-2"><span class="font-bold text-emerald-300">連線狀態</span><span id="live-health-phase" class="text-slate-400">待初始化</span></div>
            <div class="grid grid-cols-2 gap-1.5">
              <div class="rounded-lg bg-slate-900/80 border border-slate-800 px-2 py-1.5"><span class="block text-slate-500">WebSocket</span><span id="live-health-connection" class="text-slate-300">未建立</span></div>
              <div class="rounded-lg bg-slate-900/80 border border-slate-800 px-2 py-1.5"><span class="block text-slate-500">麥克風</span><span id="live-health-mic" class="text-slate-300">未開啟</span></div>
              <div class="rounded-lg bg-slate-900/80 border border-slate-800 px-2 py-1.5"><span class="block text-slate-500">AI 音訊</span><span id="live-health-playback" class="text-slate-300">等待中</span></div>
              <div class="rounded-lg bg-slate-900/80 border border-slate-800 px-2 py-1.5"><span class="block text-slate-500">聲紋</span><span id="live-health-voiceprint" class="text-slate-300">未啟用</span></div>
            </div>
            <div class="rounded-lg border border-slate-800 bg-black/35 px-2 py-1.5"><span class="text-slate-500">最近異常：</span><span id="live-health-issue" class="text-slate-400">尚無</span></div>
          </div>

          <div id="live-card-tuning-drawer" class="p-2.5 space-y-2 transition-all">
          <div class="rounded-xl border border-slate-800 bg-slate-900/70 px-2.5 py-2" title="調整 Android 系統媒體音量">
            <div class="mb-1 flex items-center justify-between text-[10px]"><span class="text-slate-300">🔈 媒體音量</span><span id="live-card-volume-value" class="font-mono text-teal-300">${selectedVolume}%</span></div>
            <input id="live-card-volume-slider" type="range" min="0" max="100" step="1" value="${selectedVolume}" class="w-full h-8 accent-teal-400 cursor-pointer" aria-label="媒體音量">
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
              <input id="live-tuning-sim-slider" type="range" min="0" max="0.88" step="0.01" value="${TUNING_CONFIG.SIMILARITY_THRESHOLD}" class="w-full h-8 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-teal-400" aria-label="聲紋匹配門檻">
              <div class="flex justify-between text-[9px] text-slate-500 font-mono mt-0.5">
                <span>0 (關閉)</span>
                <span>0.25 (建議)</span>
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
              <input id="live-tuning-rms-slider" type="range" min="0.015" max="0.060" step="0.002" value="${TUNING_CONFIG.RMS_THRESHOLD}" class="w-full h-8 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-teal-400" aria-label="插話音量門檻">
              <div class="flex justify-between text-[9px] text-slate-500 font-mono mt-0.5">
                <span>0.015 (輕聲)</span>
                <span>0.028 (建議)</span>
                <span>0.060 (大聲)</span>
              </div>
            </div>

          </div>
        </div>
        </div>

        <!-- Real-time Dialogue Subtitles (純 Live 對話區) -->
        <div id="live-card-transcript" class="space-y-1.5 text-xs max-h-48 overflow-y-auto pr-1"></div>

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

    // Mount at the document root so the fixed panel is never clipped by the
    // chat area's overflow scrolling container.
    document.body.appendChild(card);

    // Attach Inline Controls
    const cardMuteBtn = card.querySelector('#live-card-mute-btn');
    if (cardMuteBtn) cardMuteBtn.addEventListener('click', toggleMute);
    const cardCameraBtn = card.querySelector('#live-card-camera-btn');
    const expandToggleBtn = card.querySelector('#live-card-expand-toggle-btn');
    const details = card.querySelector('#live-card-details');
    const setExpanded = (expanded) => {
      liveCardExpanded = expanded;
      if (details) details.classList.toggle('hidden', !expanded);
      if (expandToggleBtn) {
        expandToggleBtn.textContent = expanded ? '⌄' : '⌃';
        expandToggleBtn.title = expanded ? '收合通話面板' : '展開通話面板';
      }
      card.dataset.expanded = expanded ? 'true' : 'false';
      updateDockControls();
    };
    if (expandToggleBtn) expandToggleBtn.addEventListener('click', () => setExpanded(!liveCardExpanded));
    card.addEventListener('crew:toggle-expanded', () => setExpanded(!liveCardExpanded));

    if (cardCameraBtn) cardCameraBtn.addEventListener('click', () => { setExpanded(true); toggleCamera(); });
    const cardHangupBtn = card.querySelector('#live-card-hangup-btn');
    if (cardHangupBtn) cardHangupBtn.addEventListener('click', endLiveSession);
    const healthDrawer = card.querySelector('#live-card-health-drawer');
    updateCardCallControls();
    startLiveHealthMonitor();

    const tuningDrawer = card.querySelector('#live-card-tuning-drawer');
    const audioTab = card.querySelector('#live-tools-audio-tab');
    const healthTab = card.querySelector('#live-tools-health-tab');
    let activeToolsTab = 'audio';
    const setToolsTab = (tab) => {
      const drawer = tab === 'audio' ? tuningDrawer : healthDrawer;
      const isAlreadyVisible = activeToolsTab === tab && drawer && !drawer.classList.contains('hidden');
      if (isAlreadyVisible) {
        activeToolsTab = null;
        if (tuningDrawer) tuningDrawer.classList.add('hidden');
        if (healthDrawer) healthDrawer.classList.add('hidden');
      } else {
        activeToolsTab = tab;
        if (tuningDrawer) tuningDrawer.classList.toggle('hidden', tab !== 'audio');
        if (healthDrawer) healthDrawer.classList.toggle('hidden', tab !== 'health');
      }
      const showAudio = activeToolsTab === 'audio';
      const showHealth = activeToolsTab === 'health';
      if (audioTab) audioTab.className = showAudio
        ? 'min-h-[40px] rounded-lg bg-teal-500/20 border border-teal-500/35 text-teal-200 text-[11px] font-bold active:scale-95 transition'
        : 'min-h-[40px] rounded-lg border border-transparent text-slate-400 hover:text-teal-200 hover:bg-teal-500/10 text-[11px] font-bold active:scale-95 transition';
      if (healthTab) healthTab.className = showHealth
        ? 'min-h-[40px] rounded-lg bg-emerald-500/15 border border-emerald-500/35 text-emerald-200 text-[11px] font-bold active:scale-95 transition'
        : 'min-h-[40px] rounded-lg border border-transparent text-slate-400 hover:text-emerald-200 hover:bg-emerald-500/10 text-[11px] font-bold active:scale-95 transition';
      if (showHealth) updateLiveHealthPanel();
    };
    if (audioTab) audioTab.addEventListener('click', () => setToolsTab('audio'));
    if (healthTab) healthTab.addEventListener('click', () => setToolsTab('health'));

    // Slider 1: Sim Slider
    const simSlider = card.querySelector('#live-tuning-sim-slider');
    const simLabel = card.querySelector('#live-tuning-sim-label');
    if (simSlider && simLabel) {
      simSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        TUNING_CONFIG.SIMILARITY_THRESHOLD = val;
        simLabel.textContent = val.toFixed(2);
        TUNING_CONFIG.save();
        updateVoiceprintThresholdUI();
        updateVoiceprintModalUI();
        updateLiveHealthPanel();
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

    // Reset Button
    const resetBtn = card.querySelector('#live-tuning-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        TUNING_CONFIG.reset();
        if (simSlider) simSlider.value = TUNING_CONFIG.SIMILARITY_THRESHOLD;
        if (simLabel) simLabel.textContent = TUNING_CONFIG.SIMILARITY_THRESHOLD.toFixed(2);
        updateVoiceprintThresholdUI();
        updateVoiceprintModalUI();
        if (rmsSlider) rmsSlider.value = TUNING_CONFIG.RMS_THRESHOLD;
        if (rmsLabel) rmsLabel.textContent = TUNING_CONFIG.RMS_THRESHOLD.toFixed(3);
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

    const cardVolumeSlider = card.querySelector('#live-card-volume-slider');
    if (cardVolumeSlider) {
      cardVolumeSlider.addEventListener('input', () => applyLiveVolume(cardVolumeSlider.value));
      cardVolumeSlider.addEventListener('change', () => applyLiveVolume(cardVolumeSlider.value, true));
      syncSystemMediaVolume();
    }

    const taskConfirmBtn = card.querySelector('#live-main-task-confirm-btn');
    const taskCancelBtn = card.querySelector('#live-main-task-cancel-btn');
    if (taskConfirmBtn) taskConfirmBtn.addEventListener('click', requestMainTaskConfirmation);
    if (taskCancelBtn) taskCancelBtn.addEventListener('click', () => clearPendingMainTask('已取消待交辦任務。'));

    const snapBtn = card.querySelector('#live-card-snap-btn');
    if (snapBtn) snapBtn.addEventListener('click', snapPhoto);

    const expandBtn = card.querySelector('#live-card-expand-btn');
    if (expandBtn) expandBtn.addEventListener('click', toggleCameraExpand);

    const flipBtn = card.querySelector('#live-card-flip-btn');
    if (flipBtn) flipBtn.addEventListener('click', flipCamera);

    return card;
  }

  function removeInlineCard() {
    stopLiveHealthMonitor();
    const existing = document.getElementById('live-inline-card');
    if (existing) existing.remove();
  }

  function renderPendingMainTask() {
    const card = document.getElementById('live-main-task-card');
    if (!card) return;
    const task = pendingMainTask;
    if (!task || task.dismissed) {
      card.classList.add('hidden');
      return;
    }
    const title = document.getElementById('live-main-task-title');
    const text = document.getElementById('live-main-task-text');
    const expiry = document.getElementById('live-main-task-expiry');
    const confirm = document.getElementById('live-main-task-confirm-btn');
    const cancel = document.getElementById('live-main-task-cancel-btn');
    const remainingSec = Math.max(0, Math.ceil((task.expiresAt - Date.now()) / 1000));
    if (title) title.textContent = task.executing ? '⏳ 正在交辦主對話' : task.dispatched ? '⏳ 主對話背景處理中' : task.completed ? '✅ 主對話已完成' : '📨 待交辦主對話';
    if (text) text.textContent = task.task;
    if (expiry) expiry.textContent = task.executing ? '請稍候…' : task.dispatched ? '通話可繼續進行' : task.completed ? '已寫入主對話' : `${remainingSec} 秒內確認`;
    if (confirm) {
      confirm.disabled = Boolean(task.executing || task.dispatched || task.completed);
      confirm.classList.toggle('opacity-50', Boolean(task.executing || task.dispatched || task.completed));
    }
    if (cancel) {
      cancel.disabled = Boolean(task.executing || task.completed);
      cancel.classList.toggle('opacity-50', Boolean(task.executing || task.completed));
    }
    card.classList.remove('hidden');
  }

  function clearPendingMainTask(notice = '') {
    const taskToClear = pendingMainTask;
    if (pendingMainTaskTimer) clearTimeout(pendingMainTaskTimer);
    if (mainTaskPollTimer) clearTimeout(mainTaskPollTimer);
    pendingMainTaskTimer = null;
    mainTaskPollTimer = null;
    pendingMainTask = null;
    renderPendingMainTask();
    if (taskToClear?.centerTaskId && !taskToClear.dispatched && !taskToClear.completed) {
      fetch('/api/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', task_id: taskToClear.centerTaskId })
      }).then(() => window.refreshTaskCenter?.()).catch(() => {});
    }
    if (notice) appendCardTranscript('system', notice);
  }

  async function persistPendingMainTask(task) {
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create', source: 'live',
          provider: typeof currentProvider !== 'undefined' ? currentProvider : 'antigravity',
          conversation_id: currentConversationId,
          model: typeof currentModel !== 'undefined' ? currentModel : undefined,
          effort: typeof currentEffort !== 'undefined' ? currentEffort : 'low',
          task: getMainTaskText(task)
        })
      });
      const data = await response.json();
      if (!response.ok || !data.success || !data.task?.id) throw new Error(data.error || '任務草稿保存失敗');
      task.centerTaskId = data.task.id;
      if (pendingMainTask !== task) {
        await fetch('/api/tasks', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'cancel', task_id: task.centerTaskId })
        });
      }
      if (typeof window.refreshTaskCenter === 'function') window.refreshTaskCenter();
      return task.centerTaskId;
    } catch (error) {
      console.warn('[Live Task Center] Draft persistence failed:', error.message);
      return null;
    }
  }

  function getMainTaskText(task) {
    if (!task?.cameraSnapshot?.filePath) return task?.task || '';
    return `${task.task}\n\n【最新 Live 相機畫面】請直接讀取並分析這張本機最新畫面：${task.cameraSnapshot.filePath}\n擷取時間：${task.cameraSnapshot.capturedAt}`;
  }

  function getPendingMainTask() {
    if (!pendingMainTask) return null;
    if (pendingMainTask.expiresAt <= Date.now() && !pendingMainTask.executing && !pendingMainTask.completed) {
      clearPendingMainTask('待交辦任務已逾時，未送出。');
      return null;
    }
    return pendingMainTask;
  }

  function prepareMainTask(args = {}) {
    const task = String(args.task || args.message || '').trim().replace(/\s{3,}/g, ' ');
    if (!task) return { success: false, error: '交辦內容不可為空；請先確認使用者要主對話做什麼。' };
    if (task.length > 5000) return { success: false, error: '交辦內容過長，請先濃縮為 5000 字內的明確任務。' };
    if (typeof currentConversationId === 'undefined' || !currentConversationId) {
      return { success: false, error: '目前沒有主對話可接收任務；請先在主聊天建立或開啟一個對話。' };
    }
    if (pendingMainTask && (pendingMainTask.executing || pendingMainTask.dispatched)) {
      return { success: false, error: '已有主對話任務正在背景處理，請等待完成後再交辦下一項。' };
    }
    if (pendingMainTaskTimer) clearTimeout(pendingMainTaskTimer);
    pendingMainTask = {
      id: `main-task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      task,
      cameraSnapshot: latestLiveCameraSnapshot,
      expiresAt: Date.now() + MAIN_TASK_CONFIRM_TTL_MS,
      executing: false,
      completed: false
    };
    pendingMainTask.persistencePromise = persistPendingMainTask(pendingMainTask);
    pendingMainTaskTimer = setTimeout(() => {
      if (pendingMainTask && !pendingMainTask.executing && !pendingMainTask.dispatched && !pendingMainTask.completed) {
        clearPendingMainTask('待交辦任務已逾時，未送出。');
      }
    }, MAIN_TASK_CONFIRM_TTL_MS + 100);
    renderPendingMainTask();
    appendCardTranscript('system', '📨 已建立待交辦任務；請以明確語意確認或點擊確認按鈕。');
    return { success: true, status: 'pending_confirmation', task_id: pendingMainTask.id, task, expires_in_seconds: 60 };
  }

  function requestMainTaskConfirmation() {
    const task = getPendingMainTask();
    if (!task || task.executing || task.completed) return;
    if (!ws || !isConnected || ws.readyState !== WebSocket.OPEN) {
      appendCardTranscript('system', 'Live 連線已中斷，無法確認交辦。');
      return;
    }
    ws.send(JSON.stringify({
      clientContent: {
        turns: [{ role: 'user', parts: [{ text: `Confirm pending main-chat task, task_id: ${task.id}` }] }],
        turnComplete: true
      }
    }));
    appendCardTranscript('system', '✅ 已送出確認指令，準備交辦主對話。');
  }

  async function confirmMainTask() {
    const task = getPendingMainTask();
    if (!task) return { success: false, error: '沒有可確認的待交辦任務，可能已取消、逾時或任務編號不符。' };
    if (task.executing) return { success: false, error: '主對話正在處理這個任務，請等待結果。' };
    if (task.dispatched) return { success: true, status: 'running', message: '主對話正在背景處理，請繼續與使用者通話；完成後系統會送回結果。' };
    if (task.completed) {
      return {
        success: true,
        status: 'already_completed',
        reply: task.reply || '',
        message: '這個任務已完成；請直接根據既有結果回覆使用者，不要再次交辦。'
      };
    }
    task.executing = true;
    renderPendingMainTask();
    appendCardTranscript('system', '⏳ 正在交辦給目前主對話…');
    try {
      if (task.persistencePromise) await task.persistencePromise;
      const response = await fetch('/api/live-delegate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: typeof currentProvider !== 'undefined' ? currentProvider : 'antigravity',
          conversation_id: currentConversationId,
          model: typeof currentModel !== 'undefined' ? currentModel : undefined,
          effort: typeof currentEffort !== 'undefined' ? currentEffort : 'low',
          task: getMainTaskText(task),
          task_id: task.centerTaskId
        })
      });
      const data = await response.json().catch(() => ({ success: false, error: '主對話回覆格式無法解析。' }));
      if (!response.ok || !data.success) throw new Error(data.error || `主對話委派失敗（${response.status}）`);
      if (!data.accepted || !data.job_id) throw new Error(data.error || '主對話未接受背景任務。');
      task.executing = false;
      task.dispatched = true;
      task.dismissed = true;
      task.jobId = data.job_id;
      if (pendingMainTaskTimer) clearTimeout(pendingMainTaskTimer);
      if (typeof window.refreshTaskCenter === 'function') window.refreshTaskCenter();
      renderPendingMainTask();
      appendCardTranscript('system', '⏳ 主對話已在背景處理；您可繼續與 Live 對話。');
      pollMainTaskResult(task);
      return {
        success: true,
        status: 'accepted',
        conversation_id: data.conversation_id,
        message: '主對話已開始背景處理。請立即告知使用者任務已交辦，並繼續正常對話；完成後系統會自動提供結果。'
      };
    } catch (error) {
      task.executing = false;
      renderPendingMainTask();
      appendCardTranscript('system', `⚠️ 主對話未完成：${error.message}`);
      return { success: false, error: error.message };
    }
  }

  function finishMainTask(task, data) {
    if (!task || task.completed) return;
    task.dispatched = false;
    task.completed = true;
    task.reply = String(data.reply || '').slice(0, 5000);
    if (typeof window.refreshTaskCenter === 'function') window.refreshTaskCenter();
    if (!task.renderedToMainChat && typeof appendMessage === 'function') {
      appendMessage('user', `[🎙️ Live 已確認委派]\n${task.task}`);
      appendMessage('assistant', task.reply || '主對話已完成任務，但未回傳文字內容。');
      task.renderedToMainChat = true;
      if (typeof scrollToBottom === 'function') scrollToBottom(true);
    }
    renderPendingMainTask();
    appendCardTranscript('system', '✅ 主對話已完成並寫入原對話紀錄。');
    if (ws && isConnected && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        clientContent: {
          turns: [{ role: 'user', parts: [{ text: `【系統委派結果】主對話已完成剛才任務。請立刻用 AUDIO 向使用者簡潔報告以下結果；不要再呼叫 confirm_main_task：\n${task.reply || '任務完成，未取得文字結果。'}` }] }],
          turnComplete: true
        }
      }));
    }
    setTimeout(() => {
      if (pendingMainTask === task && task.completed) clearPendingMainTask();
    }, 1600);
  }

  async function pollMainTaskResult(task) {
    if (!task || !task.jobId) return;
    try {
      const response = await fetch(`/api/live-delegate?job_id=${encodeURIComponent(task.jobId)}`);
      const data = await response.json().catch(() => ({ success: false, error: '主對話工作狀態無法解析。' }));
      if (!response.ok || !data.success) throw new Error(data.error || '無法讀取主對話工作狀態。');
      if (data.status === 'completed') {
        finishMainTask(task, data);
      } else if (data.status === 'failed') {
        task.dispatched = false;
        task.error = data.error || '主對話任務失敗。';
        if (typeof window.refreshTaskCenter === 'function') window.refreshTaskCenter();
        renderPendingMainTask();
        appendCardTranscript('system', `⚠️ 主對話未完成：${task.error}`);
      } else if (pendingMainTask === task) {
        mainTaskPollTimer = setTimeout(() => pollMainTaskResult(task), 900);
      }
    } catch (error) {
      if (pendingMainTask === task) {
        task.dispatched = false;
        task.error = error.message;
        if (typeof window.refreshTaskCenter === 'function') window.refreshTaskCenter();
        renderPendingMainTask();
        appendCardTranscript('system', `⚠️ 無法追蹤主對話：${error.message}`);
      }
    }
  }

  function toggleLiveCardVisibility() {
    const card = document.getElementById('live-inline-card');
    if (!card) return;
    liveCardVisible = !liveCardVisible;
    card.classList.toggle('hidden', !liveCardVisible);
    if (liveVoiceBtn) {
      liveVoiceBtn.title = liveCardVisible ? 'Gemini Live 通話中 · 點擊隱藏控制面板' : 'Gemini Live 通話中 · 點擊顯示控制面板';
    }
    if (typeof window.haptic === 'function') window.haptic('light');
  }

  function toggleLiveCardExpanded() {
    const card = document.getElementById('live-inline-card');
    if (!card) return;
    if (!liveCardVisible) {
      liveCardVisible = true;
      card.classList.remove('hidden');
    }
    card.dispatchEvent(new CustomEvent('crew:toggle-expanded'));
    if (typeof window.haptic === 'function') window.haptic('light');
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
    updateLiveHealthPanel();
  }

  function recordLiveHealthIssue(text, level = 'warning') {
    lastLiveHealthIssue = { text: String(text || '未知異常'), level, at: Date.now() };
    updateLiveHealthPanel();
  }

  function setLiveHealthText(id, text, tone = 'text-slate-300') {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = text;
    element.className = tone;
  }

  function updateLiveHealthPanel() {
    const connection = ws && ws.readyState === WebSocket.OPEN && isConnected
      ? (isLiveSetupReady ? '已連線／就緒' : '已連線／設定中')
      : (ws && ws.readyState === WebSocket.CONNECTING ? '連線中' : '未連線');
    const connectionTone = isConnected ? 'text-emerald-300' : (ws?.readyState === WebSocket.CONNECTING ? 'text-amber-300' : 'text-rose-300');
    const track = micMediaStream?.getAudioTracks?.()[0];
    const mic = !track ? '未開啟' : (!track.enabled || isMuted ? '已靜音' : (track.readyState === 'live' ? '收音中' : '已停止'));
    const micTone = mic === '收音中' ? 'text-emerald-300' : (mic === '已靜音' ? 'text-amber-300' : 'text-rose-300');
    const playback = !audioPlayer ? '等待中' : (audioPlayer.isPlaying ? (isModelTurnComplete ? '播放中／排空中' : '接收並播放') : (isAiResponding ? '接收中' : '已排空'));
    const voiceprint = isVoiceprintActive() ? `門檻 ${TUNING_CONFIG.SIMILARITY_THRESHOLD.toFixed(2)}（本機）` : (userVoiceprintProfile ? '關閉' : '未校準');
    const phaseLabels = { idle: '待命', connecting: '連線中', listening: '聆聽', verifying: '聲紋確認', speaking: 'AI 回應', draining: '音訊排空', cooldown: '切換中' };
    const issue = lastLiveHealthIssue
      ? `${new Date(lastLiveHealthIssue.at).toLocaleTimeString('zh-TW', { hour12: false })} · ${lastLiveHealthIssue.text}`
      : '尚無';
    setLiveHealthText('live-health-connection', connection, connectionTone);
    setLiveHealthText('live-health-mic', mic, micTone);
    setLiveHealthText('live-health-playback', playback, audioPlayer?.isPlaying ? 'text-indigo-300' : 'text-slate-300');
    setLiveHealthText('live-health-voiceprint', voiceprint, isVoiceprintActive() ? 'text-emerald-300' : 'text-slate-400');
    setLiveHealthText('live-health-phase', phaseLabels[livePhase] || '待命', 'text-slate-400');
    setLiveHealthText('live-health-issue', issue, lastLiveHealthIssue ? (lastLiveHealthIssue.level === 'error' ? 'text-rose-300' : 'text-amber-300') : 'text-slate-400');
  }

  function startLiveHealthMonitor() {
    stopLiveHealthMonitor();
    updateLiveHealthPanel();
    liveHealthTimer = setInterval(updateLiveHealthPanel, 750);
  }

  function stopLiveHealthMonitor() {
    if (liveHealthTimer) clearInterval(liveHealthTimer);
    liveHealthTimer = null;
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

    const latestLine = document.getElementById('live-card-latest-line');
    if (latestLine) {
      const label = role === 'user' ? '🗣️ 我：' : role === 'system' ? '⚠️ ' : '✨ Gemini：';
      latestLine.textContent = `${label}${text}`;
      latestLine.className = `rounded-xl border px-2.5 py-2 text-[11px] truncate ${
        role === 'system' ? 'border-amber-500/30 bg-amber-950/35 text-amber-300' :
        role === 'user' ? 'border-indigo-500/30 bg-indigo-950/35 text-indigo-200' :
        'border-teal-500/30 bg-slate-950/65 text-slate-100'
      }`;
    }

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
        video.classList.add('max-h-[78vh]', 'h-[62vh]');
        if (expandBtn) expandBtn.innerHTML = '🗗 縮小';
      } else {
        video.classList.remove('max-h-[78vh]', 'h-[62vh]');
        video.classList.add('max-h-52');
        if (expandBtn) expandBtn.innerHTML = '⛶ 放大';
      }
    }

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
        muteBtn.title = isVoiceprintActive() ? 'AI 說話中 · 本人開口或點擊皆可打斷' : 'AI 說話中 · 點擊打斷';
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
    const dockExpandBtn = document.getElementById('live-dock-expand-btn');
    const dockExpandIcon = document.getElementById('live-dock-expand-icon');
    const cardCameraState = document.getElementById('live-card-camera-state');

    if (dockExpandBtn) dockExpandBtn.title = liveCardExpanded ? '收合通話資訊' : '展開通話資訊';
    if (dockExpandIcon) dockExpandIcon.textContent = liveCardExpanded ? '⌄' : '⌃';
    if (cardCameraState) cardCameraState.classList.toggle('hidden', !isCameraOn);

    const isAiSpeaking = isAiResponding || (audioPlayer && audioPlayer.activeSources.length > 0);

    if (isAiSpeaking) {
      if (dockMuteBtn) {
        dockMuteBtn.className = 'flex-1 h-12 px-4 rounded-2xl bg-gradient-to-r from-amber-500 to-rose-600 hover:from-amber-400 hover:to-rose-500 active:scale-95 text-white shadow-xl shadow-amber-500/40 flex items-center justify-center transition border border-amber-300/50';
        dockMuteBtn.title = isVoiceprintActive() ? 'AI 說話中 · 本人開口或點擊皆可打斷' : 'AI 說話中 · 點擊打斷';
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
        dockMuteBtn.className = 'flex-1 h-12 px-4 rounded-2xl bg-rose-900/90 hover:bg-rose-800 active:scale-95 text-rose-200 shadow-xl shadow-rose-950/60 flex items-center justify-center transition border border-rose-500/60';
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
        dockMuteBtn.className = 'flex-1 h-12 px-4 rounded-2xl bg-gradient-to-r from-teal-500 to-indigo-600 hover:from-teal-400 hover:to-indigo-500 active:scale-95 text-white shadow-xl shadow-teal-500/30 flex items-center justify-center transition border border-teal-400/50';
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
          dockCameraBtn.className = 'flex-1 max-w-[72px] h-12 rounded-2xl bg-indigo-600 hover:bg-indigo-500 active:scale-95 border border-indigo-400 text-white flex items-center justify-center transition shadow-lg shrink-0';
        dockCameraBtn.title = '關閉相機';
        dockCameraBtn.innerHTML = `
          <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M4 4h10a2 2 0 012 2v2.5l4.5-3a1 1 0 011.5.86v11.28a1 1 0 01-1.5.86L16 15.5V18a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2z"/>
          </svg>
        `;
      }
    } else {
      if (dockCameraBtn) {
          dockCameraBtn.className = 'flex-1 max-w-[72px] h-12 rounded-2xl bg-slate-800/90 hover:bg-slate-700 active:scale-95 border border-slate-700 text-slate-200 flex items-center justify-center transition shadow-lg shrink-0';
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
      if (audioPlayer) audioPlayer.setCaptureEnabled(!isMuted);
      isAiResponding = false;
      isModelTurnComplete = true;
      livePhase = LIVE_PHASE.LISTENING;
      hasSentFrameForCurrentTurn = false;
      lastAiSpokeTime = 0;
      updateCardStatus('listening', '🎙️ 可以開始說話');
      updateDockControls();
      if (navigator.vibrate) navigator.vibrate(30);
      return;
    }

    isMuted = !isMuted;
    if (audioPlayer) audioPlayer.setCaptureEnabled(!isMuted);

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
        cameraModeStartTs = Date.now();
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

        updateCameraBadge(false, '待命中（AI 需要時才擷取）');

      } catch (err) {
        alert('無法開啟相機：' + err.message);
        isCameraOn = false;
        cameraModeStartTs = 0;
      }
    } else {
      cameraModeStartTs = 0;
      if (cameraStream) {
        try { cameraStream.getTracks().forEach(t => t.stop()); } catch (e) {}
        cameraStream = null;
      }
      if (video) {
        video.srcObject = null;
        video.classList.remove('max-h-[78vh]', 'h-[62vh]');
        video.classList.add('max-h-52');
      }
      isCameraExpanded = false;
      hasSentFrameForCurrentTurn = false;
      userSpeechActive = false;
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
    startCallProtection();
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
        if (video) {
          video.srcObject = cameraStream;
          video.play().catch(() => {});
          updateCameraBadge(false, '鏡頭已切換（AI 需要時才擷取）');
        }
      } catch (e) {
        console.warn('Flip Camera Failed', e);
      }
    }
  }

  async function captureCameraFrame({ reason = 'explicit_camera_tool', maxWidth = 1100, quality = 0.76 } = {}) {
    if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN || !isCameraOn) {
      return { success: false, error: 'Live 相機尚未開啟或連線未就緒' };
    }

    const video = document.getElementById('live-card-video');
    if (!video || video.videoWidth === 0) {
      return { success: false, error: '相機影像尚未載入完成' };
    }

    try {
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      tempCanvas.width = Math.min(maxWidth, video.videoWidth);
      tempCanvas.height = Math.round((video.videoHeight / video.videoWidth) * tempCanvas.width);
      tempCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);
      const jpegDataUrl = tempCanvas.toDataURL('image/jpeg', quality);
      const cleanBase64 = jpegDataUrl.replace(/^data:image\/\w+;base64,/, '');
      const capturedAt = new Date().toISOString();
      const frameId = `camera_frame_${++cameraFrameSequence}`;

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
      // Persist only explicitly requested frames. Gemini receives the same
      // frame immediately; this copy lets a later delegated main-chat task
      // inspect the authoritative current image too.
      let localSnapshot = null;
      try {
        const response = await fetch('/api/live-camera-snapshot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: jpegDataUrl, capturedAt })
        });
        const data = await response.json();
        if (response.ok && data.success && data.file_path) {
          localSnapshot = { filePath: data.file_path, capturedAt };
          latestLiveCameraSnapshot = localSnapshot;
        }
      } catch (error) {
        console.warn('[Live Camera Snapshot Save Failed]', error.message);
      }
      updateCameraBadge(true, `📸 ${frameId} 已送出`);
      console.debug('[Gemini Live Camera Frame]', { frameId, capturedAt, reason });
      return {
        success: true,
        source: 'live_camera',
        frame_id: frameId,
        captured_at: capturedAt,
        width: tempCanvas.width,
        height: tempCanvas.height,
        reason,
        local_snapshot: localSnapshot
      };
    } catch (e) {
      console.warn('[Video Frame Send Error]', e);
      return { success: false, error: e.message };
    }
  }

  // ==========================================
  // 🔌 WebSocket Live Session Manager (Singleton)
  // ==========================================
  function getApiKey() {
    return (localStorage.getItem(STORAGE_KEY) || '').trim();
  }

  function getMaskedApiKeyHint() {
    const key = getApiKey();
    if (!key) return '尚未設定 API Key';
    return `目前使用：••••${key.slice(-4)}`;
  }

  function setApiKeyFieldForDisplay() {
    if (!liveApiKeyInput) return;
    const key = getApiKey();
    liveApiKeyInput.value = key ? `••••${key.slice(-4)}` : '';
    liveApiKeyInput.dataset.masked = key ? 'true' : 'false';
  }

  function getSelectedVoice() {
    return localStorage.getItem(VOICE_KEY) || DEFAULT_VOICE;
  }

  function getLiveVolumePercent() {
    const stored = Number.parseInt(localStorage.getItem(VOLUME_KEY), 10);
    return Number.isFinite(stored) ? Math.max(0, Math.min(100, stored)) : 100;
  }

  function renderLiveVolume(value, persist = true) {
    const percent = Math.max(0, Math.min(100, Number.parseInt(value, 10) || 0));
    if (persist) localStorage.setItem(VOLUME_KEY, String(percent));
    const cardSlider = document.getElementById('live-card-volume-slider');
    const cardValue = document.getElementById('live-card-volume-value');
    if (cardSlider && cardSlider.value !== String(percent)) cardSlider.value = String(percent);
    if (cardValue) cardValue.textContent = `${percent}%`;
    return percent;
  }

  async function syncSystemMediaVolume() {
    const requestSequence = ++mediaVolumeRequestSequence;
    try {
      const response = await fetch('/api/phone/volume', { cache: 'no-store' });
      const result = await response.json();
      if (requestSequence === mediaVolumeRequestSequence && result.success === true && Number.isFinite(Number(result.percent))) {
        renderLiveVolume(result.percent);
      }
    } catch (error) {
      console.debug('[Live Volume] CrewHelper volume sync unavailable:', error.message);
    }
  }

  function applyLiveVolume(value, immediate = false) {
    const percent = renderLiveVolume(value);
    const requestSequence = ++mediaVolumeRequestSequence;
    if (mediaVolumeUpdateTimer) clearTimeout(mediaVolumeUpdateTimer);
    const update = async () => {
      mediaVolumeUpdateTimer = null;
      try {
        const response = await fetch('/api/phone/volume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ percent })
        });
        const result = await response.json();
        if (requestSequence === mediaVolumeRequestSequence && result.success === true && Number.isFinite(Number(result.percent))) {
          renderLiveVolume(result.percent);
        }
      } catch (error) {
        console.warn('[Live Volume] Unable to set Android media volume:', error.message);
      }
    };
    if (immediate) update();
    else mediaVolumeUpdateTimer = setTimeout(update, 80);
  }

  function getSelectedModel() {
    localStorage.setItem(MODEL_KEY, DEFAULT_MODEL);
    return DEFAULT_MODEL;
  }

  function getLivePrompt() {
    return (localStorage.getItem(PROMPT_KEY) || '').trim();
  }

  function getResponsePace() {
    const pace = localStorage.getItem(RESPONSE_PACE_KEY) || 'normal';
    return ['brief', 'normal', 'calm'].includes(pace) ? pace : 'normal';
  }

  function getInterruptionMode() {
    const mode = localStorage.getItem(INTERRUPTION_MODE_KEY) || 'owner';
    return ['owner', 'button'].includes(mode) ? mode : 'owner';
  }

  function canOwnerAutoInterrupt() {
    return getInterruptionMode() === 'owner' && isVoiceprintActive();
  }

  function getResponsePaceInstruction() {
    const pace = getResponsePace();
    if (pace === 'brief') return '【回覆節奏：精簡】每次以一到兩句回答；先講結論，除非追問否則不要展開。';
    if (pace === 'calm') return '【回覆節奏：從容】語速自然偏慢，使用短句並在重點間留出自然停頓；仍避免冗長重複。';
    return '【回覆節奏：正常】自然清楚地回答，長度符合問題複雜度。';
  }

  function updateCallProtection() {
    if (!liveCallStartTs || !isConnected) return;
    const cameraMode = isCameraOn && cameraModeStartTs > 0;
    const limitMs = cameraMode ? 105000 : 870000; // 1m45 with video / 14m30 audio
    const protectionStartTs = cameraMode ? cameraModeStartTs : liveCallStartTs;
    const remainingMs = Math.max(0, limitMs - (Date.now() - protectionStartTs));
    const remainingSec = Math.ceil(remainingMs / 1000);
    const status = document.getElementById('live-call-protection-status');
    if (status) {
      const mins = Math.floor(remainingSec / 60);
      const secs = remainingSec % 60;
      status.textContent = `🛡️ 長通話保護 · 約剩 ${mins}:${String(secs).padStart(2, '0')} ${cameraMode ? '（相機模式）' : ''}`;
      status.className = remainingSec <= 60
        ? 'rounded-lg border border-amber-500/50 bg-amber-950/35 px-2 py-1.5 text-[10px] font-mono text-amber-300'
        : 'rounded-lg border border-slate-800 bg-slate-950/70 px-2 py-1.5 text-[10px] font-mono text-slate-400';
    }
    if (remainingSec <= 0) {
      appendCardTranscript('system', '🛡️ 已在 Gemini 強制斷線前安全結束並保存通話。');
      endLiveSession();
      return;
    }
    if (remainingSec <= 60 && !callProtectionWarned) {
      callProtectionWarned = true;
      appendCardTranscript('system', '🛡️ 通話時段即將結束，系統會先保存，避免 GoAway 強制中斷。');
    }
    callProtectionTimer = setTimeout(updateCallProtection, 1000);
  }

  function startCallProtection() {
    if (callProtectionTimer) clearTimeout(callProtectionTimer);
    callProtectionTimer = null;
    callProtectionWarned = false;
    updateCallProtection();
  }

  function stopCallProtection() {
    if (callProtectionTimer) clearTimeout(callProtectionTimer);
    callProtectionTimer = null;
  }

  function getLiveSessionContext() {
    const title = document.getElementById('header-title')?.textContent?.trim() || '目前對話';
    const provider = typeof currentProvider !== 'undefined' ? currentProvider : 'antigravity';
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Taipei';
    const now = new Intl.DateTimeFormat('zh-TW', {
      timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
      hour12: false
    }).format(new Date());
    const hasMainChat = typeof currentConversationId !== 'undefined' && Boolean(currentConversationId);
    const pendingTask = getPendingMainTask();
    const modeLabel = liveSessionMode === 'discussion' ? '討論（不可操作手機）' : '操作';
    const voiceprintState = isVoiceprintActive()
      ? '已啟用（只接受已校準本人聲音）'
      : (userVoiceprintProfile ? '關閉（略過比對，保留校準資料）' : '未校準');
    const interruptionState = canOwnerAutoInterrupt()
      ? '本人開口可插話'
      : '僅按鈕插話';
    const container = document.getElementById('messages-container');
    const recentNodes = container
      ? Array.from(container.children).filter(node => node.id !== 'live-inline-card').slice(-8)
      : [];
    const text = recentNodes.map(node => String(node.innerText || '')).join(' ').replace(/\s+/g, ' ').trim();
    const recent = text.length > 1800 ? text.slice(-1800) : text;
    return `【Live 啟動狀態】\n現在：${now}（${timeZone}）\n模式：${modeLabel}\n音色：${getSelectedVoice()}\n相機：關閉；僅在使用者明確要求查看眼前／相機時才擷取最新幀\n聲紋：${voiceprintState}\n插話：${interruptionState}\n主對話：${hasMainChat ? `可交辦（${title}）` : '尚未建立，無法交辦'}\n待交辦任務：${pendingTask ? '有，等待使用者確認' : '無'}\n\n【主 Session 背景】\n標題：${title}\nProvider：${provider}\n最近對話：${recent || '（無）'}\n此段只供理解背景；以使用者最新口頭指令為最高優先。`;
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

    // Update Header Live Button
    if (liveVoiceBtn) {
      liveVoiceBtn.classList.remove('bg-teal-500/15', 'hover:bg-teal-500/25', 'text-teal-300', 'border-teal-500/50', 'shadow-teal-500/20');
      liveVoiceBtn.classList.add('bg-rose-950/80', 'text-rose-300', 'border-rose-500/50', 'shadow-rose-500/30');
      liveVoiceBtn.title = 'Gemini Live 通話中 · 點擊隱藏控制面板';
      const span = liveVoiceBtn.querySelector('span:last-child');
      if (span) span.textContent = '通話中';
    }

    // 📱 Keep the normal composer visible during Live so the voice model can
    // draft a handoff into it without the call controls covering the input.
    const standardInputBar = document.getElementById('standard-input-bar');
    const liveBottomDock = document.getElementById('live-bottom-dock');
    if (standardInputBar) standardInputBar.classList.remove('hidden');
    if (liveBottomDock) {
      liveBottomDock.classList.remove('hidden');
      liveBottomDock.classList.add('flex');
    }
    updateDockControls();
    setMediaSessionActive(true);
    
    audioSendBuffer = [];
    preSetupAudioBuffer = [];
    isLiveSetupReady = false;
    sessionSnapshots = [];
    latestLiveCameraSnapshot = null;
    sessionExecutedTools = [];
    clearPendingMainTask();
    currentTurnInputTranscript = '';
    currentTurnOutputTranscript = '';
    currentTurnHadAudio = false;
    liveToolQueue = Promise.resolve();
    liveToolCallKeys = new Set();
    hasSentFrameForCurrentTurn = false;
    lastVideoFrameSentTime = 0;
    cameraFrameSequence = 0;
    userSpeechActive = false;
    sustainedSpeechCount = 0;
    isAiResponding = false;
    isModelTurnComplete = true;
    isMuted = false;
    isCameraOn = false;
    cameraModeStartTs = 0;
    isGoAwayClosing = false;
    lastLiveHealthIssue = null;
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
        const discussionToolAllowed = ['draft_message', 'prepare_main_task', 'confirm_main_task'].includes(name);
        if (liveSessionMode === 'discussion' && !discussionToolAllowed) {
          toolResult = { success: false, error: '目前是語音討論模式，此工具被停用；只允許在使用者明確要求時把草稿填入主輸入框。' };
          appendCardTranscript('system', `🛡️ 討論模式已阻擋：${name}`);
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

        } else if (name === 'prepare_main_task') {
          toolResult = prepareMainTask(args);

        } else if (name === 'confirm_main_task') {
          toolResult = await confirmMainTask(args);

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

        } else if (name === 'capture_camera_frame') {
          const highDetail = String(args.detail || '').toLowerCase() === 'high';
          const frame = await captureCameraFrame({
            reason: 'explicit_camera_tool',
            maxWidth: highDetail ? 1600 : 1100,
            quality: highDetail ? 0.84 : 0.76
          });
          if (frame.success) {
            toolResult = {
              ...frame,
              message: `Fresh ${frame.frame_id} captured at ${frame.captured_at}. This is the authoritative current Live camera view. Ignore every older camera image when answering this turn. Detail mode: ${highDetail ? 'high' : 'standard'}.`
            };
            if (navigator.vibrate) navigator.vibrate([20, 35]);
            appendCardTranscript('system', `📷 已擷取最新相機畫面：${frame.frame_id}`);
          } else {
            toolResult = frame;
            appendCardTranscript('system', `⚠️ 無法取得最新相機畫面：${frame.error}`);
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
      // Pre-warm identity verification before opening the microphone. This
      // keeps the first authorized utterance intact and makes verifier failure
      // visible instead of silently bypassing or timing out mid-sentence.
      if (isVoiceprintActive()) {
        updateCardStatus('connecting', '🧬 載入本人聲紋...');
        await initVoiceprintEngine();
      }

      // 2. Web Audio Context
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      try {
        audioContext = new AudioCtxClass({ latencyHint: 'interactive', sampleRate: 48000 });
      } catch (contextError) {
        audioContext = new AudioCtxClass();
      }
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      analyser = audioContext.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.8;

      if (!audioContext.audioWorklet) {
        throw new Error('此瀏覽器不支援低延遲 AudioWorklet，請更新 Android Chrome／WebView');
      }
      await audioContext.audioWorklet.addModule('/js/live-audio-worklet.js?v=1787857600');
      audioPlayer = new LiveAudioPlayer(audioContext);

      // 3. Microphone Capture. Live output is routed through a media <audio>
      // element, so Android can safely enable acoustic echo control here.
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
      audioPlayer.connectMic(micAudioSource);

      // 4. Connect to Google Gemini Bidi WebSocket
      const model = getSelectedModel();
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(apiKey)}`;
      
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[Gemini Live] WebSocket opened with model:', model);
        isConnected = true;
        isLiveSetupReady = false;
        livePhase = LIVE_PHASE.CONNECTING;
        startCallProtection();
        updateCardStatus('connecting', '⚡ 準備中...');

        const voiceName = getSelectedVoice();
        const baseSystemPrompt = (typeof getCrewLocale === 'function' && getCrewLocale() === 'en')
          ? `You are Crew Pocket's live voice assistant.

【Role】Be natural, accurate, and concise. Always give the final answer as AUDIO. Match the user's primary language naturally; Traditional Chinese is the default.
【Conversation】Answer ordinary questions directly. If a name, number, command, or intent is unclear, inconsistent, or important, ask one short clarification instead of guessing. Do not treat a noisy transcript as fact.
【Tool boundary】Use a tool only when it is necessary to fulfill an explicit request: phone UI/operation, live camera, workspace file, drafting into the main input, or delegating a task to the main chat. A screenshot, tap, swipe, or key press requires an explicit request in the user's latest utterance; past conversation, main-chat background, inference, or a normal question never authorizes it. Never call tools merely to verify a normal answer.
【Vision】For the live camera, call capture_camera_frame and rely only on the newest returned frame. For phone apps, buttons, or on-screen content, use take_screenshot; never substitute one type of image for the other.
【Main-chat delegation】Only when the user explicitly asks the main chat to handle a task: call prepare_main_task with a precise, clean task, then briefly read its summary. Wait for a clear semantic confirmation referring to that pending task (for example: 確認、好、可以、Sure, yes, confirmed) or the confirmation button. If the reply is ambiguous or unrelated, ask briefly instead. Then call confirm_main_task once; it confirms the single pending task automatically, so never invent an ID. After it returns, immediately speak the result and never confirm that task again.
【Transcript】The client records transcripts. Never try to log the conversation yourself.`
          : `你是 Crew Pocket 的即時語音助理。

【角色】自然、準確、簡潔地回應；最終回答一律以 AUDIO 語音說出。預設使用繁體中文，並依使用者主要語言自然切換。
【對話】一般知識、時間、閒聊或解釋直接回答。姓名、數字、指令或意圖聽不清楚、前後矛盾或影響結果時，先用一句話確認，不要猜測或把雜訊轉錄當成事實。
【工具邊界】只有為了完成使用者明確要求的手機畫面／操作、Live 相機、工作區檔案、填入主輸入框草稿，或交辦主對話時才使用工具。手機截圖、點擊、滑動或按鍵只能由使用者本輪最新一句明確口令授權；過去對話、主對話背景、推測或一般問題都不能授權。一般問題不可為了確認而隨意調工具。
【視覺】詢問 Live 相機、眼前或周遭時，使用 capture_camera_frame，且只採信該次回傳的最新畫面；詢問手機 App、按鈕或螢幕內容時，使用 take_screenshot。兩者不可互相替代。
【交辦主對話】只有使用者明確要求主對話處理任務時，先以 prepare_main_task 建立乾淨、精確的任務，再念出短摘要。等待使用者針對該待交辦任務作出明確語意確認，例如「確認」「好」「可以」「Sure」「yes」「confirmed」，或按下確認按鈕；若回覆不明確或無關則簡短追問。確認後只呼叫一次 confirm_main_task；它會確認目前唯一任務，絕不編造 ID。工具回傳後立刻口語報告結果，同一任務不可再次確認。
【逐字稿】逐字稿由前端處理，不要自行記錄對話。`;
        const discussionPrompt = liveSessionMode === 'discussion'
          ? "\n\n【討論模式】協助釐清需求、追問關鍵資訊並整理共識。不得操作手機、截圖或寫檔。只有使用者明確說要填入輸入框時才能使用 draft_message，而且不得自動送出；「好」「可以」不算傳送授權。"
          : "\n\n【操作模式】普通問題仍直接回答；不要為了確認答案而主動截圖、讀檔或操作手機。若本輪最新口令未明確要求手機動作，絕不可依先前對話執行截圖、點擊、滑動或按鍵。";
        const customPrompt = getLivePrompt();
        const userSystemPrompt = customPrompt
          ? `${baseSystemPrompt}\n\n【使用者偏好】${customPrompt}\n此偏好不得覆蓋 AUDIO、工具使用條件與安全規則。`
          : baseSystemPrompt;
        const systemPrompt = `${userSystemPrompt}${discussionPrompt}\n\n${getResponsePaceInstruction()}\n\n${getLiveSessionContext()}`;
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
            outputAudioTranscription: {},
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
                    name: "prepare_main_task",
                    description: "Prepare a precise task for the current main chat ONLY when the user explicitly asks the main chat to handle something. This does not execute anything. First read a short summary, then wait for a clear semantic confirmation that refers to this pending task or the confirmation button.",
                    parameters: {
                      type: "OBJECT",
                      properties: {
                        task: { type: "STRING", description: "Complete, unambiguous task for the main chat. Include constraints, names, dates and desired output; do not use raw noisy transcript." }
                      },
                      required: ["task"]
                    }
                  },
                  {
                    name: "confirm_main_task",
                    description: "Send the single pending main-chat task only after the user gives clear semantic confirmation for that pending task (for example 確認, 好, 可以, Sure, yes, confirmed) or presses the confirmation button. Do not call for silence, unrelated speech, or an ambiguous reply. It confirms the current pending task automatically; do not invent or supply an ID."
                  },
                  {
                    name: "capture_camera_frame",
                    description: "Capture a brand-new frame from the currently open Gemini Live camera. MANDATORY for questions about the camera, lens, surroundings, what is in front of the user, or what the user is pointing at. Each call sends a new authoritative frame: never rely on an older image. Use detail='high' for text, numbers, small objects, or fine visual details; otherwise use standard detail. Never substitute take_screenshot.",
                    parameters: {
                      type: "OBJECT",
                      properties: {
                        detail: { type: "STRING", enum: ["standard", "high"], description: "Use high only for text, numbers, small objects, or fine details." }
                      }
                    }
                  },
                  {
                    name: "take_screenshot",
                    description: "Capture the current PHONE DISPLAY only when the user's latest utterance explicitly asks to see, capture, or inspect the current screen, app UI, button, or on-screen content. Past conversation and general questions never authorize it. Never use this for the Live camera, lens, surroundings, or what is physically in front of the user."
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
                ].filter(tool => liveSessionMode !== 'discussion' || ['draft_message', 'prepare_main_task', 'confirm_main_task'].includes(tool.name))
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

        const goAway = response.goAway || response.go_away;
        if (goAway) {
          // Gemini Live announces its session deadline before it forcibly
          // closes the socket. End cleanly now so the call is saved and the
          // user never sees a misleading 1008 connection failure.
          isGoAwayClosing = true;
          recordLiveHealthIssue('Gemini 發出 GoAway，正在安全結束通話', 'warning');
          updateCardStatus('connecting', '⌛ 通話時段結束，正在安全關閉…');
          appendCardTranscript('system', '⌛ Gemini Live 通話時段已結束，已安全結束並保存本次通話。');
          setTimeout(() => { endLiveSession(); }, 0);
          return;
        }

        // Setup Complete
        const isSetupDone = response.setupComplete || response.setup_complete;
        if (isSetupDone) {
          console.log('[Gemini Live] Setup complete, ready to talk!');
          isLiveSetupReady = true;
          livePhase = LIVE_PHASE.LISTENING;
          if (audioPlayer) audioPlayer.setCaptureEnabled(!isMuted);
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
            audioPlayer.setCaptureEnabled(!isMuted);
            isAiResponding = false;
            isModelTurnComplete = true;
            livePhase = LIVE_PHASE.LISTENING;
            hasSentFrameForCurrentTurn = false;
            updateDockControls();
            updateCameraBadge(false, '待命中（AI 需要時才擷取）');
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
          // Setup requests `outputAudioTranscription`, while serverContent
          // returns the transcript under `outputTranscription`.
          const outputTranscript = sc.outputTranscription || sc.output_transcription;
          if (outputTranscript && outputTranscript.text) {
            currentTurnOutputTranscript += String(outputTranscript.text);
            console.debug('[Gemini Live Output Audio Transcript]', outputTranscript.text);
          }
          if (modelTurn && modelTurn.parts) {
            isAiResponding = true;
            isModelTurnComplete = false;
            livePhase = LIVE_PHASE.SPEAKING;
            if (audioPlayer) audioPlayer.setCaptureEnabled(canOwnerAutoInterrupt() && !isMuted);
            updateDockControls();
            updateCameraBadge(false, 'AI 說話中 (暫停傳圖)');
            updateCardStatus('speaking', canOwnerAutoInterrupt()
              ? '🔊 Gemini 說話中 · 本人開口可打斷'
              : '🔊 Gemini 說話中 · 點擊按鈕可打斷');
            let hasAudioChunk = false;
            for (const part of modelTurn.parts) {
              const inlineData = part.inlineData || part.inline_data;
              if (inlineData && inlineData.data) {
                const float32 = base64ToFloat32PCM(inlineData.data);
                audioPlayer.playChunk(float32, 24000);
                hasAudioChunk = true;
                currentTurnHadAudio = true;
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
            if (!hasAudioChunk && modelTurn.parts.some(part => part.text)) {
              console.warn('[Gemini Live] Received model text without inline audio; the visible text is not spoken audio.');
            }
          }

          const isTurnDone = sc.turnComplete || sc.turn_complete;
          if (isTurnDone) {
            isModelTurnComplete = true;
            if (audioPlayer) audioPlayer.markTurnComplete();
            livePhase = audioPlayer && audioPlayer.activeSources.length > 0
              ? LIVE_PHASE.DRAINING
              : LIVE_PHASE.COOLDOWN;
            const userText = currentTurnUser || currentTurnInputTranscript.trim();
            const spokenText = currentTurnOutputTranscript.trim();
            const fallbackModelText = currentTurnModel && currentTurnModel !== '🎙️ (AI 即時語音回覆)'
              ? currentTurnModel.trim()
              : '';
            const modelText = spokenText || fallbackModelText;
            const hasAssistantOutput = currentTurnHadAudio || Boolean(modelText);
            if (hasAssistantOutput) {
              if (!currentTurnHadAudio && modelText) {
                appendCardTranscript('system', '⚠️ Gemini 此輪只回傳文字，未收到可播放的 AUDIO 音訊');
              }
              const turn = {
                user: userText || '🗣️（使用者語音，未取得原始轉錄）',
                model: modelText || '🎙️（Gemini 語音回覆，未取得輸出轉錄）'
              };
              const lastTurn = sessionDialogueTurns[sessionDialogueTurns.length - 1];
              if (!lastTurn || lastTurn.user !== turn.user || lastTurn.model !== turn.model) {
                sessionDialogueTurns.push(turn);
                appendCardTranscript('user', turn.user);
                appendCardTranscript('model', turn.model);
              }
              currentTurnUser = '';
              currentTurnInputTranscript = '';
              currentTurnOutputTranscript = '';
              currentTurnModel = '';
              currentTurnHadAudio = false;
            }
            // A new visual turn must never depend on audio playback ending.
            // Text-only/model-tool turns still release the previous frame lock.
            hasSentFrameForCurrentTurn = false;
            userSpeechActive = false;
            sustainedSpeechCount = 0;
            if (!audioPlayer || audioPlayer.activeSources.length === 0) {
              scheduleMicReopenAfterPlayback();
            }
          }
        }
      };

      ws.onerror = (err) => {
        console.error('[Gemini Live WebSocket Error]', err);
        recordLiveHealthIssue('WebSocket 發生錯誤', 'error');
        updateCardStatus('error', '⚠️ 連線出錯');
      };

      ws.onclose = (e) => {
        console.log('[Gemini Live] Closed code:', e.code, 'reason:', e.reason);
        isConnected = false;
        isLiveSetupReady = false;
        livePhase = LIVE_PHASE.IDLE;
        preSetupAudioBuffer = [];
        isAiResponding = false;
        isModelTurnComplete = true;
        hasSentFrameForCurrentTurn = false;
        stopCallProtection();
        stopSpeechRecognition();
        if (e.code !== 1000 && !isGoAwayClosing) {
          recordLiveHealthIssue(`連線中斷（${e.code}${e.reason ? `：${e.reason}` : ''}）`, 'error');
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

      let recentSpeechRollingBuffer = [];
      let voiceprintDelayFrames = [];
      let voiceprintDelaySamples = 0;
      let voiceprintGateState = isVoiceprintActive() ? 'pending' : 'open';
      let voiceprintGateSegment = 0;
      let voiceprintGateLastSpeechAt = 0;
      let voiceprintGateRequestPending = false;
      let bargeInBuffer = [];
      let bargeInLastSpeechAt = 0;
      let bargeInRequestPending = false;
      let bargeInBlocked = false;
      let bargeInAttempt = 0;

      // 5. Mic PCM Stream with 3D-Speaker Neural Voiceprint & Barge-In Interruption Detector
      audioPlayer.setMicFrameHandler(({ samples: downsampled, rms }) => {
        if (isMuted || !audioContext) return;

        // The microphone can become active before the Gemini setup response.
        // Buffer only when no identity gate is configured. Sending setup-time
        // audio around a saved voiceprint would be an authorization bypass.
        if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN || !isLiveSetupReady) {
          if (!isVoiceprintActive()) {
            for (let i = 0; i < downsampled.length; i++) preSetupAudioBuffer.push(downsampled[i]);
            if (preSetupAudioBuffer.length > PRE_SETUP_AUDIO_MAX_SAMPLES) {
              preSetupAudioBuffer = preSetupAudioBuffer.slice(-PRE_SETUP_AUDIO_MAX_SAMPLES);
            }
          }
          return;
        }

        // While Gemini is speaking, capture only enough local audio to verify
        // an owner barge-in. Nothing reaches Gemini until the Worker confirms
        // the saved voiceprint; speaker echo and bystanders stay local.
        const aiPlaybackActive = livePhase === LIVE_PHASE.SPEAKING
          || livePhase === LIVE_PHASE.DRAINING
          || isAiResponding
          || (audioPlayer && audioPlayer.activeSources.length > 0);
        const inAiCooldown = (Date.now() - lastAiSpokeTime) < AI_ECHO_GUARD_MS;
        if (aiPlaybackActive) {
          audioSendBuffer = [];
          voiceprintDelayFrames = [];
          voiceprintDelaySamples = 0;
          recentSpeechRollingBuffer = [];

          if (!canOwnerAutoInterrupt()) return;
          const now = Date.now();
          const activeSpeech = rms > TUNING_CONFIG.RMS_THRESHOLD;
          if (activeSpeech) {
            if (!bargeInLastSpeechAt || now - bargeInLastSpeechAt > 600) {
              bargeInBuffer = [];
              bargeInBlocked = false;
              bargeInAttempt++;
            }
            bargeInLastSpeechAt = now;
            for (let i = 0; i < downsampled.length; i++) bargeInBuffer.push(downsampled[i]);
            if (bargeInBuffer.length > 16000) bargeInBuffer = bargeInBuffer.slice(-16000);

            if (!bargeInBlocked && !bargeInRequestPending && bargeInBuffer.length >= 6400) {
              bargeInRequestPending = true;
              const attempt = bargeInAttempt;
              computeSpeakerEmbedding(new Float32Array(bargeInBuffer.slice(-6400))).then(embedding => {
                if (attempt !== bargeInAttempt) return;
                const similarity = computeVoiceprintSimilarity(embedding, userVoiceprintProfile);
                if (similarity < TUNING_CONFIG.SIMILARITY_THRESHOLD) {
                  bargeInBlocked = true;
                  bargeInBuffer = [];
                  return;
                }
                const stillSpeaking = isAiResponding || (audioPlayer && audioPlayer.activeSources.length > 0);
                if (!stillSpeaking || !ws || ws.readyState !== WebSocket.OPEN) return;

                const authorizedAudio = new Float32Array(bargeInBuffer);
                bargeInBuffer = [];
                if (audioPlayer) {
                  audioPlayer.stopAll();
                  audioPlayer.setCaptureEnabled(!isMuted);
                }
                isAiResponding = false;
                isModelTurnComplete = true;
                livePhase = LIVE_PHASE.LISTENING;
                lastAiSpokeTime = 0;
                voiceprintGateSegment++;
                voiceprintGateState = 'authorized';
                voiceprintGateLastSpeechAt = Date.now();
                voiceprintGateRequestPending = false;
                hasSentFrameForCurrentTurn = false;

                for (let i = 0; i < authorizedAudio.length; i++) audioSendBuffer.push(authorizedAudio[i]);
                while (audioSendBuffer.length >= 640 && isLiveSetupReady && ws && ws.readyState === WebSocket.OPEN) {
                  sendLiveAudioChunk(new Float32Array(audioSendBuffer.splice(0, 640)));
                }
                if (navigator.vibrate) navigator.vibrate(20);
                updateDockControls();
                updateCameraBadge(false, '待命中（AI 需要時才擷取）');
                updateCardStatus('listening', '🎙️ 本人聲紋通過 · 已打斷');
              }).catch(error => {
                if (attempt === bargeInAttempt) {
                  bargeInBlocked = true;
                  bargeInBuffer = [];
                  console.warn('[Voiceprint Barge-in]', error.message);
                }
              }).finally(() => {
                if (attempt === bargeInAttempt) bargeInRequestPending = false;
              });
            }
          } else if (bargeInLastSpeechAt && now - bargeInLastSpeechAt > 600) {
            bargeInBuffer = [];
            bargeInBlocked = false;
            bargeInAttempt++;
            bargeInRequestPending = false;
          }
          return;
        }
        if (inAiCooldown) {
          audioSendBuffer = [];
          voiceprintDelayFrames = [];
          voiceprintDelaySamples = 0;
          recentSpeechRollingBuffer = [];
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
                  appendCardTranscript('system', '✅ 3D-Speaker 192 維神經聲紋校準完成。後續語音會先在本機驗證，通過後才傳給 Gemini。');
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

        const now = Date.now();
        // Use the same low activity floor as the speech buffer.  A quiet
        // bystander must still start a new, unauthorized segment instead of
        // inheriting a previous user's authorization.
        const isVoiceActivity = rms > 0.015;

        // Every new speech segment must earn a fresh authorization.  We keep
        // recording locally while it is pending, rather than turning the mic
        // off, so the verified user's opening words can be flushed intact.
        if (isVoiceprintActive() && isVoiceActivity) {
          if (!voiceprintGateLastSpeechAt || now - voiceprintGateLastSpeechAt > VOICEPRINT_SEGMENT_GAP_MS) {
            voiceprintGateSegment++;
            voiceprintGateState = 'pending';
            livePhase = LIVE_PHASE.VERIFYING;
            recentSpeechRollingBuffer = [];
            // A rejected/pending previous segment must never be released with
            // the next verified segment.
            voiceprintDelayFrames = [];
            voiceprintDelaySamples = 0;
            voiceprintGateRequestPending = false;
          }
          voiceprintGateLastSpeechAt = now;
        }

        // Maintain Rolling Speech Buffer for Neural Verification
        if (rms > 0.015) {
          for (let i = 0; i < downsampled.length; i++) {
            recentSpeechRollingBuffer.push(downsampled[i]);
          }
          if (recentSpeechRollingBuffer.length > 6400) { // Keep last 400ms
            recentSpeechRollingBuffer = recentSpeechRollingBuffer.slice(recentSpeechRollingBuffer.length - 6400);
          }
        } else if (!voiceprintGateLastSpeechAt || now - voiceprintGateLastSpeechAt > VOICEPRINT_SEGMENT_GAP_MS) {
          recentSpeechRollingBuffer = [];
        }

        // 🎛️ One neural verification per speech segment (off the main thread)
        const tuningDrawer = document.getElementById('live-card-tuning-drawer');
        if (isVoiceprintActive() && voiceprintGateState === 'pending' && !voiceprintGateRequestPending && recentSpeechRollingBuffer.length >= 6400) {
          voiceprintGateRequestPending = true;
          const embeddingSegment = voiceprintGateSegment;
          computeSpeakerEmbedding(new Float32Array(recentSpeechRollingBuffer)).then(emb => {
            if (emb && embeddingSegment === voiceprintGateSegment) {
              const curSim = computeVoiceprintSimilarity(emb, userVoiceprintProfile);
              voiceprintGateState = curSim >= TUNING_CONFIG.SIMILARITY_THRESHOLD ? 'authorized' : 'blocked';
              livePhase = LIVE_PHASE.LISTENING;

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

            }
          }).catch(error => {
            if (embeddingSegment === voiceprintGateSegment) {
              voiceprintGateState = 'blocked';
              livePhase = LIVE_PHASE.LISTENING;
              console.warn('[Voiceprint Gate]', error.message);
            }
          }).finally(() => {
            if (embeddingSegment === voiceprintGateSegment) voiceprintGateRequestPending = false;
          });
        }

        if (tuningDrawer && !tuningDrawer.classList.contains('hidden')) {
          const rmsVal = document.getElementById('live-meter-rms-val');
          const rmsBar = document.getElementById('live-meter-rms-bar');
          if (rmsVal) rmsVal.textContent = rms.toFixed(3);
          if (rmsBar) rmsBar.style.width = `${Math.min(100, Math.round((rms / 0.08) * 100))}%`;
        }

        // Active user speech tracking
        if (rms > 0.015) {
          if (!userSpeechActive) {
            userSpeechActive = true;
            hasSentFrameForCurrentTurn = false;
          }
          sustainedSpeechCount++;
          lastUserSpokeTime = Date.now();

        } else {
          sustainedSpeechCount = Math.max(0, sustainedSpeechCount - 1);
          if (userSpeechActive && Date.now() - lastUserSpokeTime > 500) {
            userSpeechActive = false;
          }
        }

        if (!isVoiceprintActive()) {
          voiceprintDelayFrames = [];
          voiceprintDelaySamples = 0;
          for (let i = 0; i < downsampled.length; i++) audioSendBuffer.push(downsampled[i]);
        } else {
          // Do not fail open. Hold all audio from a fresh speech segment until
          // the local neural voiceprint check authorizes it, then flush the
          // complete pre-roll. A bystander therefore cannot inject even the
          // first 200–300ms of a command.
          voiceprintDelayFrames.push({ samples: downsampled, rms });
          voiceprintDelaySamples += downsampled.length;
          if (voiceprintGateState === 'blocked') {
            voiceprintDelayFrames = [];
            voiceprintDelaySamples = 0;
          } else if (voiceprintGateState === 'authorized') {
            while (voiceprintDelayFrames.length) {
              const frame = voiceprintDelayFrames.shift();
              voiceprintDelaySamples -= frame.samples.length;
              for (let i = 0; i < frame.samples.length; i++) audioSendBuffer.push(frame.samples[i]);
            }
          } else if (voiceprintDelaySamples > VOICEPRINT_PENDING_MAX_SAMPLES) {
            // A failed/local-stalled verifier must never become a fail-open
            // path. Keep the newest pending audio and wait for verification.
            const frame = voiceprintDelayFrames.shift();
            voiceprintDelaySamples -= frame.samples.length;
          }
        }

        // Send every ~40ms (640 samples at 16kHz) to keep VAD boundaries and
        // short Mandarin consonants from being hidden in a large chunk.
        if (audioSendBuffer.length >= 640) {
          while (audioSendBuffer.length >= 640 && isLiveSetupReady && ws && ws.readyState === WebSocket.OPEN) {
            sendLiveAudioChunk(new Float32Array(audioSendBuffer.splice(0, 640)));
          }
        }
      });

    } catch (err) {
      console.error('[Live Session Error]', err);
      recordLiveHealthIssue(`啟動失敗：${err.message}`, 'error');
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

  // This must be safe to call more than once.  It is shared by the normal
  // hangup path and the error fallback so a partially failed teardown can
  // never leave audio capture, the Gemini socket, or health timers behind.
  function releaseLiveRuntimeResources() {
    const stopTracks = stream => {
      try {
        stream?.getTracks?.().forEach(track => {
          try { track.stop(); } catch (_) {}
        });
      } catch (_) {}
    };

    isConnected = false;
    isLiveSetupReady = false;
    livePhase = LIVE_PHASE.IDLE;
    preSetupAudioBuffer = [];
    audioSendBuffer = [];
    isAiResponding = false;
    isModelTurnComplete = true;
    isMuted = false;
    hasSentFrameForCurrentTurn = false;
    liveCallStartTs = 0;
    cameraModeStartTs = 0;
    stopCallProtection();
    stopLiveHealthMonitor();
    stopVisualizer();
    stopSpeechRecognition();

    if (cameraInterval) clearInterval(cameraInterval);
    cameraInterval = null;
    stopTracks(cameraStream);
    cameraStream = null;
    isCameraOn = false;

    if (mediaVolumeUpdateTimer) clearTimeout(mediaVolumeUpdateTimer);
    mediaVolumeUpdateTimer = null;
    if (voicePreviewSource) {
      try { voicePreviewSource.stop(); } catch (_) {}
      try { voicePreviewSource.disconnect(); } catch (_) {}
    }
    voicePreviewSource = null;
    if (audioPlayer) {
      try { audioPlayer.destroy(); } catch (_) {}
    }
    audioPlayer = null;
    if (micAudioSource) {
      try { micAudioSource.disconnect(); } catch (_) {}
    }
    micAudioSource = null;
    stopTracks(micMediaStream);
    micMediaStream = null;
    analyser = null;
    if (audioContext) {
      try { audioContext.close(); } catch (_) {}
    }
    audioContext = null;
    releaseVoiceprintWorker();
    if (ws) {
      try { ws.close(1000, 'Live session ended'); } catch (_) {}
    }
    ws = null;
    try { setMediaSessionActive(false); } catch (_) {}
  }

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
      const pendingUserText = currentTurnUser || currentTurnInputTranscript.trim();
      const pendingModelText = currentTurnOutputTranscript.trim()
        || ((currentTurnModel && currentTurnModel !== '🎙️ (AI 即時語音回覆)') ? currentTurnModel : '');
      const hasPendingTextTurn = pendingUserText || pendingModelText;
      if (hasPendingTextTurn) {
        turnsToSave.push({
          user: pendingUserText || '🗣️ (雙向語音通話)',
          model: pendingModelText || '🎙️ (AI 即時語音回覆)'
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

      releaseLiveRuntimeResources();

      if (typeof window.haptic === 'function') {
        try { window.haptic('heavy'); } catch (e) {}
      }

      // Reset Header Live Button
      if (liveVoiceBtn) {
        liveVoiceBtn.classList.remove('bg-rose-950/80', 'text-rose-300', 'border-rose-500/50', 'shadow-rose-500/30');
        liveVoiceBtn.classList.add('bg-teal-500/15', 'hover:bg-teal-500/25', 'text-teal-300', 'border-teal-500/50', 'shadow-teal-500/20');
        liveVoiceBtn.title = '🎙️ Gemini Live 原生雙向全雙工通話 (端到端音訊)';
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

      // 🧹 1. Cleanly remove the in-call Live card from screen
      clearPendingMainTask();
      removeInlineCard();

      // 🔒 Extract dialogue turns and full audio
      sessionExecutedTools = [];
      sessionDialogueTurns = [];
      sessionSnapshots = [];
      latestLiveCameraSnapshot = null;
      currentTurnUser = '';
      currentTurnInputTranscript = '';
      currentTurnOutputTranscript = '';
      currentTurnModel = '';
      currentTurnHadAudio = false;

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
      // Teardown fallback: even if one cleanup operation fails, force-release
      // every capture, socket, timer, and audio resource before restoring UI.
      releaseLiveRuntimeResources();
      try { clearPendingMainTask(); } catch (_) {}
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
    setApiKeyFieldForDisplay();
    if (liveApiKeyHint) liveApiKeyHint.textContent = getMaskedApiKeyHint();
    if (liveModelSelect) liveModelSelect.value = getSelectedModel();
    if (liveVoiceSelect) liveVoiceSelect.value = getSelectedVoice();
    if (livePromptInput) livePromptInput.value = getLivePrompt();
    if (liveResponsePaceSelect) liveResponsePaceSelect.value = getResponsePace();
    if (liveInterruptionSelect) liveInterruptionSelect.value = getInterruptionMode();
    updateVoiceprintThresholdUI();
    updateLiveSettingsSummary();
    const sessionActive = Boolean(isConnected || (ws && ws.readyState !== WebSocket.CLOSED));
    if (liveSettingsSessionNote) {
      liveSettingsSessionNote.textContent = sessionActive
        ? '通話中：變更將於下一通 Live 套用'
        : '調整後按儲存即可套用';
    }
    if (liveSaveKeyBtn) liveSaveKeyBtn.textContent = sessionActive ? '儲存，下通套用' : '儲存並啟動通話';
    if (liveSettingsAdvanced) liveSettingsAdvanced.open = !getApiKey();
    liveKeyModal.classList.remove('hidden');
  }

  function updateLiveSettingsSummary() {
    if (liveSettingsSummaryVoice) liveSettingsSummaryVoice.textContent = liveVoiceSelect?.value || getSelectedVoice();
    if (liveSettingsSummaryPace) {
      const labels = { brief: '精簡', normal: '正常', calm: '從容' };
      liveSettingsSummaryPace.textContent = labels[liveResponsePaceSelect?.value] || '正常';
    }
    if (liveSettingsSummaryInterruption) {
      liveSettingsSummaryInterruption.textContent = liveInterruptionSelect?.value === 'button' ? '按鈕插話' : '本人插話';
    }
  }

  function hideKeyModal() {
    liveKeyModal.classList.add('hidden');
  }

  // Event Listeners
  if (liveVoiceBtn) {
    liveVoiceBtn.addEventListener('click', () => {
      if (isConnected) {
        toggleLiveCardVisibility();
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

  const liveVoiceprintThreshold = document.getElementById('live-voiceprint-threshold');
  if (liveVoiceprintThreshold) {
    liveVoiceprintThreshold.addEventListener('input', () => {
      TUNING_CONFIG.SIMILARITY_THRESHOLD = Number.parseFloat(liveVoiceprintThreshold.value) || 0;
      TUNING_CONFIG.save();
      updateVoiceprintThresholdUI();
      updateVoiceprintModalUI();
      updateLiveHealthPanel();
    });
  }

  if (liveSettingsBtn) {
    liveSettingsBtn.addEventListener('click', () => {
      showKeyModal();
    });
  }

  if (liveSaveKeyBtn) {
    liveSaveKeyBtn.addEventListener('click', () => {
      const enteredKey = liveApiKeyInput ? liveApiKeyInput.value.trim() : '';
      const key = liveApiKeyInput?.dataset.masked === 'true' ? getApiKey() : enteredKey;
      const model = liveModelSelect ? liveModelSelect.value : DEFAULT_MODEL;
      const voice = liveVoiceSelect ? liveVoiceSelect.value : DEFAULT_VOICE;
      const prompt = livePromptInput ? livePromptInput.value.trim() : '';
      const pace = liveResponsePaceSelect ? liveResponsePaceSelect.value : 'normal';
      const interruptionMode = liveInterruptionSelect ? liveInterruptionSelect.value : 'owner';
      if (key) {
        localStorage.setItem(STORAGE_KEY, key);
        if (liveApiKeyHint) liveApiKeyHint.textContent = `目前使用：••••${key.slice(-4)}`;
        localStorage.setItem(MODEL_KEY, model);
        localStorage.setItem(VOICE_KEY, voice);
        if (prompt) localStorage.setItem(PROMPT_KEY, prompt);
        else localStorage.removeItem(PROMPT_KEY);
        localStorage.setItem(RESPONSE_PACE_KEY, pace);
        localStorage.setItem(INTERRUPTION_MODE_KEY, interruptionMode);
        updateVoiceprintThresholdUI();
        const sessionActive = Boolean(isConnected || (ws && ws.readyState !== WebSocket.CLOSED));
        hideKeyModal();
        if (!sessionActive) startLiveSession(liveSessionMode);
      } else {
        localStorage.removeItem(STORAGE_KEY);
        if (liveApiKeyHint) liveApiKeyHint.textContent = '尚未設定 API Key';
        hideKeyModal();
      }
    });
  }

  if (liveApiKeyInput) {
    liveApiKeyInput.addEventListener('beforeinput', () => {
      if (liveApiKeyInput.dataset.masked !== 'true') return;
      liveApiKeyInput.value = '';
      liveApiKeyInput.dataset.masked = 'false';
    });
  }

  if (liveVoiceSelect) {
    populateVoiceSelect(liveVoiceSelect, getSelectedVoice());
    liveVoiceSelect.value = getSelectedVoice();
    liveVoiceSelect.addEventListener('change', () => {
      updateLiveSettingsSummary();
    });
  }

  if (liveResponsePaceSelect) liveResponsePaceSelect.addEventListener('change', updateLiveSettingsSummary);
  if (liveInterruptionSelect) liveInterruptionSelect.addEventListener('change', updateLiveSettingsSummary);

  if (liveVoicePreviewBtn) {
    liveVoicePreviewBtn.addEventListener('click', previewSelectedVoice);
  }

  if (liveModelSelect) {
    liveModelSelect.value = getSelectedModel();
  }

  // 📱 Option A: Bottom Voice Dock Event Listeners
  const dockMuteBtn = document.getElementById('live-dock-mute-btn');
  if (dockMuteBtn) {
    dockMuteBtn.addEventListener('click', toggleMute);
  }

  const dockCameraBtn = document.getElementById('live-dock-camera-btn');
  if (dockCameraBtn) {
    dockCameraBtn.addEventListener('click', () => {
      if (!isCameraOn) toggleLiveCardExpanded();
      toggleCamera();
    });
  }

  const dockExpandBtn = document.getElementById('live-dock-expand-btn');
  if (dockExpandBtn) dockExpandBtn.addEventListener('click', toggleLiveCardExpanded);

  const dockHangupBtn = document.getElementById('live-dock-hangup-btn');
  if (dockHangupBtn) {
    dockHangupBtn.addEventListener('click', endLiveSession);
  }

})();
