// Etap 1: new analyzer. Spawns a Web Worker that does STFT + multiband spectral
// flux + adaptive peak-picking + autocorrelation BPM. This module then converts
// the returned onsets into the note layout the game expects (with HOLD detection
// and lane distribution, ported from v1.1 with minor cleanup).

import { limitDensity, DIFFICULTY_PRESETS } from './density.js';
import { generateMap } from './mapgen.js';
import { detectHolds } from './holds.js';
import { sha1, buildKey, getCached, putCached } from './cache.js';

let worker = null;
function getWorker() {
  if (worker) return worker;
  // Vite/Electron file:// friendly: module worker with relative URL
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  return worker;
}

// Downmix a decoded AudioBuffer to mono Float32Array.
function downmix(audioBuffer) {
  const n = audioBuffer.length;
  const ch = audioBuffer.numberOfChannels;
  const out = new Float32Array(n);
  for (let c = 0; c < ch; c++) {
    const cd = audioBuffer.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += cd[i] / ch;
  }
  return out;
}

/**
 * @param {AudioBuffer} audioBuffer
 * @param {string} modeStr  'drums' | 'classic' | 'vocal'
 * @param {number} sens     0.5..2.5
 * @param {object} opts     { holdEnable, holdMode, dual, smartLane, onProgress? }
 * @returns {Promise<{notes,bpm,bpmConfidence,times,analysisMs}>}
 */
export async function analyzeTrack(audioBuffer, modeStr, sens, opts) {
  const sr = audioBuffer.sampleRate;
  const preset = DIFFICULTY_PRESETS[opts.difficulty] || DIFFICULTY_PRESETS.normal;

  // Etap 10: IndexedDB cache. Hash the raw file bytes if provided, look up
  // a fully-baked map for this (file × mode × difficulty × sens × ...).
  // Cache hits complete in ~10 ms instead of 5-8 s.
  let cacheKey = null;
  if (opts.fileBytes) {
    try {
      const hash = await sha1(opts.fileBytes);
      cacheKey = buildKey(hash, {
        mode: modeStr,
        difficulty: opts.difficulty || 'normal',
        hpssMode: opts.hpssMode || 'hard',
        nmfMode: opts.nmfMode || 'auto',
        sens,
        holdMode: opts.holdMode ?? 1,
        holdEnable: !!opts.holdEnable,
        dual: !!opts.dual,
        smartLane: !!opts.smartLane,
      });
      const cached = await getCached(cacheKey);
      if (cached) {
        opts.onProgress?.(1, 'cache');
        // Re-hydrate: notes come back as plain objects (structured clone
        // preserved their shape); TypedArrays inside also survived.
        return {
          ...cached,
          fromCache: true,
        };
      }
    } catch (e) {
      console.warn('cache lookup failed, proceeding with fresh analysis:', e);
    }
  }

  const mono = downmix(audioBuffer);
  const w = getWorker();

  const result = await new Promise((resolve, reject) => {
    const onMessage = (e) => {
      const d = e.data;
      if (d.progress !== undefined) {
        opts.onProgress?.(d.progress, d.stage);
        return;
      }
      w.removeEventListener('message', onMessage);
      if (d.ok) resolve(d); else reject(new Error(d.error || 'worker failed'));
    };
    w.addEventListener('message', onMessage);
    // Transfer PCM ownership to worker — zero copy
    w.postMessage(
      {
        pcm: mono,
        sampleRate: sr,
        mode: modeStr,
        sens,
        // Etap 2: hpssMode = 'off' | 'hard' | 'soft' | 'iterative'
        hpssMode: opts.hpssMode ?? (opts.hpssLite === false ? 'off' : 'hard'),
        // Etap D (v1.23): nmfMode = 'off' | 'fast' | 'auto' | 'quality'
        nmfMode: opts.nmfMode ?? 'auto',
        snapSubdivision: preset.snapSubdivision,
      },
      [mono.buffer]
    );
  });

  // Build note events from onsets + HOLD detection (uses novelty as sustain proxy)
  let events = buildEvents(result, audioBuffer.duration, modeStr, opts);

  // Etap 6 (density cap): trim overly-dense sections down to a playable rate.
  // Difficulty preset controls the ceiling. HOLD notes are protected.
  const beforeCount = events.length;
  events = limitDensity(events, preset.maxNps);
  const droppedByDensity = beforeCount - events.length;

  // Etap 6: pattern-aware map generation. Uses tracked beats, event
  // strengths and difficulty preset to produce musically-coherent notes
  // instead of random-lane assignment.
  const out = generateMap(
    events,
    result.beatTimes || [],
    result.bpm,
    {
      chordProb: opts.dual ? preset.chordProb : 0,
      smartLane: opts.smartLane,
      difficulty: opts.difficulty || 'normal',
      downbeatIndices: result.downbeatIndices || [],
      downbeatConfidence: result.downbeatConfidence || 0,
    }
  );

  const finalResult = {
    notes: out,
    bpm: result.bpm,
    bpmConfidence: result.bpmConfidence,
    bpmCandidates: result.bpmCandidates,
    bpmStable: result.bpmStable,
    bpmDrift: result.bpmDrift,
    beatTimes: result.beatTimes,
    downbeatIndices: result.downbeatIndices,
    downbeatConfidence: result.downbeatConfidence,
    times: result.onsetTimes,
    analysisMs: result.analysisMs,
    rawOnsetCount: result.onsetTimes.length,
    droppedByDensity,
    difficulty: opts.difficulty || 'normal',
    fromCache: false,
  };

  // Etap 10: store in IndexedDB for next time. Fire-and-forget — the user
  // shouldn't wait for the write.
  if (cacheKey) {
    putCached(cacheKey, finalResult, {
      fileName: opts.fileName || '',
      durationSec: audioBuffer.duration,
    }).catch(() => { /* already logged */ });
  }

  return finalResult;
}

// Build note events (time, endTime, isHold) from the worker output.
function buildEvents(res, duration, modeStr, opts) {
  const {
    onsetTimes, onsetStrengths, bandsAtOnset, novelty, framesPerSec, bpm,
    harmonicEnvelopes, beatTimes, pitchRegions,
    onsetSources,        // Etap C (v1.22): per-onset source tag
  } = res;

  // Build onset objects with strength + per-band energy (kick/snare/hihat
  // classification happens in mapgen using these). Etap C: source tag from
  // separated instrument streams (kick/snare/hihat/melody) if available.
  const onsets = [];
  for (let i = 0; i < onsetTimes.length; i++) {
    const t = onsetTimes[i];
    if (t < 0.30 || t > duration - 0.30) continue;
    onsets.push({
      time: t,
      strength: onsetStrengths ? onsetStrengths[i] : 1,
      bands: bandsAtOnset ? bandsAtOnset[i] : null,
      source: onsetSources ? onsetSources[i] : null,
    });
  }

  // Etap 3 + B (v1.21): hold detection via harmonic-envelope hysteresis
  // PLUS pitch-region matching (stable YIN pitch = guaranteed HOLD with
  // known end-time — much more accurate than envelope alone).
  if (harmonicEnvelopes) {
    return detectHolds(
      onsets, harmonicEnvelopes, framesPerSec,
      beatTimes || [], bpm, modeStr,
      {
        holdEnable: opts.holdEnable,
        holdMode: opts.holdMode,
        pitchRegions: pitchRegions || [],
      }
    );
  }

  // Fallback: no harmonic mag available (hpssLite disabled) — use novelty
  // envelope like the v1.x analyzer.
  const smoothN = smoothEnvelope(novelty, 5);
  const nMean = mean(smoothN) || 1e-6;
  const params = modeStr === 'vocal'
    ? { thr: nMean * 0.55, minH: 0.36, maxH: 2.10, prob: opts.holdMode === 2 ? 0.70 : opts.holdMode === 1 ? 0.50 : 0 }
    : modeStr === 'classic'
      ? { thr: nMean * 0.70, minH: 0.34, maxH: 1.60, prob: opts.holdMode === 2 ? 0.48 : opts.holdMode === 1 ? 0.32 : 0 }
      : { thr: nMean * 1.10, minH: 0.28, maxH: 0.90, prob: opts.holdMode === 2 ? 0.28 : opts.holdMode === 1 ? 0.14 : 0 };
  const events = [];
  for (const o of onsets) {
    let holdDur = 0;
    if (opts.holdEnable && params.prob > 0 && Math.random() < params.prob) {
      const f0 = Math.floor(o.time * framesPerSec);
      const maxF = Math.floor(params.maxH * framesPerSec);
      let cnt = 0, below = 0;
      for (let f = f0 + 1; f < smoothN.length && cnt < maxF; f++) {
        if (smoothN[f] > params.thr) { cnt++; below = 0; }
        else { below++; if (below > 3) break; cnt++; }
      }
      holdDur = cnt / framesPerSec;
      if (holdDur < params.minH) holdDur = 0;
      if (holdDur > params.maxH) holdDur = params.maxH;
    }
    events.push({
      time: o.time,
      endTime: o.time + holdDur,
      isHold: holdDur >= params.minH,
      strength: o.strength,
      source: o.source ?? null,
    });
  }
  return events;
}

function smoothEnvelope(sig, halfWin) {
  const N = sig.length;
  const out = new Float32Array(N);
  let sum = 0;
  const win = halfWin * 2 + 1;
  for (let i = 0; i < Math.min(win, N); i++) sum += sig[i];
  for (let i = 0; i < N; i++) {
    const lo = i - halfWin, hi = i + halfWin;
    if (lo > 0)   sum -= sig[lo - 1] ?? 0;
    if (hi < N)   sum += sig[hi]     ?? 0;
    const cnt = Math.min(hi, N - 1) - Math.max(0, lo) + 1;
    out[i] = sum / cnt;
  }
  return out;
}
function mean(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; }

// Kept for API back-compat (someone may still call this from console)
export function detectBPM() {
  return { bpm: 120, confidence: 0 };
}
