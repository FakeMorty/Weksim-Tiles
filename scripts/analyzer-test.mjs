// Functional test for the new analyzer pipeline. Generates a synthetic signal
// with clear onsets at known times, then verifies STFT+flux+peak-picking
// finds them and BPM estimator returns the right tempo.

import { computeSpectrogram, fftInPlace, hannWindow } from '../src/audio/stft.js';
import { computeMultibandFlux, weightedFlux, MODE_WEIGHTS } from '../src/audio/spectralFlux.js';
import { pickPeaks } from '../src/audio/onsets.js';
import { estimateBPM } from '../src/audio/bpm.js';

const SR = 44100;
const DURATION = 8; // seconds
const N = SR * DURATION;

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
  // 120 BPM → beat every 0.5 s. Place kicks at 1.0, 1.5, 2.0, ..., 6.5 → 12 kicks.
  const pcm = new Float32Array(N);
  const kickTimes = [];
  for (let t = 1.0; t <= 6.5; t += 0.5) kickTimes.push(t);
  for (const t of kickTimes) {
    // Synth kick: 60 Hz sine burst, exponential decay, 100 ms
    const start = Math.floor(t * SR);
    for (let i = 0; i < SR * 0.10; i++) {
      const env = Math.exp(-i / (SR * 0.03));
      pcm[start + i] += Math.sin(2 * Math.PI * 60 * i / SR) * env * 0.8;
    }
  }
  // Add hi-hat pattern at 8th notes so flux has content in high band too
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
  const novelty = weightedFlux(fluxBands, MODE_WEIGHTS.drums);
  const peaks = pickPeaks(novelty, {
    framesPerSec, alpha: 1.4, delta: 0.02, minGapSec: 0.15,
  });
  const analMs = performance.now() - t0;

  const times = peaks.map(p => +p.time.toFixed(3));
  console.log(`  Analyzed ${DURATION}s of PCM in ${analMs.toFixed(0)}ms`);
  console.log(`  Onsets found: ${peaks.length} (expected ~${kickTimes.length})`);
  console.log(`  First 6 times: [${times.slice(0, 6).join(', ')}]`);
  console.log(`  Expected kicks: [${kickTimes.join(', ')}]`);

  // Count how many kicks were matched within ±60 ms
  let matched = 0;
  for (const kt of kickTimes) {
    if (peaks.some(p => Math.abs(p.time - kt) < 0.06)) matched++;
  }
  const recall = matched / kickTimes.length;
  console.log(`  Kick recall: ${matched}/${kickTimes.length} = ${(recall * 100).toFixed(0)}%  ${recall >= 0.75 ? '✓' : '✗ FAIL'}`);
  if (recall < 0.75) process.exit(1);

  // BPM should be 120 (period 0.5s → 0.5 * 44100/512 ≈ 43 frames)
  const bpmInfo = estimateBPM(novelty, peaks, framesPerSec);
  const bpmOk = Math.abs(bpmInfo.bpm - 120) < 2.5 || Math.abs(bpmInfo.bpm - 240) < 2.5 || Math.abs(bpmInfo.bpm - 60) < 2.5;
  console.log(`  BPM estimate: ${bpmInfo.bpm} (confidence ${bpmInfo.confidence.toFixed(2)})  ${bpmOk ? '✓' : '✗ FAIL'}`);
  if (!bpmOk) process.exit(1);
}

console.log('\n✓ All analyzer tests passed');
