// Multiband spectral flux + Superflux (Böck & Widmer 2013).
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

// Log-compress then half-wave-rectified positive difference per band.
// Logging BEFORE the difference (not after summing) matches the Superflux
// paper and stops loud broadband frames from drowning quiet onsets.
export function computeMultibandFlux(spec, sr, { logGamma = 10 } = {}) {
  const { mag, numFrames, numBins, frameSize } = spec;
  const ranges = bandRanges(sr, frameSize);
  const fluxBands = [];
  for (let b = 0; b < NUM_BANDS; b++) fluxBands.push(new Float32Array(numFrames));
  const fluxTotal = new Float32Array(numFrames);

  for (let f = 1; f < numFrames; f++) {
    const cur  = f * numBins;
    const prev = (f - 1) * numBins;
    for (let b = 0; b < NUM_BANDS; b++) {
      const [lo, hi] = ranges[b];
      let sum = 0;
      for (let k = lo; k < hi; k++) {
        const d = Math.log1p(logGamma * mag[cur + k]) - Math.log1p(logGamma * mag[prev + k]);
        if (d > 0) sum += d;
      }
      fluxBands[b][f] = sum;
      fluxTotal[f]   += sum;
    }
  }
  return { fluxBands, fluxTotal };
}

// Superflux: max-filter the previous log-spectrum across nearby frequency
// bins, then take the positive difference. Suppresses vibrato / tremolo
// false onsets and sharpens drum transients.
export function computeSuperflux(spec, sr, { muBins = 3, logGamma = 10, minHz = 20, maxHz = 16000 } = {}) {
  const { mag, numFrames, numBins, frameSize } = spec;
  const N = frameSize || (numBins - 1) * 2;
  const flux = new Float32Array(numFrames);
  const kMin = Math.max(1, hzToBin(minHz, sr, N));
  const kMax = Math.min(numBins - 1, Math.max(kMin + 1, hzToBin(maxHz, sr, N)));
  const prevMax = new Float32Array(numBins);
  const mu = Math.max(1, muBins | 0);

  for (let f = 1; f < numFrames; f++) {
    const prev = (f - 1) * numBins;
    const cur  = f * numBins;
    for (let k = kMin; k <= kMax; k++) {
      let m = 0;
      const lo = Math.max(kMin, k - mu);
      const hi = Math.min(kMax, k + mu);
      for (let j = lo; j <= hi; j++) {
        const v = Math.log1p(logGamma * mag[prev + j]);
        if (v > m) m = v;
      }
      prevMax[k] = m;
    }
    let sum = 0;
    for (let k = kMin; k <= kMax; k++) {
      const d = Math.log1p(logGamma * mag[cur + k]) - prevMax[k];
      if (d > 0) sum += d;
    }
    flux[f] = sum;
  }
  return flux;
}

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

export function medianValue(sig) {
  const n = sig.length;
  if (!n) return 1e-9;
  const tmp = Array.from(sig);
  tmp.sort((a, b) => a - b);
  const mid = tmp[n >> 1];
  return mid > 1e-9 ? mid : 1e-9;
}

export function scaleToMedian(sig, target = 1) {
  const g = target / medianValue(sig);
  const out = new Float32Array(sig.length);
  for (let i = 0; i < sig.length; i++) out[i] = sig[i] * g;
  return out;
}

export function blendNovelty(parts) {
  // parts: [{ sig, weight }, ...] — each scaled to median 1 then mixed.
  const n = parts[0].sig.length;
  const out = new Float32Array(n);
  let wsum = 0;
  for (const p of parts) {
    if (!p || !p.sig || !p.weight) continue;
    const scaled = scaleToMedian(p.sig, 1);
    const w = p.weight;
    wsum += w;
    for (let i = 0; i < n; i++) out[i] += scaled[i] * w;
  }
  if (wsum > 0 && wsum !== 1) {
    const inv = 1 / wsum;
    for (let i = 0; i < n; i++) out[i] *= inv;
  }
  return out;
}

// drums: kick+snare body, hats almost off (they flood 16th-note maps).
// vocal: formant / presence, almost no kick.
// classic: balanced, hats still de-emphasised.
export const MODE_WEIGHTS = {
  drums:   [2.1, 2.3, 1.35, 0.28, 0.40, 0.06],
  classic: [1.15, 1.25, 1.05, 1.00, 0.85, 0.32],
  vocal:   [0.06, 0.12, 0.75, 1.85, 2.15, 0.45],
};
