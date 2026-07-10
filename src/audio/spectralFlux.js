// Multiband spectral flux. Splits the positive-half spectrum into 6 perceptual
// bands and computes half-wave-rectified log-compressed flux per band + total.
//
// Bands (Hz):
//   0 sub-bass    20 – 60     (kick fundamentals)
//   1 bass        60 – 250    (kicks, bass guitar)
//   2 low-mid     250 – 500   (snare body, low vocals)
//   3 mid         500 – 2000  (main vocal range, guitar)
//   4 high-mid    2000 – 4000 (vocal presence, snare crack)
//   5 high        4000 – 16000 (hats, cymbals, sibilants)

import { hzToBin } from './stft.js';

export const BAND_EDGES = [20, 60, 250, 500, 2000, 4000, 16000];
export const NUM_BANDS = BAND_EDGES.length - 1;

// Precompute (lowBin, highBin) per band for a given sr + N.
function bandRanges(sr, N) {
  const numBins = N / 2 + 1;
  const ranges = [];
  for (let b = 0; b < NUM_BANDS; b++) {
    const lo = Math.max(1, hzToBin(BAND_EDGES[b],     sr, N));
    const hi = Math.min(numBins - 1, hzToBin(BAND_EDGES[b + 1], sr, N));
    ranges.push([lo, Math.max(lo + 1, hi)]);
  }
  return ranges;
}

// Compute per-band spectral flux from a spectrogram { mag, numFrames, numBins }.
// Returns { fluxBands: Float32Array[NUM_BANDS], fluxTotal: Float32Array }.
// Each array has length numFrames; flux[0] is 0 (no previous frame).
export function computeMultibandFlux(spec, sr) {
  const { mag, numFrames, numBins, frameSize } = spec;
  const ranges = bandRanges(sr, frameSize);
  const fluxBands = [];
  for (let b = 0; b < NUM_BANDS; b++) fluxBands.push(new Float32Array(numFrames));
  const fluxTotal = new Float32Array(numFrames);

  const C = 1000; // log compression constant

  for (let f = 1; f < numFrames; f++) {
    const cur  = f * numBins;
    const prev = (f - 1) * numBins;
    for (let b = 0; b < NUM_BANDS; b++) {
      const [lo, hi] = ranges[b];
      let sum = 0;
      for (let k = lo; k < hi; k++) {
        const d = mag[cur + k] - mag[prev + k];
        if (d > 0) sum += d;
      }
      const compressed = Math.log1p(C * sum);
      fluxBands[b][f] = compressed;
      fluxTotal[f]   += compressed;
    }
  }
  return { fluxBands, fluxTotal };
}

// Weighted sum of bands into a single novelty function, according to a mode.
// Weights are per-band multipliers. Missing bands default to 1.
export function weightedFlux(fluxBands, weights) {
  const N = fluxBands[0].length;
  const out = new Float32Array(N);
  for (let b = 0; b < NUM_BANDS; b++) {
    const w = weights[b] ?? 1;
    if (w === 0) continue;
    const band = fluxBands[b];
    for (let i = 0; i < N; i++) out[i] += band[i] * w;
  }
  return out;
}

// Mode presets. drums = emphasise low bands, vocal = mid/high-mid, classic = balanced.
export const MODE_WEIGHTS = {
  drums:   [1.4, 1.8, 1.0, 0.5, 0.4, 0.6],
  classic: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
  vocal:   [0.3, 0.4, 0.9, 1.6, 1.8, 0.9],
};
