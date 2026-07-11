// Analysis worker: receives PCM + settings, returns onsets + BPM + per-band flux.
// Runs off the main thread so UI stays responsive during multi-second analysis.

import { computeSpectrogram } from './stft.js';
import { computeMultibandFlux, weightedFlux, MODE_WEIGHTS, NUM_BANDS } from './spectralFlux.js';
import { pickPeaksAdaptive } from './onsets.js';
import { estimateBPM } from './bpm.js';
import { percussiveEnhance, computeHpssMasks, computeHpssIterative, suggestHpssWindows, snapToBeatGrid, dedupeClose } from './percussive.js';
import { trackBeats, snapToTrackedBeats } from './beatTracking.js';
import { buildHarmonicEnvelopes } from './holds.js';

self.onmessage = async (e) => {
  const {
    pcm, sampleRate,
    mode = 'classic',
    sens = 1.25,
    hpssMode = 'hard',       // Etap 2: 'off' | 'hard' | 'soft' | 'iterative'
    snapSubdivision = 0,
  } = e.data;
  try {
    const t0 = performance.now();
    postProgress(0.02, 'stft');

    const FRAME = 2048;
    const HOP = 512;
    const spec = computeSpectrogram(pcm, FRAME, HOP);
    const framesPerSec = sampleRate / HOP;

    // Etap 2: HPSS with quality modes. Default window sizes; a second pass
    // below refines them once we know the tempo.
    // 'off'       = no separation (fastest, works on clean tracks)
    // 'hard'      = per-bin sharp mask (v1.9 default, good for drums-heavy)
    // 'soft'      = Wiener-like smooth mask (better on mixed content)
    // 'iterative' = two-pass soft refinement (best quality, slowest)
    let usedMag = spec.mag;
    let harmonicEnvelopes = null;
    if (hpssMode !== 'off') {
      postProgress(0.20, 'hpss');
      const { winFreq, winTime } = suggestHpssWindows(120); // preliminary
      let masks;
      if (hpssMode === 'iterative') {
        masks = computeHpssIterative(spec.mag, spec.numFrames, spec.numBins, winFreq, winTime, 'soft');
      } else {
        masks = computeHpssMasks(spec.mag, spec.numFrames, spec.numBins, winFreq, winTime, true, hpssMode);
      }
      usedMag = (mode !== 'vocal') ? masks.percussive : spec.mag;
      harmonicEnvelopes = buildHarmonicEnvelopes(
        masks.harmonic, spec.numFrames, spec.numBins, sampleRate, FRAME
      );
    }
    postProgress(0.35, 'flux');

    const percSpec = { ...spec, mag: usedMag };
    const { fluxBands, fluxTotal } = computeMultibandFlux(percSpec, sampleRate);
    postProgress(0.55, 'novelty');

    const weights = MODE_WEIGHTS[mode] || MODE_WEIGHTS.classic;
    const novelty = weightedFlux(fluxBands, weights);
    postProgress(0.65, 'onsets');

    // sens 0.5 → very sensitive (alpha ~1.15) · 2.5 → very strict (alpha ~2.2)
    // Mode-specific base alpha: DRUMS gets a higher floor because drums
    // fire on every subdivision — we want only the strongest hits.
    const modeAlphaBoost = mode === 'drums' ? 0.35 : mode === 'vocal' ? 0.10 : 0;
    const alpha = 1.10 + (sens - 0.5) * 0.55 + modeAlphaBoost;
    const onsetOpts = {
      framesPerSec,
      alpha,
      delta: mode === 'drums' ? 0.04 : 0.02,
      preMedSec:  mode === 'drums' ? 0.40 : 0.50,
      minGapSec:  mode === 'drums' ? 0.130 : mode === 'vocal' ? 0.160 : 0.110,
    };
    const rawOnsets = pickPeaksAdaptive(novelty, onsetOpts, 1.2);
    postProgress(0.78, 'bpm');

    const bpmInfo = estimateBPM(novelty, rawOnsets, framesPerSec);

    // Etap 4: beat tracking via Ellis DP. Gives us the actual beat times
    // instead of just "average tempo starting at t=0". This is used for
    // snap-to-beat (much better than fixed-grid snap on tracks with intros
    // or slight tempo drift).
    postProgress(0.86, 'beat-track');
    const beatInfo = trackBeats(novelty, framesPerSec, bpmInfo.bpm);
    const beatTimes = beatInfo.beats;

    // Beat-snap using TRACKED beats (Etap 4 upgrade). Only applied if the
    // user picked a subdivision (Easy/Normal do it, Hard/Expert don't).
    let snappedOnsets = rawOnsets;
    if (snapSubdivision > 0 && beatTimes.length > 4) {
      postProgress(0.92, 'beat-snap');
      const snapRadius = Math.min(90, (60000 / bpmInfo.bpm / snapSubdivision) * 0.5);
      const snappedTimes = snapToTrackedBeats(
        rawOnsets.map(o => o.time),
        beatTimes,
        snapSubdivision,
        snapRadius
      );
      const withSnapped = rawOnsets.map((o, i) => ({ ...o, time: snappedTimes[i] }));
      withSnapped.sort((a, b) => a.time - b.time);
      const finalOnsets = [];
      let lastT = -Infinity;
      for (const o of withSnapped) {
        if (o.time - lastT < 0.030) {
          const prev = finalOnsets[finalOnsets.length - 1];
          if (o.strength > prev.strength) finalOnsets[finalOnsets.length - 1] = o;
        } else {
          finalOnsets.push(o);
          lastT = o.time;
        }
      }
      snappedOnsets = finalOnsets;
    } else if (snapSubdivision > 0 && bpmInfo.bpm > 40) {
      // Fallback to fixed-grid snap if beat tracking failed
      postProgress(0.92, 'beat-snap');
      const snappedTimes = snapToBeatGrid(
        rawOnsets.map(o => o.time),
        bpmInfo.bpm,
        snapSubdivision,
        Math.min(90, (60000 / bpmInfo.bpm / snapSubdivision) * 0.5)
      );
      const withSnapped = rawOnsets.map((o, i) => ({ ...o, time: snappedTimes[i] }));
      withSnapped.sort((a, b) => a.time - b.time);
      const finalOnsets = [];
      let lastT = -Infinity;
      for (const o of withSnapped) {
        if (o.time - lastT < 0.030) {
          const prev = finalOnsets[finalOnsets.length - 1];
          if (o.strength > prev.strength) finalOnsets[finalOnsets.length - 1] = o;
        } else {
          finalOnsets.push(o);
          lastT = o.time;
        }
      }
      snappedOnsets = finalOnsets;
    }
    postProgress(0.96, 'done');

    // Compute per-onset band contributions (used later by mapgen / hold detection)
    const bandsAtOnset = snappedOnsets.map(o => {
      const arr = new Array(NUM_BANDS);
      for (let b = 0; b < NUM_BANDS; b++) arr[b] = fluxBands[b][o.frame] || 0;
      return arr;
    });

    const onsetTimes = snappedOnsets.map(o => o.time);
    const onsetStrengths = new Float32Array(snappedOnsets.map(o => o.strength));

    const durationSec = pcm.length / sampleRate;
    // Etap 3: pass compact envelopes (~200 KB total) instead of the full
    // harmonic spectrogram (~80 MB) — huge transfer win.
    const transferables = [onsetStrengths.buffer, novelty.buffer];
    if (harmonicEnvelopes) {
      transferables.push(harmonicEnvelopes.eDrums.buffer);
      transferables.push(harmonicEnvelopes.eClassic.buffer);
      transferables.push(harmonicEnvelopes.eVocal.buffer);
      transferables.push(harmonicEnvelopes.eVocalFormant.buffer);
    }

    self.postMessage({
      ok: true,
      onsetTimes,
      onsetStrengths,
      bandsAtOnset,
      bpm: bpmInfo.bpm,
      bpmConfidence: bpmInfo.confidence,
      bpmCandidates: bpmInfo.candidates,
      bpmStable: bpmInfo.stable,
      bpmDrift: bpmInfo.drift,
      beatTimes,
      novelty,
      harmonicEnvelopes,
      framesPerSec,
      sampleRate,
      durationSec,
      analysisMs: performance.now() - t0,
      rawOnsetsBeforeSnap: rawOnsets.length,
      onsetsAfterSnap: snappedOnsets.length,
    }, transferables);
  } catch (err) {
    self.postMessage({ ok: false, error: err.message || String(err) });
  }
};

function postProgress(pct, stage) {
  self.postMessage({ progress: pct, stage });
}
