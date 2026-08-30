// Functional test for the new analyzer pipeline. Generates a synthetic signal
// with clear onsets at known times, then verifies STFT+flux+peak-picking
// finds them and BPM estimator returns the right tempo.

import { computeSpectrogram, fftInPlace, hannWindow } from '../src/audio/stft.js';
import { computeMultibandFlux, weightedFlux, MODE_WEIGHTS, computeSuperflux, blendNovelty } from '../src/audio/spectralFlux.js';
import { pickPeaks } from '../src/audio/onsets.js';
import { estimateBPM } from '../src/audio/bpm.js';
import { detectPitchOnsets } from '../src/audio/pitch.js';
import { fuseOnsets } from '../src/audio/sources.js';

const SR = 44100;
const DURATION = 8; // seconds
const N = SR * DURATION;

function synthKick(pcm, t, amp = 0.8) {
  const start = Math.floor(t * SR);
  for (let i = 0; i < SR * 0.10; i++) {
    const env = Math.exp(-i / (SR * 0.03));
    pcm[start + i] += Math.sin(2 * Math.PI * 60 * i / SR) * env * amp;
  }
}

function synthTone(pcm, t, hz, dur = 0.18, amp = 0.55) {
  const start = Math.floor(t * SR);
  const n = Math.floor(SR * dur);
  for (let i = 0; i < n; i++) {
    const att = Math.min(1, i / (SR * 0.008));
    const rel = Math.min(1, (n - i) / (SR * 0.04));
    pcm[start + i] += Math.sin(2 * Math.PI * hz * i / SR) * att * rel * amp;
  }
}

function recallAt(peaks, expected, tol = 0.06) {
  let matched = 0;
  for (const t of expected) {
    if (peaks.some(p => Math.abs(p.time - t) < tol)) matched++;
  }
  return matched / expected.length;
}

// --- Test 1: FFT sanity — sin(440 Hz) should peak at bin round(440*2048/44100) = 20 ---
{
  const FRAME = 2048;
  const re = new Float32Array(FRAME);
  const im = new Float32Array(FRAME);
  const win = hannWindow(FRAME);
  for (let i = 0; i < FRAME; i++) re[i] = Math.sin(2 * Math.PI * 440 * i / SR) * win[i];
  fftInPlace(re, im);
  let maxBin = 0, maxV = 0;
  for (let k = 1; k < FRAME / 2; k++) {
    const m = Math.hypot(re[k], im[k]);
    if (m > maxV) { maxV = m; maxBin = k; }
  }
  const expected = Math.round(440 * FRAME / SR);
  const ok = Math.abs(maxBin - expected) <= 1;
  console.log(`  FFT peak: bin=${maxBin} expected=${expected}  ${ok ? '✓' : '✗ FAIL'}`);
  if (!ok) process.exit(1);
}

// --- Test 2: onset detection on synthetic kick pattern ---
{
  const pcm = new Float32Array(N);
  const kickTimes = [];
  for (let t = 1.0; t <= 6.5; t += 0.5) kickTimes.push(t);
  for (const t of kickTimes) synthKick(pcm, t);
  for (let t = 1.0; t <= 6.5; t += 0.25) {
    const start = Math.floor(t * SR);
    for (let i = 0; i < SR * 0.03; i++) {
      pcm[start + i] += (Math.random() * 2 - 1) * Math.exp(-i / (SR * 0.008)) * 0.15;
    }
  }

  const FRAME = 2048, HOP = 512;
  const t0 = performance.now();
  const spec = computeSpectrogram(pcm, FRAME, HOP);
  const { fluxBands } = computeMultibandFlux(spec, SR);
  const framesPerSec = SR / HOP;
  const bandNov = weightedFlux(fluxBands, MODE_WEIGHTS.drums);
  const sf = computeSuperflux(spec, SR, { muBins: 3, minHz: 30, maxHz: 5500 });
  const novelty = blendNovelty([
    { sig: sf, weight: 0.85 },
    { sig: bandNov, weight: 0.15 },
  ]);
  const peaks = pickPeaks(novelty, {
    framesPerSec, alpha: 1.4, delta: 0.02, minGapSec: 0.15, neigh: 1,
  });
  const analMs = performance.now() - t0;

  const times = peaks.map(p => +p.time.toFixed(3));
  console.log(`  Analyzed ${DURATION}s of PCM in ${analMs.toFixed(0)}ms`);
  console.log(`  Onsets found: ${peaks.length} (expected ~${kickTimes.length})`);
  console.log(`  First 6 times: [${times.slice(0, 6).join(', ')}]`);
  console.log(`  Expected kicks: [${kickTimes.join(', ')}]`);

  const recall = recallAt(peaks, kickTimes);
  console.log(`  Kick recall (superflux): ${(recall * 100).toFixed(0)}%  ${recall >= 0.75 ? '✓' : '✗ FAIL'}`);
  if (recall < 0.75) process.exit(1);

  const bpmInfo = estimateBPM(novelty, peaks, framesPerSec);
  const bpmOk = Math.abs(bpmInfo.bpm - 120) < 2.5 || Math.abs(bpmInfo.bpm - 240) < 2.5 || Math.abs(bpmInfo.bpm - 60) < 2.5;
  console.log(`  BPM estimate: ${bpmInfo.bpm} (confidence ${bpmInfo.confidence.toFixed(2)})  ${bpmOk ? '✓' : '✗ FAIL'}`);
  if (!bpmOk) process.exit(1);
}

// --- Test 3: vocal-weighted flux on isolated tone bursts ---
{
  const pcm = new Float32Array(N);
  const toneTimes = [1.25, 2.25, 3.25, 4.25, 5.25];
  for (const t of toneTimes) synthTone(pcm, t, 880, 0.20, 0.7);

  const FRAME = 2048, HOP = 512;
  const spec = computeSpectrogram(pcm, FRAME, HOP);
  const { fluxBands } = computeMultibandFlux(spec, SR);
  const framesPerSec = SR / HOP;
  const bandNov = weightedFlux(fluxBands, MODE_WEIGHTS.vocal);
  const sf = computeSuperflux(spec, SR, { muBins: 2, minHz: 180, maxHz: 5000 });
  const novelty = blendNovelty([
    { sig: sf, weight: 0.70 },
    { sig: bandNov, weight: 0.30 },
  ]);
  const peaks = pickPeaks(novelty, {
    framesPerSec, alpha: 1.3, delta: 0.02, minGapSec: 0.14, neigh: 1,
  });
  const recall = recallAt(peaks, toneTimes, 0.08);
  console.log(`  Vocal-tone recall: ${(recall * 100).toFixed(0)}%  ${recall >= 0.6 ? '✓' : '✗ FAIL'}`);
  if (recall < 0.6) process.exit(1);
}

// --- Test 4: drums vs vocal weights on a mixed kick+tone signal ---
{
  const pcm = new Float32Array(N);
  const kickTimes = [];
  for (let t = 1.0; t <= 6.5; t += 0.5) { kickTimes.push(t); synthKick(pcm, t, 0.85); }
  const toneTimes = [1.25, 2.25, 3.25, 4.25, 5.25];
  for (const t of toneTimes) synthTone(pcm, t, 880, 0.18, 0.65);

  const FRAME = 2048, HOP = 512;
  const spec = computeSpectrogram(pcm, FRAME, HOP);
  const { fluxBands } = computeMultibandFlux(spec, SR);
  const framesPerSec = SR / HOP;

  const drumsNov = blendNovelty([
    { sig: computeSuperflux(spec, SR, { muBins: 3, minHz: 30, maxHz: 5500 }), weight: 0.85 },
    { sig: weightedFlux(fluxBands, MODE_WEIGHTS.drums), weight: 0.15 },
  ]);
  const vocalNov = blendNovelty([
    { sig: computeSuperflux(spec, SR, { muBins: 2, minHz: 180, maxHz: 5000 }), weight: 0.70 },
    { sig: weightedFlux(fluxBands, MODE_WEIGHTS.vocal), weight: 0.30 },
  ]);
  const drumsPeaks = pickPeaks(drumsNov, {
    framesPerSec, alpha: 1.45, delta: 0.03, minGapSec: 0.13, neigh: 1,
  });
  const vocalPeaks = pickPeaks(vocalNov, {
    framesPerSec, alpha: 1.3, delta: 0.02, minGapSec: 0.14, neigh: 1,
  });

  const drumsKick = recallAt(drumsPeaks, kickTimes);
  const vocalTone = recallAt(vocalPeaks, toneTimes, 0.08);
  const drumsTone = recallAt(drumsPeaks, toneTimes, 0.08);
  console.log(`  Mixed: drums→kick ${(drumsKick * 100).toFixed(0)}%  vocal→tone ${(vocalTone * 100).toFixed(0)}%  drums→tone ${(drumsTone * 100).toFixed(0)}%`);
  const ok = drumsKick >= 0.75 && vocalTone >= 0.4;
  console.log(`  Mode discrimination  ${ok ? '✓' : '✗ FAIL'}`);
  if (!ok) process.exit(1);
}

// --- Test 5: fuseOnsets drums drops hats sitting on kicks ---
{
  const novelty = [{ time: 1.0, strength: 1, frame: 10 }];
  const many = [];
  for (let i = 0; i < 14; i++) {
    many.push({ time: 0.5 + i * 0.5, strength: 2, frame: i, primary: 'kick', sources: ['kick'] });
  }
  many.push({ time: 0.52, strength: 1, frame: 1, primary: 'hihat', sources: ['hihat'] });
  many.push({ time: 0.75, strength: 1, frame: 2, primary: 'hihat', sources: ['hihat'] });
  const fused = fuseOnsets(novelty, many, 'drums', 8);
  const hats = fused.filter(o => o.primary === 'hihat');
  const ok = fused !== novelty
    && hats.every(h => Math.abs(h.time - 0.52) > 0.01)
    && hats.some(h => Math.abs(h.time - 0.75) < 0.01);
  console.log(`  fuseOnsets drums hat filter  ${ok ? '✓' : '✗ FAIL'}`);
  if (!ok) process.exit(1);
}

// --- Test 6: pitch-jump onsets on a stepping sine ---
{
  const hop = 512;
  const frames = Math.floor((N - 2048) / hop) + 1;
  const f0 = new Float32Array(frames);
  // Unvoiced, then 220 Hz, then jump to 330 Hz (~7 semitones)
  const t220 = Math.round(1.0 * SR / hop);
  const t330 = Math.round(2.0 * SR / hop);
  const tOff = Math.round(3.0 * SR / hop);
  for (let i = t220; i < t330; i++) f0[i] = 220;
  for (let i = t330; i < tOff; i++) f0[i] = 330;
  const ons = detectPitchOnsets(f0, SR / hop, { minGapSec: 0.12 });
  const hasStart = ons.some(o => Math.abs(o.time - 1.0) < 0.05);
  const hasJump  = ons.some(o => Math.abs(o.time - 2.0) < 0.05);
  const ok = hasStart && hasJump;
  console.log(`  Pitch onsets start+jump  ${ok ? '✓' : '✗ FAIL'}  (n=${ons.length})`);
  if (!ok) process.exit(1);
}

console.log('\n✓ All analyzer tests passed');
