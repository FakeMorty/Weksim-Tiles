// Analysis worker: receives PCM + settings, returns onsets + BPM + per-band flux.
// Runs off the main thread so UI stays responsive during multi-second analysis.

import { computeSpectrogram } from './stft.js';
import { computeMultibandFlux, weightedFlux, MODE_WEIGHTS, NUM_BANDS, computeSuperflux, blendNovelty } from './spectralFlux.js';
import { pickPeaksAdaptive } from './onsets.js';
import { estimateBPM } from './bpm.js';
import { percussiveEnhance, computeHpssMasks, computeHpssIterative, suggestHpssWindows, snapToBeatGrid, dedupeClose } from './percussive.js';
import { trackBeats, snapToTrackedBeats } from './beatTracking.js';
import { localTempoCurve, buildPLPCurve, extractBeats, detectDownbeats } from './plp.js';
import { trackPitch, findStablePitchRegions, detectPitchOnsets, mergePitchIntoOnsets } from './pitch.js';
import { buildHarmonicEnvelopes } from './holds.js';
import { buildSourceEnvelopes, mergeSourceOnsets, pickPrimary, fuseOnsets } from './sources.js';
import { refineSourcesNMF } from './nmf.js';

self.onmessage = async (e) => {
  const {
    pcm, sampleRate,
    mode = 'classic',
    sens = 1.25,
    hpssMode = 'hard',       // Etap 2: 'off' | 'hard' | 'soft' | 'iterative'
    snapSubdivision = 0,
    nmfMode = 'auto',        // Etap D (v1.23): 'off' | 'fast' | 'quality' | 'auto'
  } = e.data;
  try {
    const t0 = performance.now();
    postProgress(0.02, 'stft');

    const FRAME = 2048;
    const HOP = 512;
    const durationSec = pcm.length / sampleRate;
    const spec = computeSpectrogram(pcm, FRAME, HOP);
    const framesPerSec = sampleRate / HOP;

    // Coarse tempo from raw magnitude so HPSS median windows match the
    // actual groove instead of always assuming 120 BPM.
    postProgress(0.12, 'tempo');
    const { fluxTotal: coarseFlux } = computeMultibandFlux(spec, sampleRate);
    const coarseBpm = estimateBPM(coarseFlux, [], framesPerSec).bpm || 120;

    // Etap 2: HPSS with quality modes.
    // 'off'       = no separation (fastest, works on clean tracks)
    // 'hard'      = per-bin sharp mask (v1.9 default, good for drums-heavy)
    // 'soft'      = Wiener-like smooth mask (better on mixed content)
    // 'iterative' = two-pass soft refinement (best quality, slowest)
    let usedMag = spec.mag;
    let harmonicEnvelopes = null;
    let percussiveMag = null;
    let harmonicMag  = null;
    if (hpssMode !== 'off') {
      postProgress(0.20, 'hpss');
      const { winFreq, winTime } = suggestHpssWindows(coarseBpm);
      // Vocals: a hard mask punches holes in formants. Soft Wiener keeps
      // harmonic energy while still peeling drums off the spectrum.
      const hpssKind = (mode === 'vocal' && hpssMode === 'hard') ? 'soft' : hpssMode;
      let masks;
      if (hpssKind === 'iterative') {
        masks = computeHpssIterative(spec.mag, spec.numFrames, spec.numBins, winFreq, winTime, 'soft');
      } else {
        masks = computeHpssMasks(spec.mag, spec.numFrames, spec.numBins, winFreq, winTime, true, hpssKind);
      }
      usedMag = (mode === 'vocal')
        ? (masks.harmonic || spec.mag)
        : (masks.percussive || spec.mag);
      percussiveMag = masks.percussive;
      harmonicMag  = masks.harmonic;
      harmonicEnvelopes = buildHarmonicEnvelopes(
        masks.harmonic, spec.numFrames, spec.numBins, sampleRate, FRAME
      );
    }
    postProgress(0.30, 'pitch');

    // YIN pitch tracking. Skipped in drums mode (unpitched). Also used
    // later as extra syllable onsets for vocal/classic.
    let pitchRegions = [];
    let pitchTrack = null;
    if (mode !== 'drums') {
      pitchTrack = trackPitch(pcm, sampleRate, HOP, FRAME);
      pitchRegions = findStablePitchRegions(
        pitchTrack, framesPerSec, 0.6, mode === 'vocal' ? 0.22 : 0.28
      );
    }

    postProgress(0.35, 'flux');

    const percSpec = { ...spec, mag: usedMag };
    const { fluxBands } = computeMultibandFlux(percSpec, sampleRate);
    const weights = MODE_WEIGHTS[mode] || MODE_WEIGHTS.classic;
    const bandNovelty = weightedFlux(fluxBands, weights);

    postProgress(0.50, 'superflux');
    const sfOpts = mode === 'vocal'
      ? { muBins: 2, minHz: 180, maxHz: 5000 }
      : mode === 'drums'
        ? { muBins: 3, minHz: 30, maxHz: 5500 }
        : { muBins: 3, minHz: 20, maxHz: 12000 };
    const sf = computeSuperflux(percSpec, sampleRate, sfOpts);

    let novelty;
    if (mode === 'classic' && harmonicMag) {
      const sfH = computeSuperflux({ ...spec, mag: harmonicMag }, sampleRate, { muBins: 2, minHz: 180, maxHz: 5000 });
      novelty = blendNovelty([
        { sig: sf, weight: 0.55 },
        { sig: sfH, weight: 0.25 },
        { sig: bandNovelty, weight: 0.20 },
      ]);
    } else if (mode === 'vocal') {
      novelty = blendNovelty([
        { sig: sf, weight: 0.70 },
        { sig: bandNovelty, weight: 0.30 },
      ]);
    } else {
      novelty = blendNovelty([
        { sig: sf, weight: 0.85 },
        { sig: bandNovelty, weight: 0.15 },
      ]);
    }
    postProgress(0.65, 'onsets');

    // sens 0.5 → very sensitive (alpha ~1.15) · 2.5 → very strict (alpha ~2.2)
    const modeAlphaBoost = mode === 'drums' ? 0.35 : mode === 'vocal' ? 0.10 : 0;
    const alpha = 1.10 + (sens - 0.5) * 0.55 + modeAlphaBoost;
    const onsetOpts = {
      framesPerSec,
      alpha,
      delta: mode === 'drums' ? 0.04 : 0.02,
      preMedSec:  mode === 'drums' ? 0.40 : 0.50,
      minGapSec:  mode === 'drums' ? 0.130 : mode === 'vocal' ? 0.140 : 0.110,
      neigh: 1,
    };
    let rawOnsets = pickPeaksAdaptive(novelty, onsetOpts, mode === 'vocal' ? 1.0 : 1.2);

    // Etap C (v1.22): Source separation. Build per-instrument envelopes,
    // run onset detection on each, merge into a single tagged stream.
    // Only meaningful when HPSS gave us both P and H masks. In 'drums' mode
    // we skip melody, in 'vocal' mode we lean on melody.
    let sourceOnsets = null;
    let sourcesUsed = null;
    let nmfUsed = false;
    if (percussiveMag && harmonicMag) {
      postProgress(0.70, 'sources');
      const src = buildSourceEnvelopes(
        percussiveMag, harmonicMag,
        spec.numFrames, spec.numBins, sampleRate, FRAME
      );

      // Etap D (v1.23): NMF refinement of source activations. Runs on the
      // FULL magnitude spectrogram (not HPSS-masked) — NMF wants to see
      // everything to learn the templates properly. If enabled, blends the
      // NMF activations with the band-based ones (multiplicative — both
      // must agree = a strong signal survives, either alone = suppressed).
      const wantNMF = nmfMode !== 'off';
      if (wantNMF) {
        postProgress(0.72, 'nmf');
        const nmfOpts = nmfMode === 'fast'
          ? { timeStride: 3, iterations: 25 }
          : nmfMode === 'quality'
            ? { timeStride: 2, iterations: 50 }
            : { timeStride: 2, iterations: 40 }; // auto
        const nmf = refineSourcesNMF(
          spec.mag, spec.numFrames, spec.numBins, sampleRate, FRAME, nmfOpts
        );
        if (nmf) {
          nmfUsed = true;
          // For each source: convert NMF activation curve into flux (attack-
          // sensitive novelty) and multiply element-wise with the existing
          // band-based flux. Product highlights events where BOTH agree.
          for (const key of ['kick', 'snare', 'hihat', 'melody']) {
            const nmfCurve = nmf[key];
            const bandCurve = src[key];
            const N = bandCurve.length;
            // Normalise NMF curve to [0..~1] so multiplication doesn't blow up
            let nmfMax = 0;
            for (let i = 0; i < N; i++) if (nmfCurve[i] > nmfMax) nmfMax = nmfCurve[i];
            const invMax = nmfMax > 0 ? 1 / nmfMax : 1;
            // NMF is activation (level), not flux — take positive diff for attacks
            const nmfFlux = new Float32Array(N);
            for (let i = 1; i < N; i++) {
              const d = (nmfCurve[i] - nmfCurve[i - 1]) * invMax;
              if (d > 0) nmfFlux[i] = d;
            }
            // Blend: weight sqrt so combined behaves like geometric mean
            for (let i = 0; i < N; i++) {
              src[key][i] = bandCurve[i] * (0.5 + 0.5 * Math.min(1, nmfFlux[i] * 8));
            }
          }
        }
      }

      // Per-source onset params: kick wants tight, snare medium, hats loose,
      // melody wants long refractory so it doesn't fire per-note vibrato.
      const perSourceOpts = {
        kick:   { framesPerSec, alpha: 1.30, delta: 0.03, preMedSec: 0.40, minGapSec: 0.150, neigh: 1 },
        snare:  { framesPerSec, alpha: 1.28, delta: 0.03, preMedSec: 0.40, minGapSec: 0.180, neigh: 1 },
        hihat:  { framesPerSec, alpha: 1.65, delta: 0.05, preMedSec: 0.30, minGapSec: 0.110, neigh: 1 },
        melody: { framesPerSec, alpha: 1.45, delta: 0.03, preMedSec: 0.55, minGapSec: 0.180, neigh: 1 },
      };

      const bySource = {};
      if (mode !== 'vocal') {
        bySource.kick  = pickPeaksAdaptive(src.kick,  perSourceOpts.kick,  0.7);
        bySource.snare = pickPeaksAdaptive(src.snare, perSourceOpts.snare, 0.5);
        bySource.hihat = pickPeaksAdaptive(src.hihat, perSourceOpts.hihat, 0.45);
      }
      if (mode !== 'drums') {
        bySource.melody = pickPeaksAdaptive(src.melody, perSourceOpts.melody, mode === 'vocal' ? 0.7 : 0.4);
      }

      const merged = mergeSourceOnsets(bySource, 40);
      const fused = fuseOnsets(rawOnsets, merged, mode, durationSec);
      if (fused !== rawOnsets) {
        rawOnsets = fused.map(m => ({
          frame: m.frame,
          time: m.time,
          strength: m.strength,
          primary: m.primary,
          sources: m.sources,
        }));
        sourceOnsets = fused;
        sourcesUsed = Object.keys(bySource);
      }
    }

    if (mode !== 'drums' && pitchTrack) {
      const pitchOns = detectPitchOnsets(pitchTrack, framesPerSec, {
        minGapSec: mode === 'vocal' ? 0.12 : 0.16,
      });
      if (pitchOns.length) {
        rawOnsets = mergePitchIntoOnsets(rawOnsets, pitchOns, mode === 'vocal' ? 0.080 : 0.100);
      }
    }

    postProgress(0.78, 'bpm');

    const bpmInfo = estimateBPM(novelty, rawOnsets, framesPerSec);

    // Etap 4: Ellis DP gives us a first pass of beat times using the global
    // tempo as a rigid template.
    postProgress(0.83, 'beat-track');
    const ellisInfo = trackBeats(novelty, framesPerSec, bpmInfo.bpm);
    let beatTimes = ellisInfo.beats;

    // Etap A (v1.20): PLP refinement — adapts to local tempo drift and
    // finds precise phase per window. Only runs if we have enough novelty
    // to make it worthwhile (>4 seconds). Falls back gracefully otherwise.
    let downbeatIndices = [];
    let downbeatPhase = 0;
    let downbeatConfidence = 0;
    if (bpmInfo.bpm > 40 && novelty.length > framesPerSec * 4) {
      postProgress(0.86, 'plp');
      const tempoCurve = localTempoCurve(novelty, framesPerSec, 4, 0.5, bpmInfo.bpm);
      const pulseCurve = buildPLPCurve(novelty, framesPerSec, tempoCurve);
      const plpBeats = extractBeats(pulseCurve, framesPerSec, tempoCurve);

      // Sanity check: PLP should give roughly the same number of beats as Ellis.
      // If PLP wildly disagrees (>30% mismatch), fall back to Ellis — safer.
      const ellisCount = ellisInfo.beats.length;
      const plpCount = plpBeats.length;
      const ratio = ellisCount > 0 ? plpCount / ellisCount : 1;
      if (plpCount > 4 && ratio > 0.70 && ratio < 1.30) {
        beatTimes = plpBeats;
      }

      // Downbeat detection on whichever beat list we chose. Uses novelty +
      // bass envelope (bands 0-1 combined) to find measure boundaries.
      postProgress(0.88, 'downbeats');
      let bassEnv = null;
      if (fluxBands && fluxBands[0] && fluxBands[1]) {
        bassEnv = new Float32Array(fluxBands[0].length);
        for (let i = 0; i < bassEnv.length; i++) {
          bassEnv[i] = fluxBands[0][i] + fluxBands[1][i];
        }
      }
      const db = detectDownbeats(beatTimes, novelty, bassEnv, framesPerSec, 4);
      downbeatIndices = db.downbeatIndices;
      downbeatPhase = db.phase;
      downbeatConfidence = db.confidence;
    }

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

    // Etap 3: pass compact envelopes (~200 KB total) instead of the full
    // harmonic spectrogram (~80 MB) — huge transfer win.
    const transferables = [onsetStrengths.buffer, novelty.buffer];
    if (harmonicEnvelopes) {
      transferables.push(harmonicEnvelopes.eDrums.buffer);
      transferables.push(harmonicEnvelopes.eClassic.buffer);
      transferables.push(harmonicEnvelopes.eVocal.buffer);
      transferables.push(harmonicEnvelopes.eVocalFormant.buffer);
    }

    // Etap C: primary source per onset (kick/snare/hihat/melody or null)
    const onsetSources = snappedOnsets.map(o => o.primary || null);

    self.postMessage({
      ok: true,
      onsetTimes,
      onsetStrengths,
      onsetSources,
      sourcesUsed,
      nmfUsed,
      bandsAtOnset,
      bpm: bpmInfo.bpm,
      bpmConfidence: bpmInfo.confidence,
      bpmCandidates: bpmInfo.candidates,
      bpmStable: bpmInfo.stable,
      bpmDrift: bpmInfo.drift,
      beatTimes,
      downbeatIndices,
      downbeatPhase,
      downbeatConfidence,
      pitchRegions,
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
