// Analysis worker: receives PCM + settings, returns onsets + BPM + per-band flux.
// Runs off the main thread so UI stays responsive during multi-second analysis.

import { computeSpectrogram } from './stft.js';
import { computeMultibandFlux, weightedFlux, MODE_WEIGHTS, NUM_BANDS } from './spectralFlux.js';
import { pickPeaksAdaptive } from './onsets.js';
import { estimateBPM } from './bpm.js';

self.onmessage = async (e) => {
  const { pcm, sampleRate, mode = 'classic', sens = 1.25 } = e.data;
  try {
    const t0 = performance.now();
    postProgress(0.02, 'stft');

    const FRAME = 2048;
    const HOP = 512;
    const spec = computeSpectrogram(pcm, FRAME, HOP);
    const framesPerSec = sampleRate / HOP;
    postProgress(0.35, 'flux');

    const { fluxBands, fluxTotal } = computeMultibandFlux(spec, sampleRate);
    postProgress(0.55, 'novelty');

    const weights = MODE_WEIGHTS[mode] || MODE_WEIGHTS.classic;
    const novelty = weightedFlux(fluxBands, weights);
    postProgress(0.65, 'onsets');

    // sens 0.5 → very sensitive (alpha ~1.15) · 2.5 → very strict (alpha ~2.2)
    const alpha = 1.10 + (sens - 0.5) * 0.55;
    const onsetOpts = {
      framesPerSec,
      alpha,
      delta: 0.02,
      preMedSec:  mode === 'drums' ? 0.35 : 0.50,
      minGapSec:  mode === 'drums' ? 0.075 : mode === 'vocal' ? 0.14 : 0.10,
    };
    const rawOnsets = pickPeaksAdaptive(novelty, onsetOpts, 1.2);
    postProgress(0.85, 'bpm');

    const bpmInfo = estimateBPM(novelty, rawOnsets, framesPerSec);
    postProgress(0.95, 'done');

    // Compute per-onset band contributions (used later by mapgen / hold detection)
    const bandsAtOnset = rawOnsets.map(o => {
      const arr = new Array(NUM_BANDS);
      for (let b = 0; b < NUM_BANDS; b++) arr[b] = fluxBands[b][o.frame] || 0;
      return arr;
    });

    // Send only the compact result — no raw spectrograms across the wire
    const onsetTimes = rawOnsets.map(o => o.time);
    const onsetStrengths = new Float32Array(rawOnsets.map(o => o.strength));

    const durationSec = pcm.length / sampleRate;
    self.postMessage({
      ok: true,
      onsetTimes,
      onsetStrengths,
      bandsAtOnset,
      bpm: bpmInfo.bpm,
      bpmConfidence: bpmInfo.confidence,
      bpmCandidates: bpmInfo.candidates,
      novelty,               // small (~O(N) floats) — useful for hold/hpss later
      framesPerSec,
      durationSec,
      analysisMs: performance.now() - t0,
    }, [onsetStrengths.buffer, novelty.buffer]);
  } catch (err) {
    self.postMessage({ ok: false, error: err.message || String(err) });
  }
};

function postProgress(pct, stage) {
  self.postMessage({ progress: pct, stage });
}
