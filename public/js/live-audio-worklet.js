'use strict';

class CrewLiveAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.captureEnabled = true;
    this.micPending = [];
    this.micChunkSamples = Math.max(128, Math.round(sampleRate * 0.04));
    this.outputQueue = [];
    this.outputOffset = 0;
    this.outputSamples = 0;
    this.playing = false;
    this.fadeRemaining = 0;
    this.forceOutput = false;
    this.startThresholdSamples = Math.max(256, Math.round(sampleRate * 0.06));

    this.port.onmessage = (event) => {
      const message = event.data || {};
      if (message.type === 'output' && message.samples) {
        const source = new Float32Array(message.samples);
        const converted = this.resample(source, Number(message.sampleRate) || 24000, sampleRate);
        if (converted.length) {
          this.outputQueue.push(converted);
          this.outputSamples += converted.length;
        }
      } else if (message.type === 'clear-output') {
        this.outputQueue = [];
        this.outputOffset = 0;
        this.outputSamples = 0;
        this.playing = false;
        this.fadeRemaining = 0;
        this.forceOutput = false;
        this.port.postMessage({ type: 'output-drained' });
      } else if (message.type === 'turn-complete') {
        this.forceOutput = true;
      } else if (message.type === 'capture') {
        this.captureEnabled = Boolean(message.enabled);
        if (!this.captureEnabled) this.micPending = [];
      }
    };
  }

  resample(input, sourceRate, targetRate) {
    if (!input.length || sourceRate <= 0 || targetRate <= 0) return new Float32Array(0);
    if (sourceRate === targetRate) return new Float32Array(input);
    const outputLength = Math.max(1, Math.round(input.length * targetRate / sourceRate));
    const output = new Float32Array(outputLength);
    const ratio = sourceRate / targetRate;
    for (let i = 0; i < outputLength; i++) {
      const position = i * ratio;
      const left = Math.min(input.length - 1, Math.floor(position));
      const right = Math.min(input.length - 1, left + 1);
      const fraction = position - left;
      output[i] = input[left] + (input[right] - input[left]) * fraction;
    }
    return output;
  }

  emitMicChunks() {
    while (this.micPending.length >= this.micChunkSamples) {
      const source = new Float32Array(this.micPending.splice(0, this.micChunkSamples));
      const pcm16k = this.resample(source, sampleRate, 16000);
      let sumSquares = 0;
      for (let i = 0; i < pcm16k.length; i++) sumSquares += pcm16k[i] * pcm16k[i];
      const rms = pcm16k.length ? Math.sqrt(sumSquares / pcm16k.length) : 0;
      this.port.postMessage({ type: 'mic-frame', samples: pcm16k.buffer, rms }, [pcm16k.buffer]);
    }
  }

  renderOutput(channel) {
    channel.fill(0);
    let outputIndex = 0;

    if (!this.playing && this.outputSamples > 0 && (this.forceOutput || this.outputSamples >= this.startThresholdSamples)) {
      this.playing = true;
      this.fadeRemaining = Math.min(192, this.outputSamples);
      this.port.postMessage({ type: 'output-started' });
    }

    while (outputIndex < channel.length && this.outputQueue.length) {
      const head = this.outputQueue[0];
      const available = head.length - this.outputOffset;
      const count = Math.min(channel.length - outputIndex, available);
      for (let i = 0; i < count; i++) {
        let value = head[this.outputOffset + i];
        if (this.fadeRemaining > 0) {
          value *= 1 - (this.fadeRemaining / 192);
          this.fadeRemaining--;
        }
        channel[outputIndex + i] = value;
      }
      outputIndex += count;
      this.outputOffset += count;
      this.outputSamples -= count;
      if (this.outputOffset >= head.length) {
        this.outputQueue.shift();
        this.outputOffset = 0;
      }
    }

    if (this.playing && this.outputSamples === 0 && this.outputQueue.length === 0) {
      this.playing = false;
      this.forceOutput = false;
      this.port.postMessage({ type: 'output-drained' });
    }
  }

  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0];
    if (this.captureEnabled && input && input.length) {
      for (let i = 0; i < input.length; i++) this.micPending.push(input[i]);
      this.emitMicChunks();
    }

    const output = outputs[0];
    if (output && output.length) {
      this.renderOutput(output[0]);
      for (let channelIndex = 1; channelIndex < output.length; channelIndex++) {
        output[channelIndex].set(output[0]);
      }
    }
    return true;
  }
}

registerProcessor('crew-live-audio', CrewLiveAudioProcessor);
