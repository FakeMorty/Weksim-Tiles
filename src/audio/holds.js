// Etap 3: Hold Notes v2.
// Detects sustained musical notes (long vocals, held synth chords, guitar chords)
// using pre-computed harmonic energy envelopes (built in the worker from HPSS).
//
// Algorithm per onset:
//   1. Look at harmonic energy in a window after the onset time.
//   2. Compute a smoothed envelope of that energy.
//   3. If envelope stays above hysteresis-high threshold for >= minHoldSec,
//      it's a hold. End time = when envelope drops below hysteresis-low.
//   4. Snap the resulting length to nearest half/quarter beat (musical).
//   5. Merge if next onset is within 80ms AND harmonic sustain persists.
//
// Also detects vocal accents: short spikes in the 2-4 kHz band on the
// harmonic spectrum (vocal formant presence).
//
// IMPORTANT: harmonic energy envelopes are computed IN THE WORKER and
// passed as small Float32Arrays (~50 KB total on a 4min track) instead of
// the full harmonic spectrogram (~80 MB) — much cheaper transfer.

import { hzToBin } from './stft.js';

/**
 * Compute frame-level harmonic energy in a specific frequency range.
 * Called ONLY in worker.js — the analyzer receives pre-computed envelopes.
 */
export function bandEnergyFromMag(harmonicMag, numFrames, numBins, sr, frameSize, loHz, hiHz) {
  const loBin = Math.max(1, hzToBin(loHz, sr, frameSize));
  const hiBin = Math.min(numBins - 1, hzToBin(hiHz, sr, frameSize));
  const out = new Float32Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    let sum = 0;
    const base = f * numBins;
    for (let k = loBin; k < hiBin; k++) sum += harmonicMag[base + k];
    out[f] = sum;
  }
  return out;
}

/**
 * Build all envelopes needed by detectHolds. Called in worker.
 */
export function buildHarmonicEnvelopes(harmonicMag, numFrames, numBins, sr, frameSize) {
  return {
    // Broad range for general sustain detection
    eDrums:   bandEnergyFromMag(harmonicMag, numFrames, numBins, sr, frameSize, 80,  3000),
    eClassic: bandEnergyFromMag(harmonicMag, numFrames, numBins, sr, frameSize, 120, 6000),
    eVocal:   bandEnergyFromMag(harmonicMag, numFrames, numBins, sr, frameSize, 200, 4000),
    // Narrow vocal-formant band for accent detection
    eVocalFormant: bandEnergyFromMag(harmonicMag, numFrames, numBins, sr, frameSize, 2000, 4000),
  };
}

// Smooth an envelope with a simple centered box filter.
function smoothBox(sig, halfWin) {
  const N = sig.length;
  const out = new Float32Array(N);
  const win = halfWin * 2 + 1;
  let sum = 0;
  for (let i = 0; i < Math.min(win, N); i++) sum += sig[i];
  for (let i = 0; i < N; i++) {
    const lo = i - halfWin, hi = i + halfWin;
    if (lo > 0) sum -= sig[lo - 1] ?? 0;
    if (hi < N) sum += sig[hi] ?? 0;
    const cnt = Math.min(hi, N - 1) - Math.max(0, lo) + 1;
    out[i] = sum / cnt;
  }
  return out;
}

/**
 * Detect holds for each onset using pre-computed harmonic envelopes.
 *
 * @param {Array<{time,strength}>} onsets
 * @param {object} envelopes  { eDrums, eClassic, eVocal, eVocalFormant } from buildHarmonicEnvelopes
 * @param {number} framesPerSec
 * @param {number[]} beatTimes  from beat tracking
 * @param {number} bpm
 * @param {string} modeStr  'drums' | 'classic' | 'vocal'
 * @param {object} opts     { holdEnable, holdMode (0=off,1=auto,2=lots) }
 * @returns {Array<{time, endTime, isHold, strength, isVocalAccent}>}
 */
export function detectHolds(onsets, envelopes, framesPerSec,
                             beatTimes, bpm, modeStr, opts) {
  const holdEnable = opts.holdEnable !== false;
  const holdBias = opts.holdMode ?? 1; // 0=off, 1=auto, 2=lots
  const beatLen = bpm > 40 ? 60 / bpm : 0.5;

  // Per-mode parameters + which envelope to use
  const params = modeStr === 'vocal'
    ? { env: envelopes.eVocal,   minHold: 0.35, maxHold: 2.20, probMul: 1.6 }
    : modeStr === 'classic'
      ? { env: envelopes.eClassic, minHold: 0.34, maxHold: 1.60, probMul: 1.0 }
      : { env: envelopes.eDrums,   minHold: 0.28, maxHold: 1.00, probMul: 0.55 };

  const eFull  = params.env;
  const eVocal = envelopes.eVocalFormant;
  const numFrames = eFull.length;
  const eSmooth = smoothBox(eFull, 3);
  const eVocalSmooth = smoothBox(eVocal, 2);

  // Adaptive threshold (median of the whole envelope)
  const sorted = [...eSmooth].sort((a, b) => a - b);
  const eMedian = sorted[sorted.length >> 1] || 1e-6;
  const HIGH_THR = eMedian * (holdBias === 2 ? 0.7 : 1.0);
  const LOW_THR  = eMedian * (holdBias === 2 ? 0.45 : 0.65);
  const vocalMedian = ([...eVocalSmooth].sort((a, b) => a - b))[eVocalSmooth.length >> 1] || 1e-6;

  const holdProbBase = (holdBias === 2 ? 0.55 : holdBias === 1 ? 0.35 : 0) * params.probMul;

  const events = [];
  const timeToFrame = (t) => Math.min(numFrames - 1, Math.max(0, Math.floor(t * framesPerSec)));
  let mergedInto = -1; // index of previous event that consumed this onset

  for (let i = 0; i < onsets.length; i++) {
    const t = onsets[i].time;
    const nextT = onsets[i + 1]?.time ?? Infinity;
    let holdDur = 0;
    let isVocalAccent = false;

    // Check for vocal accent (short but strong spike in vocal band)
    const f0 = timeToFrame(t);
    if (eVocalSmooth[f0] > vocalMedian * 2.5) isVocalAccent = true;

    if (holdEnable) {
      // Look at harmonic energy first. If clearly above threshold, this IS
      // a sustain — probability only gates borderline cases.
      const energyRatio = eSmooth[f0] / HIGH_THR;
      const strongSustain = energyRatio >= 1.4;    // clearly a hold
      const borderline = energyRatio >= 0.85;      // maybe a hold
      const shouldProbe = strongSustain
        || (borderline && Math.random() < holdProbBase * 1.5)
        || Math.random() < holdProbBase;

      if (shouldProbe && eSmooth[f0] > LOW_THR) {
        // Follow the envelope with hysteresis until it drops below LOW_THR
        const startFrame = f0 + 1;
        const maxFrames = Math.floor(params.maxHold * framesPerSec);
        let stayFrames = 0;
        let endFrame = startFrame;
        for (let f = startFrame; f < numFrames && stayFrames < maxFrames; f++) {
          stayFrames++;
          if (eSmooth[f] < LOW_THR) { endFrame = f; break; }
          endFrame = f;
        }
        holdDur = (endFrame - f0) / framesPerSec;
      }

      // Musical constraints
      if (holdDur < params.minHold) holdDur = 0;
      const gap = nextT - t - 0.12;
      if (holdDur > gap && gap > params.minHold) holdDur = gap;
      else if (holdDur > gap) holdDur = 0;
      if (holdDur > params.maxHold) holdDur = params.maxHold;

      // Snap to nearest 0.5 beat if BPM known and hold is long enough
      if (bpm > 50 && holdDur > 0.35) {
        // Snap to nearest tracked beat end if we have beat times
        if (beatTimes.length > 8) {
          const idealEnd = t + holdDur;
          // Find nearest beat >= t + minHold
          let bestEnd = idealEnd;
          let bestDiff = Infinity;
          for (const b of beatTimes) {
            if (b < t + params.minHold) continue;
            if (b > t + params.maxHold) break;
            const d = Math.abs(b - idealEnd);
            if (d < bestDiff && d < 0.15) { bestDiff = d; bestEnd = b; }
          }
          holdDur = bestEnd - t;
        } else {
          const beats = Math.round(holdDur / beatLen * 2) / 2;
          const snapped = Math.max(params.minHold, beats * beatLen);
          if (snapped <= params.maxHold && snapped < gap) holdDur = snapped;
        }
      }
    }

    // Try to merge with previous event if it was a hold and this onset is
    // very close AND harmonic energy stayed high between them.
    if (events.length && (t - events[events.length - 1].time < 0.08)) {
      const prev = events[events.length - 1];
      if (prev.isHold && eSmooth[f0] > LOW_THR) {
        // Extend previous hold to cover this onset instead of making a new one
        if (holdDur > 0) prev.endTime = Math.max(prev.endTime, t + holdDur);
        continue;
      }
    }

    events.push({
      time: t,
      endTime: t + holdDur,
      isHold: holdDur >= params.minHold,
      strength: onsets[i].strength ?? 1,
      isVocalAccent,
    });
  }

  return events;
}
