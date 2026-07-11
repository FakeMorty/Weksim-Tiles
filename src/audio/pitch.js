// YIN pitch tracker (de Cheveigné & Kawahara 2002).
//
// A cheap, robust monophonic pitch detector. Works on any signal that has a
// clear fundamental frequency: vocals, single-note instruments, held chords
// (picks up the root). Does NOT work on unpitched percussion, noise, or
// dense polyphony — that's fine, we skip those frames.
//
// Why YIN: FFT-based pitch is unreliable at low frequencies (< 200 Hz) and
// needs high resolution. YIN works in the time domain via difference
// function + cumulative mean normalisation, and it's O(N·maxTau) which is
// fast enough to run on ~5-frame windows through a 4-minute track in <100ms.

const MIN_F0_HZ = 65;     // ~C2, low male vocal
const MAX_F0_HZ = 1200;   // ~D6, high female vocal / lead guitar
const YIN_THRESHOLD = 0.15;

/**
 * Estimate fundamental frequency of a single audio window.
 * @param {Float32Array} window   audio samples (typically 2048 samples)
 * @param {number} sampleRate
 * @returns {{f0: number, confidence: number}}  f0 in Hz, 0 if unvoiced
 */
export function detectPitchYIN(window, sampleRate) {
  const N = window.length;
  const maxTau = Math.min(Math.floor(sampleRate / MIN_F0_HZ), Math.floor(N / 2));
  const minTau = Math.max(2, Math.floor(sampleRate / MAX_F0_HZ));

  // Difference function d(tau) = sum over i of (x[i] - x[i+tau])²
  const d = new Float32Array(maxTau + 1);
  for (let tau = minTau; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < N - tau; i++) {
      const diff = window[i] - window[i + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }

  // Cumulative mean normalised difference — this is what makes YIN robust
  // (unlike raw autocorrelation which prefers tau=0 or half-period).
  const cmnd = new Float32Array(maxTau + 1);
  cmnd[minTau] = 1;
  let runningSum = 0;
  for (let tau = minTau + 1; tau <= maxTau; tau++) {
    runningSum += d[tau];
    cmnd[tau] = d[tau] * tau / (runningSum || 1e-12);
  }

  // Find first tau where cmnd dips below threshold — that's the period
  let bestTau = -1;
  for (let tau = minTau + 1; tau < maxTau; tau++) {
    if (cmnd[tau] < YIN_THRESHOLD) {
      // Refine: find local minimum around this tau
      while (tau + 1 < maxTau && cmnd[tau + 1] < cmnd[tau]) tau++;
      bestTau = tau;
      break;
    }
  }
  if (bestTau < 0) return { f0: 0, confidence: 0 };

  // Parabolic interpolation for sub-sample accuracy
  const x0 = cmnd[bestTau - 1] || cmnd[bestTau];
  const x1 = cmnd[bestTau];
  const x2 = cmnd[bestTau + 1] || cmnd[bestTau];
  const denom = 2 * (x0 - 2 * x1 + x2);
  const shift = denom === 0 ? 0 : (x0 - x2) / denom;
  const refinedTau = bestTau + shift;

  const f0 = sampleRate / refinedTau;
  // Confidence is 1 - cmnd value at chosen tau. Below 0.85 = unvoiced-ish.
  const confidence = 1 - x1;
  return { f0, confidence };
}

/**
 * Track pitch across the whole track.
 *
 * Runs YIN on windows aligned to STFT hops so results are frame-aligned with
 * everything else in the pipeline. For each frame:
 *   - if we got a confident pitch, record it
 *   - otherwise record 0 (unvoiced/noise/silence)
 *
 * @param {Float32Array} pcm       mono PCM samples
 * @param {number} sampleRate
 * @param {number} hopSize         same hop as STFT (usually 512)
 * @param {number} winSize         analysis window (2048 works well)
 * @returns {Float32Array}         one f0 estimate per frame (Hz, 0 = unvoiced)
 */
export function trackPitch(pcm, sampleRate, hopSize = 512, winSize = 2048) {
  const numFrames = Math.max(1, Math.floor((pcm.length - winSize) / hopSize) + 1);
  const f0Track = new Float32Array(numFrames);

  for (let f = 0; f < numFrames; f++) {
    const start = f * hopSize;
    const window = pcm.subarray(start, start + winSize);
    // Skip near-silent frames — YIN loves to invent pitch out of quiet noise
    let rms = 0;
    for (let i = 0; i < winSize; i += 8) { const s = window[i] || 0; rms += s * s; }
    rms = Math.sqrt(rms / (winSize / 8));
    if (rms < 0.008) { f0Track[f] = 0; continue; }

    const { f0, confidence } = detectPitchYIN(window, sampleRate);
    // Confidence threshold bumped from 0.5 to 0.75 — 0.5 accepts decaying
    // kick transients as valid pitch (60Hz kick has real periodicity).
    f0Track[f] = confidence > 0.75 ? f0 : 0;
  }
  return f0Track;
}

/**
 * Find stable-pitch regions in a pitch track. A region is "stable" if the
 * f0 stays within ±semitoneTolerance for at least `minDurationSec`.
 * Returns list of { startSec, endSec, meanF0, stability } where stability
 * is 0..1 (1 = laser-straight held tone).
 *
 * These regions are strong HOLD-note candidates — much more reliable than
 * envelope-only detection which flags any sustained noise as a hold.
 *
 * @param {Float32Array} f0Track           from trackPitch()
 * @param {number} framesPerSec
 * @param {number} semitoneTolerance       max wobble in semitones (default 0.5)
 * @param {number} minDurationSec          shortest region we care about (default 0.28)
 */
export function findStablePitchRegions(f0Track, framesPerSec, semitoneTolerance = 0.5, minDurationSec = 0.28) {
  const N = f0Track.length;
  const minFrames = Math.ceil(minDurationSec * framesPerSec);
  const regions = [];

  let i = 0;
  while (i < N) {
    // Skip unvoiced frames
    if (f0Track[i] <= 0) { i++; continue; }

    // Start of a candidate region
    const startFrame = i;
    const startF0 = f0Track[i];
    let sumF0 = startF0;
    let count = 1;
    // A short gap of 1-2 unvoiced frames doesn't break the region (vibrato
    // troughs, breaths etc.)
    let gap = 0;
    let j = i + 1;
    while (j < N) {
      const f0 = f0Track[j];
      if (f0 <= 0) {
        gap++;
        if (gap > 2) break;
        j++;
        continue;
      }
      // Check if pitch is still within tolerance of running mean
      const meanSoFar = sumF0 / count;
      const semitoneDiff = 12 * Math.log2(f0 / meanSoFar);
      if (Math.abs(semitoneDiff) > semitoneTolerance) break;
      sumF0 += f0;
      count++;
      gap = 0;
      j++;
    }

    const endFrame = j - 1 - gap;
    if (endFrame - startFrame + 1 >= minFrames) {
      // Stability: 1 minus normalised std deviation in semitones
      let variance = 0;
      const mean = sumF0 / count;
      for (let k = startFrame; k <= endFrame; k++) {
        if (f0Track[k] <= 0) continue;
        const dSt = 12 * Math.log2(f0Track[k] / mean);
        variance += dSt * dSt;
      }
      const std = Math.sqrt(variance / count);
      const stability = Math.max(0, 1 - std / semitoneTolerance);

      regions.push({
        startSec: startFrame / framesPerSec,
        endSec: endFrame / framesPerSec,
        meanF0: mean,
        stability,
      });
    }
    i = j;
  }
  return regions;
}

/**
 * Given an onset time, find the stable-pitch region (if any) that STARTS
 * at or just after this onset. Used by hold detection to decide "this
 * onset kicked off a sustained note".
 *
 * @param {number} onsetTime
 * @param {Array} pitchRegions   from findStablePitchRegions()
 * @param {number} toleranceSec  how far after the onset the region may start (default 0.08)
 * @returns matching region or null
 */
export function findRegionForOnset(onsetTime, pitchRegions, toleranceSec = 0.08) {
  for (const r of pitchRegions) {
    if (r.startSec >= onsetTime - 0.02 && r.startSec <= onsetTime + toleranceSec) {
      return r;
    }
  }
  return null;
}
