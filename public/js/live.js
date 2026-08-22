/**
 * 🎙️ Crew Pocket - Gemini Live Multimodal Live API (Full-Duplex Audio & Vision)
 * Powered by Web STT + Gemini Flash Background Transcribe + Active Session History Sync.
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
  let cameraStream = null;
  let cameraInterval = null;
  let analyser = null;
  let animFrameId = null;
  let audioSendBuffer = [];
  
  // Real-time STT & Audio Accumulation
  let speechRecognizer = null;
  let turnUserPcmChunks = [];
  let turnModelPcmChunks = [];
  let currentTurnModelText = '';
  let currentTurnUserText = '';

  // DOM Elements
  const liveVoiceBtn = document.getElementById('live-voice-btn');
  const liveCallModal = document.getElementById('live-call-modal');
  const liveKeyModal = document.getElementById('live-key-modal');
  const liveApiKeyInput = document.getElementById('live-api-key-input');
  const liveModelSelect = document.getElementById('live-model-select');
  const liveCallModelSelect = document.getElementById('live-call-model-select');
  const liveSaveKeyBtn = document.getElementById('live-save-key-btn');
  const liveCloseKeyBtn = document.getElementById('live-close-key-btn');
  const liveStatusPill = document.getElementById('live-status-pill');
  const liveStatusText = document.getElementById('live-status-text');
  const liveEndCallBtn = document.getElementById('live-end-call-btn');
  const liveMuteBtn = document.getElementById('live-mute-btn');
  const liveCameraBtn = document.getElementById('live-camera-btn');
  const liveSettingsBtn = document.getElementById('live-settings-btn');
  const liveVoiceSelect = document.getElementById('live-voice-select');
  const liveCanvas = document.getElementById('live-visualizer-canvas');
  const liveVideoPreview = document.getElementById('live-video-preview');
  const liveTranscriptText = document.getElementById('live-transcript-text');

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
          updateStatus('listening', '🎙️ 聆聽中 (隨時說話)');
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

  // ==========================================
  // 🎨 Real-time Audio Spectrum Visualizer
  // ==========================================
  function startVisualizer() {
    if (!liveCanvas) return;
    const canvasCtx = liveCanvas.getContext('2d');
    const bufferLength = analyser ? analyser.frequencyBinCount : 64;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
      animFrameId = requestAnimationFrame(draw);
      const width = liveCanvas.width;
      const height = liveCanvas.height;

      if (analyser) {
        analyser.getByteFrequencyData(dataArray);
      }

      canvasCtx.clearRect(0, 0, width, height);

      const barCount = 32;
      const barWidth = (width / barCount) * 0.7;
      const gap = (width / barCount) * 0.3;
      
      let sum = 0;
      for (let i = 0; i < barCount; i++) {
        const val = dataArray[i * 2] || 0;
        sum += val;
        const percent = val / 255;
        const barHeight = Math.max(4, percent * height * 0.85);
        const x = i * (barWidth + gap) + gap / 2;
        const y = (height - barHeight) / 2;

        const gradient = canvasCtx.createLinearGradient(0, y, 0, y + barHeight);
        if (isConnected) {
          gradient.addColorStop(0, '#2dd4bf');
          gradient.addColorStop(0.5, '#6366f1');
          gradient.addColorStop(1, '#ec4899');
        } else {
          gradient.addColorStop(0, '#64748b');
          gradient.addColorStop(1, '#334155');
        }

        canvasCtx.fillStyle = gradient;
        canvasCtx.beginPath();
        canvasCtx.roundRect(x, y, barWidth, barHeight, 4);
        canvasCtx.fill();
      }

      const avg = sum / barCount;
      const halo = document.getElementById('live-halo-ring');
      if (halo) {
        const scale = 1 + (avg / 255) * 0.35;
        const opacity = 0.3 + (avg / 255) * 0.7;
        halo.style.transform = `scale(${scale})`;
        halo.style.opacity = `${opacity}`;
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
          appendTranscript('user', spoken);
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

  function updateStatus(state, text) {
    if (!liveStatusText || !liveStatusPill) return;
    liveStatusText.textContent = text;
    
    liveStatusPill.className = 'px-3 py-1 rounded-full text-xs font-semibold font-mono flex items-center gap-1.5 transition-all shadow-lg ' +
      (state === 'connected' || state === 'listening' ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/50 shadow-emerald-500/20' :
       state === 'speaking' ? 'bg-indigo-950/80 text-indigo-300 border border-indigo-500/50 shadow-indigo-500/20 animate-pulse' :
       state === 'connecting' ? 'bg-amber-950/80 text-amber-300 border border-amber-500/50' :
       state === 'error' ? 'bg-rose-950/80 text-rose-300 border border-rose-500/50 shadow-rose-500/20' :
       'bg-slate-900/90 text-slate-400 border border-slate-700');
  }

  function appendTranscript(role, text) {
    if (!liveTranscriptText || !text) return;
    const p = document.createElement('div');
    p.className = `text-xs leading-relaxed py-1.5 px-3 rounded-xl my-1.5 transition-all ${
      role === 'user' ? 'bg-indigo-950/80 border border-indigo-500/40 text-indigo-200 text-right ml-6 shadow-md shadow-indigo-950/30' : 
      role === 'system' ? 'bg-amber-950/70 border border-amber-500/40 text-amber-300 text-left font-mono text-[11px]' : 
      'bg-slate-900/90 border border-teal-500/30 text-slate-100 text-left mr-6 shadow-md shadow-slate-950/40'
    }`;
    p.innerHTML = (role === 'user' ? '🗣️ 我: ' : role === 'system' ? '⚠️ ' : '✨ Gemini: ') + escapeHtml(text);
    liveTranscriptText.appendChild(p);
    liveTranscriptText.scrollTop = liveTranscriptText.scrollHeight;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  let isSyncing = false;

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
          if (transData.user_text) finalUser = transData.user_text;
          if (transData.model_text) finalModel = transData.model_text;
        }
      }

      finalUser = finalUser || (userWav ? '🗣️ (語音輸入)' : '');
      finalModel = finalModel || (modelWav ? '🎙️ (已完成語音回覆)' : '');

      if (!finalUser && !finalModel) return;

      // 2. Show in live modal transcript box
      if (finalUser && finalUser !== '🗣️ (語音輸入)') appendTranscript('user', finalUser);
      if (finalModel && finalModel !== '🎙️ (已完成語音回覆)') appendTranscript('model', finalModel);

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
      if (syncData.success && syncData.conversation_id) {
        if (typeof currentConversationId !== 'undefined' && !currentConversationId) {
          currentConversationId = syncData.conversation_id;
          localStorage.setItem('agy_active_conv_id', syncData.conversation_id);
          if (typeof loadConversations === 'function') loadConversations();
        }
      }

      // 4. Render into background chat timeline
      if (typeof appendMessage === 'function') {
        appendMessage('user', `🎙️ [Live 語音] ${finalUser}`);
        appendMessage('assistant', `🎙️ [Live 語音]\n${finalModel}`);
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

    liveCallModal.classList.remove('hidden');
    updateStatus('connecting', '⚡ 連線 Google Gemini Live...');
    if (liveTranscriptText) liveTranscriptText.innerHTML = '<div class="text-slate-400 text-center text-[11px] font-mono">⚡ 正在建立即時雙向語音通道...</div>';
    audioSendBuffer = [];
    turnUserPcmChunks = [];
    turnModelPcmChunks = [];
    currentTurnModelText = '';
    currentTurnUserText = '';

    try {
      // 1. Web Audio Context
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioCtxClass();
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      analyser = audioContext.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.8;

      audioPlayer = new LiveAudioPlayer(audioContext);

      // 2. Microphone Capture
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
        updateStatus('error', '⚠️ 麥克風存取失敗');
        appendTranscript('system', '請允許麥克風權限以進行通話：' + micErr.message);
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

      // 3. Connect to Google Gemini Bidi WebSocket
      const model = getSelectedModel();
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(apiKey)}`;
      
      if (ws) {
        try { ws.close(); } catch (e) {}
      }

      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[Gemini Live] WebSocket opened with model:', model);
        isConnected = true;
        updateStatus('connected', '✨ 初始化語音通道...');

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

        // 1. Setup Complete
        const isSetupDone = response.setupComplete || response.setup_complete;
        if (isSetupDone) {
          console.log('[Gemini Live] Setup complete, ready to talk!');
          updateStatus('listening', '🎙️ 聆聽中 (雙向全雙工)...');
          if (liveTranscriptText) liveTranscriptText.innerHTML = `<div class="text-emerald-400 text-center text-[11px] font-mono">✅ ${model.replace('models/', '')} 語音通道已就緒！請隨時對著手機說話...</div>`;
          return;
        }

        // 2. Server Content
        const sc = response.serverContent || response.server_content;
        if (sc) {
          if (sc.interrupted) {
            console.log('[Gemini Live] Interrupted by user!');
            audioPlayer.stopAll();
            updateStatus('listening', '🎙️ 正在聆聽...');
            processTurnAndSync();
            return;
          }

          const modelTurn = sc.modelTurn || sc.model_turn;
          if (modelTurn && modelTurn.parts) {
            updateStatus('speaking', '🔊 Gemini 正在說話...');
            for (const part of modelTurn.parts) {
              const inlineData = part.inlineData || part.inline_data;
              if (inlineData && inlineData.data) {
                const float32 = base64ToFloat32PCM(inlineData.data);
                turnModelPcmChunks.push(float32);
                audioPlayer.playChunk(float32, 24000);
              }
              if (part.text) {
                currentTurnModelText += part.text;
                appendTranscript('model', part.text);
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
        updateStatus('error', '⚠️ 連線出錯');
      };

      ws.onclose = (e) => {
        console.log('[Gemini Live] Closed code:', e.code, 'reason:', e.reason);
        isConnected = false;
        stopSpeechRecognition();
        processTurnAndSync();
        if (e.code !== 1000) {
          updateStatus('error', `⚠️ 連線中斷 (${e.code})`);
          let helpText = `連線已中斷 (代碼: ${e.code})。`;
          if (e.code === 1008) {
            helpText += '\n• 原因 1008 通常是「API Key 設有限制」，請在 Google AI Studio 將 API Key 改為「無限制 (None)」。';
          }
          if (e.reason) helpText += `\n• Google 回傳訊息: ${e.reason}`;
          appendTranscript('system', helpText);
        }
      };

      // 4. Mic PCM Stream (100ms buffering & turn audio accumulation)
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
      updateStatus('error', '⚠️ 啟動失敗');
      appendTranscript('system', '錯誤：' + err.message);
    }
  }

  async function endLiveSession() {
    isConnected = false;
    stopVisualizer();
    stopSpeechRecognition();

    await processTurnAndSync();

    if (cameraInterval) {
      clearInterval(cameraInterval);
      cameraInterval = null;
    }
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      cameraStream = null;
      if (liveVideoPreview) {
        liveVideoPreview.srcObject = null;
        liveVideoPreview.classList.add('hidden');
      }
    }
    isCameraOn = false;
    if (liveCameraBtn) liveCameraBtn.classList.remove('bg-indigo-600', 'text-white');

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

    if (liveCallModal) liveCallModal.classList.add('hidden');
    updateStatus('idle', '已掛斷通話');

    // Refresh conversation list in sidebar
    if (typeof loadConversations === 'function') {
      setTimeout(loadConversations, 300);
    }
  }

  // Camera Video Stream (1 FPS JPEG Chunks for Multimodal Vision)
  async function toggleCamera() {
    if (isCameraOn) {
      if (cameraInterval) clearInterval(cameraInterval);
      if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
      cameraStream = null;
      isCameraOn = false;
      liveVideoPreview.classList.add('hidden');
      liveCameraBtn.classList.remove('bg-indigo-600', 'text-white');
    } else {
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
        });
        liveVideoPreview.srcObject = cameraStream;
        liveVideoPreview.classList.remove('hidden');
        isCameraOn = true;
        liveCameraBtn.classList.add('bg-indigo-600', 'text-white');

        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');

        cameraInterval = setInterval(() => {
          if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN || !isCameraOn) return;
          if (liveVideoPreview.videoWidth > 0) {
            tempCanvas.width = 480;
            tempCanvas.height = Math.round((liveVideoPreview.videoHeight / liveVideoPreview.videoWidth) * 480);
            tempCtx.drawImage(liveVideoPreview, 0, 0, tempCanvas.width, tempCanvas.height);
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
      } catch (e) {
        alert('無法存取相機：' + e.message);
      }
    }
  }

  // Key Modal Handlers
  function showKeyModal() {
    if (liveApiKeyInput) liveApiKeyInput.value = getApiKey();
    if (liveModelSelect) liveModelSelect.value = getSelectedModel();
    if (liveCallModelSelect) liveCallModelSelect.value = getSelectedModel();
    liveKeyModal.classList.remove('hidden');
  }

  function hideKeyModal() {
    liveKeyModal.classList.add('hidden');
  }

  // Event Listeners
  if (liveVoiceBtn) {
    liveVoiceBtn.addEventListener('click', () => {
      const key = getApiKey();
      if (!key) {
        showKeyModal();
      } else {
        startLiveSession();
      }
    });
  }

  if (liveEndCallBtn) {
    liveEndCallBtn.addEventListener('click', () => {
      endLiveSession();
    });
  }

  if (liveMuteBtn) {
    liveMuteBtn.addEventListener('click', () => {
      isMuted = !isMuted;
      if (isMuted) {
        liveMuteBtn.classList.add('bg-rose-600', 'text-white');
        updateStatus('muted', '🔇 麥克風已靜音');
      } else {
        liveMuteBtn.classList.remove('bg-rose-600', 'text-white');
        updateStatus('listening', '🎙️ 正在聆聽...');
      }
    });
  }

  if (liveCameraBtn) {
    liveCameraBtn.addEventListener('click', toggleCamera);
  }

  if (liveSettingsBtn) {
    liveSettingsBtn.addEventListener('click', showKeyModal);
  }

  if (liveCloseKeyBtn) {
    liveCloseKeyBtn.addEventListener('click', hideKeyModal);
  }

  if (liveSaveKeyBtn) {
    liveSaveKeyBtn.addEventListener('click', () => {
      const key = liveApiKeyInput ? liveApiKeyInput.value.trim() : '';
      const model = liveModelSelect ? liveModelSelect.value : DEFAULT_MODEL;
      if (key) {
        localStorage.setItem(STORAGE_KEY, key);
        localStorage.setItem(MODEL_KEY, model);
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

  if (liveCallModelSelect) {
    liveCallModelSelect.value = getSelectedModel();
    liveCallModelSelect.addEventListener('change', () => {
      localStorage.setItem(MODEL_KEY, liveCallModelSelect.value);
      if (isConnected) {
        endLiveSession();
        startLiveSession();
      }
    });
  }

})();
