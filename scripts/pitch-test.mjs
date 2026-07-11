// Verify YIN pitch tracking + envelope analysis:
//   1. Steady 440Hz sine → f0 ≈ 440, stable region found
//   2. Two different pitches → two separate regions, no merging
//   3. Kick burst (no pitch) → NOT detected as stable region
//   4. Envelope shape: kick = transient, sustained tone = sustained

import { detectPitchYIN, trackPitch, findStablePitchRegions } from '../src/audio/pitch.js';
import { analyzeEnvelope, computeRMSEnvelope } from '../src/audio/envelope.js';

const SR = 44100;

function synthSine(freqHz, durationSec, amp = 0.3) {
  const N = Math.floor(SR * durationSec);
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = Math.sin(2 * Math.PI * freqHz * i / SR) * amp;
  return out;
}

function synthKick(durationSec) {
  const N = Math.floor(SR * durationSec);
  const out = new Float32Array(N);
  for (let i = 0; i < Math.min(N, SR * 0.08); i++) {
    const env = Math.exp(-i / (SR * 0.02));
    out[i] = Math.sin(2 * Math.PI * 60 * i / SR) * env * 0.9;
  }
  return out;
}

// --- Test 1: Single sine at 440Hz ---
{
  const pcm = synthSine(440, 2);
  const window = pcm.subarray(0, 2048);
  const { f0, confidence } = detectPitchYIN(window, SR);
  console.log(`Test 1: YIN on 440Hz sine`);
  console.log(`  Detected f0: ${f0.toFixed(1)} Hz (expected 440)`);
  console.log(`  Confidence: ${confidence.toFixed(2)}`);
  const err = Math.abs(f0 - 440);
  console.log(`  ${err < 5 && confidence > 0.7 ? 'PASS' : 'FAIL'}`);
  if (err > 5 || confidence < 0.7) process.exit(1);
}

console.log();

// --- Test 2: Two pitches back-to-back ---
{
  // 1 sec of 440Hz, then 1 sec of 660Hz
  const pcm = new Float32Array(SR * 2);
  const a = synthSine(440, 1);
  const b = synthSine(660, 1);
  pcm.set(a, 0);
  pcm.set(b, SR);

  const f0Track = trackPitch(pcm, SR);
  const framesPerSec = SR / 512;
  const regions = findStablePitchRegions(f0Track, framesPerSec, 0.6, 0.25);

  console.log(`Test 2: 440Hz then 660Hz (should be 2 regions)`);
  console.log(`  Regions found: ${regions.length}`);
  for (const r of regions) {
    console.log(`    ${r.startSec.toFixed(2)}s → ${r.endSec.toFixed(2)}s @ ${r.meanF0.toFixed(0)}Hz (stability ${r.stability.toFixed(2)})`);
  }
  const pass = regions.length === 2
    && Math.abs(regions[0].meanF0 - 440) < 10
    && Math.abs(regions[1].meanF0 - 660) < 10;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  if (!pass) process.exit(1);
}

console.log();

// --- Test 3: Kick burst — should NOT be detected as stable pitch ---
{
  const N = SR * 2;
  const pcm = new Float32Array(N);
  // 4 kicks over 2 seconds
  for (let t = 0.2; t < 2; t += 0.5) {
    const start = Math.floor(t * SR);
    const kick = synthKick(0.1);
    for (let i = 0; i < kick.length; i++) {
      if (start + i < N) pcm[start + i] += kick[i];
    }
  }
  const f0Track = trackPitch(pcm, SR);
  const framesPerSec = SR / 512;
  const regions = findStablePitchRegions(f0Track, framesPerSec, 0.5, 0.28);
  console.log(`Test 3: Pure kicks (no melodic content)`);
  console.log(`  Regions found: ${regions.length} (expected 0-1 short)`);
  const pass = regions.length <= 1;
  console.log(`  ${pass ? 'PASS' : 'FAIL (kicks getting mistaken for held notes)'}`);
  if (!pass) process.exit(1);
}

console.log();

// --- Test 4: Envelope shape — transient vs sustained ---
{
  const pcm1 = new Float32Array(SR * 2);
  const kick = synthKick(0.5);
  pcm1.set(kick, 0);
  const env1 = computeRMSEnvelope(pcm1, SR);
  const shape1 = analyzeEnvelope(env1, SR / 512, 0);

  const pcm2 = synthSine(440, 1.5, 0.4);
  const env2 = computeRMSEnvelope(pcm2, SR);
  const shape2 = analyzeEnvelope(env2, SR / 512, 0);

  console.log(`Test 4: Envelope classification`);
  console.log(`  Kick: attack ${shape1.attackMs.toFixed(0)}ms, sustain ${shape1.sustainMs.toFixed(0)}ms, shape=${shape1.shape}`);
  console.log(`  Sine: attack ${shape2.attackMs.toFixed(0)}ms, sustain ${shape2.sustainMs.toFixed(0)}ms, shape=${shape2.shape}`);
  const pass = shape1.shape === 'transient' && shape2.shape === 'sustained';
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  if (!pass) process.exit(1);
}

console.log('\nAll pitch + envelope tests passed');
