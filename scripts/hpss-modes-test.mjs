// Compare HPSS modes: hard vs soft vs iterative on synthetic mixed content.
// Signal: sustained bass + kicks + hi-hats. We measure:
//   - Kick recall (should be high in all modes)
//   - False positives from sustained bass (should decrease with better modes)
//   - Time cost

import { computeSpectrogram } from '../src/audio/stft.js';
import { computeMultibandFlux, weightedFlux, MODE_WEIGHTS } from '../src/audio/spectralFlux.js';
import { pickPeaks } from '../src/audio/onsets.js';
import { computeHpssMasks, computeHpssIterative, suggestHpssWindows } from '../src/audio/percussive.js';

const SR = 44100;
const DURATION = 8;
const N = SR * DURATION;

// Build a "mixed content" test signal: sustained wobbly bass + kicks + hats
const pcm = new Float32Array(N);
for (let i = 0; i < N; i++) {
  const vibrato = Math.sin(2 * Math.PI * 5 * i / SR) * 0.4;
  pcm[i] += Math.sin(2 * Math.PI * (85 + vibrato) * i / SR) * 0.18;
}
const kicks = [];
for (let t = 1.0; t <= 6.5; t += 0.5) kicks.push(t);
for (const t of kicks) {
  const s = Math.floor(t * SR);
  for (let i = 0; i < SR * 0.08; i++) {
    pcm[s + i] += Math.sin(2 * Math.PI * 60 * i / SR) * Math.exp(-i / (SR * 0.02)) * 0.8;
  }
}
// Add hats every 8th
for (let t = 1.0; t <= 6.5; t += 0.25) {
  const s = Math.floor(t * SR);
  for (let i = 0; i < SR * 0.03; i++) {
    pcm[s + i] += (Math.random() * 2 - 1) * Math.exp(-i / (SR * 0.008)) * 0.15;
  }
}

const spec = computeSpectrogram(pcm, 2048, 512);
const framesPerSec = SR / 512;
const { winFreq, winTime } = suggestHpssWindows(120);

function scoreMode(percussiveMag, label, elapsedMs) {
  const { fluxBands } = computeMultibandFlux({ ...spec, mag: percussiveMag }, SR);
  const nov = weightedFlux(fluxBands, MODE_WEIGHTS.drums);
  const peaks = pickPeaks(nov, { framesPerSec, alpha: 1.5, delta: 0.03, minGapSec: 0.15 });
  let hits = 0;
  for (const k of kicks) if (peaks.some(p => Math.abs(p.time - k) < 0.08)) hits++;
  const fp = peaks.length - hits;
  console.log(`  ${label.padEnd(12)} ${elapsedMs.toFixed(0).padStart(4)} ms  ` +
              `recall ${hits}/${kicks.length}  false ${fp}  total ${peaks.length}`);
  return { hits, fp, elapsed: elapsedMs };
}

console.log('HPSS mode comparison on synthetic mixed track:');
console.log('  (kicks at every 0.5s, sustained 85Hz bass, hi-hats at 0.25s)\n');

// Baseline: no HPSS
{
  const t0 = performance.now();
  scoreMode(spec.mag, 'off', performance.now() - t0);
}

// Hard mask (v1.9)
{
  const t0 = performance.now();
  const masks = computeHpssMasks(spec.mag, spec.numFrames, spec.numBins, winFreq, winTime, true, 'hard');
  scoreMode(masks.percussive, 'hard', performance.now() - t0);
}

// Soft (Wiener) mask
{
  const t0 = performance.now();
  const masks = computeHpssMasks(spec.mag, spec.numFrames, spec.numBins, winFreq, winTime, true, 'soft');
  scoreMode(masks.percussive, 'soft', performance.now() - t0);
}

// Iterative
{
  const t0 = performance.now();
  const masks = computeHpssIterative(spec.mag, spec.numFrames, spec.numBins, winFreq, winTime, 'soft');
  scoreMode(masks.percussive, 'iterative', performance.now() - t0);
}

console.log('\nAll HPSS modes complete');
