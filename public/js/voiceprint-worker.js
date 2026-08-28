'use strict';

importScripts('/js/ort.min.js');

class MelFbankExtractor {
  constructor() {
    this.sampleRate = 16000;
    this.numMelBins = 80;
    this.frameLength = 400;
    this.frameShift = 160;
    this.nFft = 512;
    this.numFftBins = 257;
    this.window = new Float32Array(this.frameLength);
    for (let i = 0; i < this.frameLength; i++) {
      this.window[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (this.frameLength - 1));
    }
    this.melFilters = this.createMelFilterbank();
  }

  hzToMel(hz) {
    return 2595 * Math.log10(1 + hz / 700);
  }

  melToHz(mel) {
    return 700 * (Math.pow(10, mel / 2595) - 1);
  }

  createMelFilterbank() {
    const lowMel = this.hzToMel(20);
    const highMel = this.hzToMel(7600);
    const points = new Float32Array(this.numMelBins + 2);
    for (let i = 0; i < points.length; i++) {
      points[i] = lowMel + i * (highMel - lowMel) / (this.numMelBins + 1);
    }
    const filters = [];
    for (let m = 1; m <= this.numMelBins; m++) {
      const filter = new Float32Array(this.numFftBins);
      for (let k = 0; k < this.numFftBins; k++) {
        const mel = this.hzToMel(k * this.sampleRate / this.nFft);
        if (mel >= points[m - 1] && mel <= points[m]) {
          filter[k] = (mel - points[m - 1]) / (points[m] - points[m - 1]);
        } else if (mel > points[m] && mel <= points[m + 1]) {
          filter[k] = (points[m + 1] - mel) / (points[m + 1] - points[m]);
        }
      }
      filters.push(filter);
    }
    return filters;
  }

  fft(re, im) {
    const n = this.nFft;
    let j = 0;
    for (let i = 0; i < n - 1; i++) {
      if (i < j) {
        const tr = re[i]; re[i] = re[j]; re[j] = tr;
        const ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
      let k = n >> 1;
      while (k <= j) {
        j -= k;
        k >>= 1;
      }
      j += k;
    }
    for (let length = 2; length <= n; length <<= 1) {
      const half = length >> 1;
      const angle = -2 * Math.PI / length;
      const stepRe = Math.cos(angle);
      const stepIm = Math.sin(angle);
      for (let i = 0; i < n; i += length) {
        let wr = 1;
        let wi = 0;
        for (let k = 0; k < half; k++) {
          const ur = re[i + k];
          const ui = im[i + k];
          const vr = re[i + k + half] * wr - im[i + k + half] * wi;
          const vi = re[i + k + half] * wi + im[i + k + half] * wr;
          re[i + k] = ur + vr;
          im[i + k] = ui + vi;
          re[i + k + half] = ur - vr;
          im[i + k + half] = ui - vi;
          const nextWr = wr * stepRe - wi * stepIm;
          wi = wr * stepIm + wi * stepRe;
          wr = nextWr;
        }
      }
    }
  }

  extract(samples) {
    if (!samples || samples.length < this.frameLength) throw new Error('聲紋樣本過短');
    const frameCount = Math.floor((samples.length - this.frameLength) / this.frameShift) + 1;
    const fbank = new Float32Array(frameCount * this.numMelBins);
    let maxAbs = 0;
    for (let i = 0; i < Math.min(1000, samples.length); i++) maxAbs = Math.max(maxAbs, Math.abs(samples[i]));
    const scale = maxAbs <= 1.5 ? 32768 : 1;

    for (let frame = 0; frame < frameCount; frame++) {
      const start = frame * this.frameShift;
      const re = new Float32Array(this.nFft);
      const im = new Float32Array(this.nFft);
      let previous = (start > 0 ? samples[start - 1] : samples[start]) * scale;
      for (let n = 0; n < this.frameLength; n++) {
        const current = samples[start + n] * scale;
        re[n] = (current - 0.97 * previous) * this.window[n];
        previous = current;
      }
      this.fft(re, im);
      const power = new Float32Array(this.numFftBins);
      for (let k = 0; k < this.numFftBins; k++) power[k] = re[k] * re[k] + im[k] * im[k];
      for (let m = 0; m < this.numMelBins; m++) {
        let energy = 0;
        const filter = this.melFilters[m];
        for (let k = 0; k < this.numFftBins; k++) energy += power[k] * filter[k];
        fbank[frame * this.numMelBins + m] = Math.log(Math.max(1e-6, energy));
      }
    }

    for (let m = 0; m < this.numMelBins; m++) {
      let sum = 0;
      for (let frame = 0; frame < frameCount; frame++) sum += fbank[frame * this.numMelBins + m];
      const mean = sum / frameCount;
      for (let frame = 0; frame < frameCount; frame++) fbank[frame * this.numMelBins + m] -= mean;
    }
    return { data: fbank, frameCount };
  }
}

let session = null;
const extractor = new MelFbankExtractor();

async function initialize() {
  if (session) return;
  ort.env.wasm.wasmPaths = self.location.origin + '/js/';
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
  session = await ort.InferenceSession.create('/models/3dspeaker_campplus.onnx', {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all'
  });
}

async function embed(samples) {
  await initialize();
  if (!samples || samples.length < 3200) throw new Error('請說話至少 0.2 秒');
  const features = extractor.extract(samples);
  if (features.frameCount < 15) throw new Error('有效聲音特徵不足');
  const tensor = new ort.Tensor('float32', features.data, [1, features.frameCount, 80]);
  const inputName = session.inputNames[0] || 'x';
  const result = await session.run({ [inputName]: tensor });
  const outputName = session.outputNames[0] || Object.keys(result)[0];
  const raw = result[outputName] && result[outputName].data;
  if (!raw) throw new Error('聲紋模型沒有輸出');
  const embedding = new Float32Array(raw);
  let norm = 0;
  for (let i = 0; i < embedding.length; i++) norm += embedding[i] * embedding[i];
  norm = Math.sqrt(norm);
  if (!Number.isFinite(norm) || norm < 1e-6) throw new Error('聲紋特徵無效');
  for (let i = 0; i < embedding.length; i++) embedding[i] /= norm;
  return embedding;
}

self.onmessage = async (event) => {
  const message = event.data || {};
  try {
    if (message.type === 'init') {
      await initialize();
      self.postMessage({ type: 'ready' });
    } else if (message.type === 'embed') {
      const embedding = await embed(new Float32Array(message.samples));
      self.postMessage({ type: 'result', id: message.id, embedding: embedding.buffer }, [embedding.buffer]);
    }
  } catch (error) {
    self.postMessage({ type: 'error', id: message.id, message: error && error.message ? error.message : String(error) });
  }
};
