// Radix-2 iterative Cooley-Tukey FFT + Hann window + STFT framing.
// Real-input helper produces magnitude spectrum for the positive half.
// N must be a power of 2. Typical: N=2048 at sr=44100 → 21.5 Hz / bin, 86 hops/s at hop=512.

// Precompute bit-reversal permutation for a given N.
const revCache = new Map();
function bitReversalTable(N) {
  const cached = revCache.get(N);
  if (cached) return cached;
  const bits = Math.log2(N) | 0;
  const table = new Uint32Array(N);
  for (let i = 0; i < N; i++) {
    let x = i, r = 0;
    for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>>= 1; }
    table[i] = r;
  }
  revCache.set(N, table);
  return table;
}

// Precompute twiddle factors (cos/sin) for a given N.
const twiddleCache = new Map();
function twiddleFactors(N) {
  const cached = twiddleCache.get(N);
  if (cached) return cached;
  const cos = new Float32Array(N / 2);
  const sin = new Float32Array(N / 2);
  for (let i = 0; i < N / 2; i++) {
    const ang = -2 * Math.PI * i / N;
    cos[i] = Math.cos(ang);
    sin[i] = Math.sin(ang);
  }
  const t = { cos, sin };
  twiddleCache.set(N, t);
  return t;
}

// In-place FFT. re/im are Float32Array of length N (power of 2).
// After the call, re/im contain the complex spectrum.
export function fftInPlace(re, im) {
  const N = re.length;
  const rev = bitReversalTable(N);
  // Bit-reverse permutation
  for (let i = 0; i < N; i++) {
    const j = rev[i];
    if (j > i) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }
  const { cos, sin } = twiddleFactors(N);
  // Cooley-Tukey butterfly
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1;
    const step = N / size;
    for (let i = 0; i < N; i += size) {
      for (let j = 0; j < half; j++) {
        const k = j * step;
        const tRe =  cos[k] * re[i + j + half] - sin[k] * im[i + j + half];
        const tIm =  cos[k] * im[i + j + half] + sin[k] * re[i + j + half];
        re[i + j + half] = re[i + j] - tRe;
        im[i + j + half] = im[i + j] - tIm;
        re[i + j] += tRe;
        im[i + j] += tIm;
      }
    }
  }
}

// Hann window, precomputed per size.
const hannCache = new Map();
export function hannWindow(N) {
  const cached = hannCache.get(N);
  if (cached) return cached;
  const w = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    w[n] = 0.5 * (1 - Math.cos(2 * Math.PI * n / (N - 1)));
  }
  hannCache.set(N, w);
  return w;
}

// Compute full spectrogram of magnitudes (numFrames × (N/2 + 1)).
// Returns { mag: Float32Array[N/2+1] per frame concatenated, numFrames, numBins }
// Storage is 1D for cache-friendliness: mag[frame * numBins + bin].
export function computeSpectrogram(signal, frameSize = 2048, hop = 512) {
  const win = hannWindow(frameSize);
  const numBins = frameSize / 2 + 1;
  const numFrames = Math.max(1, Math.floor((signal.length - frameSize) / hop) + 1);
  const mag = new Float32Array(numFrames * numBins);
  const re = new Float32Array(frameSize);
  const im = new Float32Array(frameSize);

  for (let f = 0; f < numFrames; f++) {
    const offset = f * hop;
    // Copy windowed frame into re, zero im
    for (let i = 0; i < frameSize; i++) {
      re[i] = signal[offset + i] * win[i];
      im[i] = 0;
    }
    fftInPlace(re, im);
    // Magnitude, positive half (0..N/2)
    const base = f * numBins;
    for (let k = 0; k < numBins; k++) {
      const r = re[k], j = im[k];
      mag[base + k] = Math.sqrt(r * r + j * j);
    }
  }
  return { mag, numFrames, numBins, frameSize, hop };
}

// Bin index of a given Hz for sampleRate sr and frameSize N.
export function hzToBin(hz, sr, N) {
  return Math.round(hz * N / sr);
}
