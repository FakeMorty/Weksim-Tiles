// Test Etap D NMF source refinement.
// Build synthetic spectrograms with known source content and check that
// NMF activations spike at the right times per source stream.

import { refineSourcesNMF } from '../src/audio/nmf.js';
import { hzToBin } from '../src/audio/stft.js';

const SR = 44100;
const FRAME = 2048;
const NUM_BINS = FRAME / 2 + 1;
const NUM_FRAMES = 400;

function makeSpec() { return new Float32Array(NUM_FRAMES * NUM_BINS); }

function putHit(spec, frame, lowHz, highHz, amp, decayFrames = 6) {
  const lo = hzToBin(lowHz, SR, FRAME);
  const hi = Math.min(NUM_BINS - 1, hzToBin(highHz, SR, FRAME));
  for (let df = 0; df < decayFrames; df++) {
    const f = frame + df;
    if (f >= NUM_FRAMES) break;
    const a = amp * Math.exp(-df / 3);
    const base = f * NUM_BINS;
    for (let k = lo; k < hi; k++) spec[base + k] += a;
  }
}

function putSustained(spec, startFrame, endFrame, lowHz, highHz, amp) {
  const lo = hzToBin(lowHz, SR, FRAME);
  const hi = Math.min(NUM_BINS - 1, hzToBin(highHz, SR, FRAME));
  for (let f = startFrame; f < endFrame && f < NUM_FRAMES; f++) {
    const base = f * NUM_BINS;
    for (let k = lo; k < hi; k++) spec[base + k] += amp;
  }
}

let pass = 0, fail = 0;
function check(name, cond, msg) {
  if (cond) { console.log('PASS ' + name); pass++; }
  else      { console.log('FAIL ' + name + ' — ' + msg); fail++; }
}

// Find peak frame in a curve, within a window
function peakIn(curve, from, to) {
  let maxIdx = from, maxVal = -Infinity;
  for (let i = from; i <= to && i < curve.length; i++) {
    if (curve[i] > maxVal) { maxVal = curve[i]; maxIdx = i; }
  }
  return { idx: maxIdx, val: maxVal };
}

// --- Test 1: Kick-only spectrogram → kick activation highest ---
{
  const mag = makeSpec();
  for (let hit = 0; hit < 5; hit++) {
    const f = 50 + hit * 60;
    putHit(mag, f, 40, 120, 8.0);
  }
  const t0 = performance.now();
  const src = refineSourcesNMF(mag, NUM_FRAMES, NUM_BINS, SR, FRAME);
  const elapsed = performance.now() - t0;
  console.log(`  NMF elapsed: ${elapsed.toFixed(0)} ms (${NUM_FRAMES} frames × 12 templates × 40 iters)`);
  check('NMF returned all 4 sources', src && src.kick && src.snare && src.hihat && src.melody);

  const kickSum = src.kick.reduce((a, b) => a + b, 0);
  const hihatSum = src.hihat.reduce((a, b) => a + b, 0);
  const melodySum = src.melody.reduce((a, b) => a + b, 0);
  check('kick-only: kick stream dominates hihat', kickSum > hihatSum * 3,
        `kick=${kickSum.toFixed(1)} hihat=${hihatSum.toFixed(1)}`);
  check('kick-only: kick stream dominates melody', kickSum > melodySum * 2,
        `kick=${kickSum.toFixed(1)} melody=${melodySum.toFixed(1)}`);
}

// --- Test 2: Hi-hat only → hihat activation highest ---
{
  const mag = makeSpec();
  for (let hit = 0; hit < 10; hit++) {
    const f = 30 + hit * 30;
    putHit(mag, f, 7000, 15000, 4.0, 3);
  }
  const src = refineSourcesNMF(mag, NUM_FRAMES, NUM_BINS, SR, FRAME);
  const hihatSum = src.hihat.reduce((a, b) => a + b, 0);
  const kickSum = src.kick.reduce((a, b) => a + b, 0);
  check('hihat-only: hihat stream dominates kick', hihatSum > kickSum * 3,
        `hihat=${hihatSum.toFixed(1)} kick=${kickSum.toFixed(1)}`);
}

// --- Test 3: Sustained melody in mid range → melody stream shows sustained pattern ---
{
  const mag = makeSpec();
  putSustained(mag, 50, 250, 400, 2500, 3.0);
  const src = refineSourcesNMF(mag, NUM_FRAMES, NUM_BINS, SR, FRAME);
  const melodySum = src.melody.reduce((a, b) => a + b, 0);
  const kickSum = src.kick.reduce((a, b) => a + b, 0);
  check('sustained mid: melody stream dominates kick', melodySum > kickSum * 2,
        `melody=${melodySum.toFixed(1)} kick=${kickSum.toFixed(1)}`);
  // Melody should be roughly sustained between frames 50-250
  const midEnergy = src.melody.slice(80, 220).reduce((a, b) => a + b, 0);
  const totalEnergy = melodySum;
  check('sustained mid: melody energy concentrates in 80-220',
        midEnergy / totalEnergy > 0.5,
        `${(midEnergy/totalEnergy*100).toFixed(0)}% in window`);
}

// --- Test 4: Combined (kick + hihat interleaved) → each stream fires at its times ---
{
  const mag = makeSpec();
  // Kicks every 80 frames starting at 40
  for (let hit = 0; hit < 4; hit++) putHit(mag, 40 + hit * 80, 40, 120, 8.0);
  // Hats every 40 frames starting at 20
  for (let hit = 0; hit < 8; hit++) putHit(mag, 20 + hit * 40, 7000, 15000, 4.0, 3);

  const src = refineSourcesNMF(mag, NUM_FRAMES, NUM_BINS, SR, FRAME);

  // Kick peak near frame 42 (accounting for reduced-res upsampling)
  const kickPeak = peakIn(src.kick, 30, 55);
  check('combined: kick stream peaks near first kick',
        kickPeak.idx >= 35 && kickPeak.idx <= 55,
        `peak at frame ${kickPeak.idx}`);

  const hihatPeak = peakIn(src.hihat, 10, 35);
  check('combined: hihat stream peaks near first hat',
        hihatPeak.idx >= 15 && hihatPeak.idx <= 35,
        `peak at frame ${hihatPeak.idx}`);
}

// --- Test 5: Output arrays are correct length ---
{
  const mag = makeSpec();
  putHit(mag, 100, 50, 100, 5.0);
  const src = refineSourcesNMF(mag, NUM_FRAMES, NUM_BINS, SR, FRAME);
  check('kick length matches numFrames', src.kick.length === NUM_FRAMES);
  check('snare length matches numFrames', src.snare.length === NUM_FRAMES);
  check('hihat length matches numFrames', src.hihat.length === NUM_FRAMES);
  check('melody length matches numFrames', src.melody.length === NUM_FRAMES);
}

// --- Test 6: Too-short input returns null gracefully ---
{
  const shortSpec = new Float32Array(10 * NUM_BINS);
  const src = refineSourcesNMF(shortSpec, 10, NUM_BINS, SR, FRAME);
  check('too-short input returns null', src === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
