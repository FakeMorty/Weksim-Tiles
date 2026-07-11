// Etap D (v1.23): Non-negative Matrix Factorisation for source refinement.
//
// The idea in plain terms:
//   Our spectrogram X (F freq bins × T time frames) is like a big grid where
//   colour = loudness. NMF factorises X ≈ W · H where:
//     W is (F × K) — K "sound shapes" (templates), each a column = "what
//         instrument sounds like across frequency"
//     H is (K × T) — K "when they play" curves, each a row = "when this
//         template is active over time"
//
// We use K=12 templates: 3 seed-initialised for each of (kick, snare, hihat,
// melody). NMF then refines the templates + activations to minimise
// Kullback-Leibler divergence, which matches audio perception better than
// squared error.
//
// Cost: reduced-resolution mel-like spectrum (128 bins) + halved time
// resolution + 40 iterations ≈ 300-600 ms on a 4-min track. Reasonable
// even on Iris Xe.
//
// Output: per-source activation curves — same length as original frames.
// These plug into the same onset picker we already use, but with cleaner
// signals than either HPSS bands or plain envelopes.

import { hzToBin } from './stft.js';

const NUM_TEMPLATES_PER_SOURCE = 3;
const SOURCES = ['kick', 'snare', 'hihat', 'melody'];
const K = SOURCES.length * NUM_TEMPLATES_PER_SOURCE; // 12

// Number of reduced mel-like bins. 128 is plenty for source detection and
// keeps the matrix small (128×12 = 1536 templates, ~6 KB).
const REDUCED_BINS = 128;

// NMF hyperparameters
const NUM_ITERATIONS = 40;
const EPS = 1e-9;

/**
 * Main entry: refine source activations via seeded NMF.
 *
 * @param {Float32Array} mag   full spectrogram (numFrames * numBins)
 * @param {number} numFrames
 * @param {number} numBins
 * @param {number} sr
 * @param {number} frameSize
 * @param {object} [opts]
 * @param {number} [opts.timeStride=2] halve time res by averaging pairs
 * @param {number} [opts.iterations=NUM_ITERATIONS]
 * @returns {{kick, snare, hihat, melody}} activation Float32Array per source,
 *   each of length numFrames (upsampled back from reduced time res)
 */
export function refineSourcesNMF(mag, numFrames, numBins, sr, frameSize, opts = {}) {
  const timeStride = opts.timeStride ?? 2;
  const iterations = opts.iterations ?? NUM_ITERATIONS;

  // 1) Reduce frequency resolution: pool `numBins` linear bins into
  //    REDUCED_BINS log-spaced ones (mel-ish without the exact scale).
  const binMap = buildLogBinMap(numBins, sr, frameSize, REDUCED_BINS);

  // 2) Reduce time resolution: average `timeStride` frames.
  const reducedT = Math.floor(numFrames / timeStride);
  if (reducedT < 20) {
    // Too short for meaningful NMF — bail
    return null;
  }

  // Build reduced spectrogram X (REDUCED_BINS × reducedT), column-major
  const X = new Float32Array(REDUCED_BINS * reducedT);
  buildReducedSpectrogram(mag, numFrames, numBins, binMap, timeStride, reducedT, X);

  // 3) Seed W with source-specific templates
  const W = new Float32Array(REDUCED_BINS * K); // column-major: col k at k*REDUCED_BINS
  const H = new Float32Array(K * reducedT);      // row-major:   row k at k*reducedT
  seedTemplates(W, binMap, sr, frameSize);
  randomInitH(H, reducedT);

  // 4) Multiplicative updates minimising KL divergence
  runNMF(X, W, H, REDUCED_BINS, K, reducedT, iterations);

  // 5) For each of the 4 sources, sum its 3 activation rows → one curve
  const perSource = {};
  for (let s = 0; s < SOURCES.length; s++) {
    const src = SOURCES[s];
    const summed = new Float32Array(reducedT);
    for (let t = 0; t < NUM_TEMPLATES_PER_SOURCE; t++) {
      const k = s * NUM_TEMPLATES_PER_SOURCE + t;
      const rowBase = k * reducedT;
      for (let f = 0; f < reducedT; f++) summed[f] += H[rowBase + f];
    }
    // Upsample back to numFrames (linear interpolation)
    perSource[src] = upsample(summed, reducedT, numFrames);
  }
  return perSource;
}

/** Log-space frequency bin map: for each reduced bin r, return [lo, hi] in original bins. */
function buildLogBinMap(numBins, sr, frameSize, reducedBins) {
  const map = [];
  const fMin = 30, fMax = Math.min(sr / 2, 16000);
  const logMin = Math.log(fMin), logMax = Math.log(fMax);
  for (let r = 0; r <= reducedBins; r++) {
    const hz = Math.exp(logMin + (r / reducedBins) * (logMax - logMin));
    const bin = Math.max(1, Math.min(numBins - 1, hzToBin(hz, sr, frameSize)));
    map.push(bin);
  }
  // Return as [lo, hi] pairs
  const ranges = [];
  for (let r = 0; r < reducedBins; r++) {
    const lo = map[r], hi = Math.max(lo + 1, map[r + 1]);
    ranges.push([lo, hi]);
  }
  return ranges;
}

/** Pool frequency bins + downsample time. Output X is column-major [f + t*F]. */
function buildReducedSpectrogram(mag, numFrames, numBins, binMap, timeStride, reducedT, X) {
  for (let t = 0; t < reducedT; t++) {
    for (let f = 0; f < REDUCED_BINS; f++) {
      const [lo, hi] = binMap[f];
      let sum = 0, cnt = 0;
      for (let dt = 0; dt < timeStride; dt++) {
        const frame = t * timeStride + dt;
        if (frame >= numFrames) break;
        const base = frame * numBins;
        for (let k = lo; k < hi; k++) sum += mag[base + k];
        cnt += (hi - lo);
      }
      X[t * REDUCED_BINS + f] = cnt > 0 ? (sum / timeStride) : 0;
    }
  }
}

/**
 * Seed W with source-shaped templates. Each source gets 3 templates so NMF
 * can specialise within the source (e.g. kick fundamental vs. kick attack).
 * Layout: W is column-major, column k starts at index k * REDUCED_BINS.
 */
function seedTemplates(W, binMap, sr, frameSize) {
  // Compute the centre frequency (Hz) of each reduced bin
  const centreHz = binMap.map(([lo, hi]) => {
    const midBin = (lo + hi) / 2;
    return midBin * sr / frameSize;
  });

  // Frequency profiles per source (Gaussian bumps in log-frequency)
  const profiles = {
    kick:   [[50, 30], [80, 40], [150, 60]],    // sub-bass fundamental + harmonics
    snare:  [[300, 120], [1500, 500], [3500, 1200]], // low crack, mid, high body
    hihat:  [[7000, 3000], [10000, 4000], [13000, 5000]], // high shimmer
    melody: [[400, 200], [1000, 500], [2500, 1200]],   // vocal/lead range
  };

  let col = 0;
  for (const src of SOURCES) {
    for (const [centre, width] of profiles[src]) {
      const base = col * REDUCED_BINS;
      let norm = 0;
      for (let f = 0; f < REDUCED_BINS; f++) {
        const hz = centreHz[f];
        // Log-Gaussian bump centred on `centre` with sigma≈`width`
        const d = Math.log(hz + 1) - Math.log(centre);
        const sigma = width / centre; // log-space sigma
        const v = Math.exp(-(d * d) / (2 * sigma * sigma));
        W[base + f] = v + 0.01; // small floor so NMF can adapt
        norm += v;
      }
      // Normalise column to unit sum
      if (norm > 0) {
        for (let f = 0; f < REDUCED_BINS; f++) W[base + f] /= norm;
      }
      col++;
    }
  }
}

/** Random H initialisation with small positive values. */
function randomInitH(H, reducedT) {
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  for (let i = 0; i < H.length; i++) H[i] = 0.1 + 0.9 * rand();
}

/**
 * NMF with multiplicative updates minimising KL divergence.
 *   H ← H .* (Wᵀ · (X ./ (W·H))) ./ (Wᵀ · 1)
 *   W ← W .* ((X ./ (W·H)) · Hᵀ) ./ (1 · Hᵀ)
 *
 * X is column-major (F × T), W is column-major (F × K), H is row-major (K × T).
 */
function runNMF(X, W, H, F, K, T, iterations) {
  const WH = new Float32Array(F * T);       // reconstruction, column-major
  const Q  = new Float32Array(F * T);       // X ./ WH
  const WtQ = new Float32Array(K * T);      // K × T, row-major
  const Wsum = new Float32Array(K);         // Σ over rows of W per column
  const QHt = new Float32Array(F * K);      // F × K, column-major
  const Hsum = new Float32Array(K);         // Σ over cols of H per row

  for (let iter = 0; iter < iterations; iter++) {
    // 1) WH = W · H (column-major result)
    matmul_WH(W, H, WH, F, K, T);

    // 2) Q = X ./ (WH + eps)
    for (let i = 0; i < F * T; i++) Q[i] = X[i] / (WH[i] + EPS);

    // ---- Update H ----
    // WtQ (K×T) = Wᵀ · Q
    matmul_WtQ(W, Q, WtQ, F, K, T);
    // Wsum[k] = Σ_f W[f,k]
    for (let k = 0; k < K; k++) {
      let s = 0;
      const base = k * F;
      for (let f = 0; f < F; f++) s += W[base + f];
      Wsum[k] = s + EPS;
    }
    // H[k,t] *= WtQ[k,t] / Wsum[k]
    for (let k = 0; k < K; k++) {
      const invW = 1 / Wsum[k];
      const rowBase = k * T;
      for (let t = 0; t < T; t++) {
        H[rowBase + t] *= WtQ[rowBase + t] * invW;
      }
    }

    // Recompute WH + Q with updated H (proper MU order)
    matmul_WH(W, H, WH, F, K, T);
    for (let i = 0; i < F * T; i++) Q[i] = X[i] / (WH[i] + EPS);

    // ---- Update W ----
    // QHt (F×K) = Q · Hᵀ
    matmul_QHt(Q, H, QHt, F, K, T);
    // Hsum[k] = Σ_t H[k,t]
    for (let k = 0; k < K; k++) {
      let s = 0;
      const rowBase = k * T;
      for (let t = 0; t < T; t++) s += H[rowBase + t];
      Hsum[k] = s + EPS;
    }
    // W[f,k] *= QHt[f,k] / Hsum[k]
    for (let k = 0; k < K; k++) {
      const invH = 1 / Hsum[k];
      const colBase = k * F;
      for (let f = 0; f < F; f++) {
        W[colBase + f] *= QHt[colBase + f] * invH;
      }
    }
  }
}

// W (F×K col-major) · H (K×T row-major) → out (F×T col-major)
function matmul_WH(W, H, out, F, K, T) {
  for (let t = 0; t < T; t++) {
    const outBase = t * F;
    for (let f = 0; f < F; f++) out[outBase + f] = 0;
    for (let k = 0; k < K; k++) {
      const h_kt = H[k * T + t];
      if (h_kt === 0) continue;
      const wBase = k * F;
      for (let f = 0; f < F; f++) {
        out[outBase + f] += W[wBase + f] * h_kt;
      }
    }
  }
}

// Wᵀ (K×F) · Q (F×T col-major) → out (K×T row-major)
function matmul_WtQ(W, Q, out, F, K, T) {
  for (let k = 0; k < K; k++) {
    const wBase = k * F;
    const outBase = k * T;
    for (let t = 0; t < T; t++) {
      let s = 0;
      const qBase = t * F;
      for (let f = 0; f < F; f++) s += W[wBase + f] * Q[qBase + f];
      out[outBase + t] = s;
    }
  }
}

// Q (F×T col-major) · Hᵀ (T×K) → out (F×K col-major)
function matmul_QHt(Q, H, out, F, K, T) {
  for (let k = 0; k < K; k++) {
    const outBase = k * F;
    const hBase = k * T;
    for (let f = 0; f < F; f++) out[outBase + f] = 0;
    for (let t = 0; t < T; t++) {
      const h_kt = H[hBase + t];
      if (h_kt === 0) continue;
      const qBase = t * F;
      for (let f = 0; f < F; f++) {
        out[outBase + f] += Q[qBase + f] * h_kt;
      }
    }
  }
}

/** Linear interpolation upsample from reducedT to numFrames. */
function upsample(src, reducedT, numFrames) {
  const out = new Float32Array(numFrames);
  const ratio = (reducedT - 1) / Math.max(1, numFrames - 1);
  for (let i = 0; i < numFrames; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(reducedT - 1, i0 + 1);
    const frac = x - i0;
    out[i] = src[i0] * (1 - frac) + src[i1] * frac;
  }
  return out;
}

export { SOURCES as NMF_SOURCES, K as NMF_COMPONENTS, REDUCED_BINS as NMF_REDUCED_BINS };
