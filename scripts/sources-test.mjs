// Test Etap C source separation.
// Synth: build fake percussive + harmonic mag spectrograms and check that
// buildSourceEnvelopes routes energy to the right stream.

import { buildSourceEnvelopes, mergeSourceOnsets, pickPrimary } from '../src/audio/sources.js';
import { hzToBin } from '../src/audio/stft.js';

const SR = 44100;
const FRAME = 2048;
const NUM_BINS = FRAME / 2 + 1;
const NUM_FRAMES = 300;

function makeSpec() {
  return new Float32Array(NUM_FRAMES * NUM_BINS);
}

function putEnergy(spec, frame, lowHz, highHz, amp) {
  const lo = hzToBin(lowHz, SR, FRAME);
  const hi = Math.min(NUM_BINS - 1, hzToBin(highHz, SR, FRAME));
  const base = frame * NUM_BINS;
  for (let k = lo; k < hi; k++) spec[base + k] = amp;
}

let pass = 0, fail = 0;
function check(name, cond, msg) {
  if (cond) { console.log('PASS ' + name); pass++; }
  else      { console.log('FAIL ' + name + ' — ' + msg); fail++; }
}

// --- Test 1: pure kick pulse in P mask ---
{
  const magP = makeSpec();
  const magH = makeSpec();
  // Kick hit at frame 50: sub-bass only
  for (let f = 50; f < 55; f++) putEnergy(magP, f, 30, 90, 5.0);

  const src = buildSourceEnvelopes(magP, magH, NUM_FRAMES, NUM_BINS, SR, FRAME);
  // Peak of kick flux should be near frame 50
  let maxIdx = 0, maxVal = 0;
  for (let i = 0; i < src.kick.length; i++) {
    if (src.kick[i] > maxVal) { maxVal = src.kick[i]; maxIdx = i; }
  }
  check('kick pulse triggers kick stream', maxIdx >= 49 && maxIdx <= 52, `got frame ${maxIdx}`);
  check('kick pulse does NOT trigger hihat stream',
        Math.max(...src.hihat) < 0.1, `hihat peak ${Math.max(...src.hihat).toFixed(3)}`);
  check('kick pulse does NOT trigger snare stream',
        Math.max(...src.snare) < 0.5, `snare peak ${Math.max(...src.snare).toFixed(3)}`);
}

// --- Test 2: pure hi-hat ---
{
  const magP = makeSpec();
  const magH = makeSpec();
  for (let f = 100; f < 103; f++) putEnergy(magP, f, 8000, 15000, 3.0);

  const src = buildSourceEnvelopes(magP, magH, NUM_FRAMES, NUM_BINS, SR, FRAME);
  const hatMax = Math.max(...src.hihat);
  const kickMax = Math.max(...src.kick);
  check('hihat pulse triggers hihat', hatMax > 3, `got ${hatMax.toFixed(3)}`);
  check('hihat pulse does not trigger kick', kickMax < 0.5, `kick=${kickMax.toFixed(3)}`);
}

// --- Test 3: snare needs BOTH low crack and high body ---
{
  // Pure low-mid alone should NOT fire snare
  const magP1 = makeSpec();
  const magH1 = makeSpec();
  for (let f = 100; f < 103; f++) putEnergy(magP1, f, 200, 400, 3.0);
  const src1 = buildSourceEnvelopes(magP1, magH1, NUM_FRAMES, NUM_BINS, SR, FRAME);
  const snareOnlyLow = Math.max(...src1.snare);

  // Both low crack + high body — this should
  const magP2 = makeSpec();
  const magH2 = makeSpec();
  for (let f = 100; f < 103; f++) {
    putEnergy(magP2, f, 200, 400,  3.0);
    putEnergy(magP2, f, 2500, 4500, 3.0);
  }
  const src2 = buildSourceEnvelopes(magP2, magH2, NUM_FRAMES, NUM_BINS, SR, FRAME);
  const snareBoth = Math.max(...src2.snare);
  check('snare fires when both bands present', snareBoth > 3, `got ${snareBoth.toFixed(3)}`);
  check('snare stays quiet when only low body', snareOnlyLow < 0.5, `got ${snareOnlyLow.toFixed(3)}`);
}

// --- Test 4: melody uses harmonic mask ---
{
  const magP = makeSpec();
  const magH = makeSpec();
  for (let f = 50; f < 200; f++) putEnergy(magH, f, 400, 2000, 2.0);

  const src = buildSourceEnvelopes(magP, magH, NUM_FRAMES, NUM_BINS, SR, FRAME);
  const melMax = Math.max(...src.melody);
  const kickMax = Math.max(...src.kick);
  check('melody triggered by harmonic mid', melMax > 1, `got ${melMax.toFixed(3)}`);
  check('melody stays quiet in kick stream', kickMax < 0.1, `got ${kickMax.toFixed(3)}`);
}

// --- Test 5: mergeSourceOnsets groups close events ---
{
  const bySource = {
    kick:   [{ time: 1.000, strength: 5, frame: 86 }],
    snare:  [{ time: 1.015, strength: 3, frame: 87 }],
    hihat:  [{ time: 1.020, strength: 2, frame: 87 }],
  };
  const merged = mergeSourceOnsets(bySource, 40);
  check('close events merged into single', merged.length === 1, `got ${merged.length}`);
  check('merged sources listed all three',
        merged[0].sources.length === 3, `got ${merged[0].sources}`);
  check('merged primary is strongest (kick)',
        merged[0].primary === 'kick', `got ${merged[0].primary}`);
}

// --- Test 6: mergeSourceOnsets keeps distant events separate ---
{
  const bySource = {
    kick:   [{ time: 1.0, strength: 5, frame: 86 }, { time: 2.0, strength: 5, frame: 172 }],
    hihat:  [{ time: 1.5, strength: 2, frame: 129 }],
  };
  const merged = mergeSourceOnsets(bySource, 40);
  check('distant events not merged', merged.length === 3, `got ${merged.length}`);
}

// --- Test 7: pickPrimary priority ---
{
  check('priority: kick beats everything',   pickPrimary(['hihat', 'kick', 'snare']) === 'kick');
  check('priority: snare beats melody+hat',   pickPrimary(['hihat', 'melody', 'snare']) === 'snare');
  check('priority: melody beats hat',         pickPrimary(['hihat', 'melody']) === 'melody');
  check('priority: single source returned',   pickPrimary(['hihat']) === 'hihat');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
