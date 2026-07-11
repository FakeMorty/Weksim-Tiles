// Verify that HPSS-lite (median filter across frequency) actually suppresses
// sustained tones while keeping transients. Synthesises a track with:
//   - a constant 80 Hz sustained tone (mimics Reese bass)
//   - kick-like bursts at 60 Hz every 500 ms
// Then compares onsets found WITHOUT vs WITH percussive enhance.

import { computeSpectrogram } from '../src/audio/stft.js';
import { computeMultibandFlux, weightedFlux, MODE_WEIGHTS } from '../src/audio/spectralFlux.js';
import { pickPeaks } from '../src/audio/onsets.js';
import { percussiveEnhance } from '../src/audio/percussive.js';

const SR = 44100;
const DURATION = 6;
const N = SR * DURATION;
const pcm = new Float32Array(N);

// Constant sustained bass tone (0.15 amplitude) — the analyzer should NOT
// treat this as a stream of onsets, but the plain flux will pick up every
// modulation as a false hit.
for (let i = 0; i < N; i++) {
  // Slight vibrato to simulate a real "dirty" bass
  const vibrato = Math.sin(2 * Math.PI * 5 * i / SR) * 0.3;
  pcm[i] += Math.sin(2 * Math.PI * (80 + vibrato) * i / SR) * 0.15;
}

// Kick bursts at 1.0, 1.5, 2.0 ... 5.5
const kickTimes = [];
for (let t = 1.0; t <= 5.5; t += 0.5) kickTimes.push(t);
for (const t of kickTimes) {
  const start = Math.floor(t * SR);
  for (let i = 0; i < SR * 0.08; i++) {
    const env = Math.exp(-i / (SR * 0.02));
    pcm[start + i] += Math.sin(2 * Math.PI * 60 * i / SR) * env * 0.85;
  }
}

const FRAME = 2048, HOP = 512;
const spec = computeSpectrogram(pcm, FRAME, HOP);
const framesPerSec = SR / HOP;

function analyzeWith(mag) {
  const { fluxBands } = computeMultibandFlux({ ...spec, mag }, SR);
  const novelty = weightedFlux(fluxBands, MODE_WEIGHTS.drums);
  return pickPeaks(novelty, { framesPerSec, alpha: 1.5, delta: 0.03, minGapSec: 0.15 });
}

const withoutHpss = analyzeWith(spec.mag);
const percMag = percussiveEnhance(spec.mag, spec.numFrames, spec.numBins, 17);
const withHpss = analyzeWith(percMag);

console.log(`Kicks in signal:      ${kickTimes.length}`);
console.log(`Onsets WITHOUT HPSS:  ${withoutHpss.length}`);
console.log(`Onsets WITH    HPSS:  ${withHpss.length}`);

// Kicks are the "real" events. Anything else is a false positive from bass wobble.
function recall(peaks) {
  let hits = 0;
  for (const kt of kickTimes) {
    if (peaks.some(p => Math.abs(p.time - kt) < 0.08)) hits++;
  }
  return hits;
}

const r1 = recall(withoutHpss);
const r2 = recall(withHpss);
const fp1 = withoutHpss.length - r1;
const fp2 = withHpss.length - r2;

console.log(`\nWithout HPSS: ${r1}/${kickTimes.length} kicks + ${fp1} false onsets`);
console.log(`With    HPSS: ${r2}/${kickTimes.length} kicks + ${fp2} false onsets`);
console.log(`False-positive reduction: ${fp1 - fp2} (${fp1 ? Math.round((1 - fp2/fp1) * 100) : 0}%)`);

if (r2 < kickTimes.length * 0.75) {
  console.log('\n✗ FAIL: HPSS destroyed too many real kicks');
  process.exit(1);
}
if (fp2 >= fp1) {
  console.log('\n✗ FAIL: HPSS did not reduce false positives');
  process.exit(1);
}
console.log('\n✓ HPSS-lite works: kicks preserved, false onsets suppressed');
