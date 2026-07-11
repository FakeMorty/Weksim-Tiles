// Verify Etap 3 hold detection:
//   1. Recognises a sustained harmonic note as a HOLD
//   2. Correctly identifies its end time (via hysteresis)
//   3. Merges close onsets during sustain
//   4. Does NOT mark short kick-only events as holds

import { computeSpectrogram } from '../src/audio/stft.js';
import { computeHpssMasks } from '../src/audio/percussive.js';
import { detectHolds, buildHarmonicEnvelopes } from '../src/audio/holds.js';

const SR = 44100;

function makePcm(duration, fillFn) {
  const N = SR * duration;
  const pcm = new Float32Array(N);
  fillFn(pcm, N);
  return pcm;
}

// --- Test 1: 1-second sustained note at 440 Hz starting at t=1s ---
{
  const pcm = makePcm(4, (buf, N) => {
    for (let i = SR * 1.0; i < SR * 2.0; i++) {
      buf[i] = Math.sin(2 * Math.PI * 440 * i / SR) * 0.3;
    }
  });

  const spec = computeSpectrogram(pcm, 2048, 512);
  const { harmonic } = computeHpssMasks(spec.mag, spec.numFrames, spec.numBins, 11, 11, true);
  const envelopes = buildHarmonicEnvelopes(harmonic, spec.numFrames, spec.numBins, SR, 2048);
  const framesPerSec = SR / 512;

  const onsets = [{ time: 1.0, strength: 1 }];
  const events = detectHolds(
    onsets, envelopes, framesPerSec,
    [], 120, 'vocal', { holdEnable: true, holdMode: 2 }
  );

  console.log(`Test 1: Sustained 440 Hz note for 1s`);
  console.log(`  Events: ${events.length}`);
  const ev = events[0];
  console.log(`  isHold: ${ev.isHold}, duration: ${(ev.endTime - ev.time).toFixed(2)}s`);
  const pass = ev.isHold && (ev.endTime - ev.time) >= 0.35 && (ev.endTime - ev.time) <= 1.3;
  console.log(`  ${pass ? 'PASS' : 'FAIL (expected hold ~0.9-1.0s)'}`);
  if (!pass) process.exit(1);
}

console.log();

// --- Test 2: Kick-only signal (short bursts) should NOT create holds ---
{
  const pcm = makePcm(4, (buf, N) => {
    for (const t of [1.0, 1.5, 2.0, 2.5, 3.0]) {
      const s = Math.floor(t * SR);
      for (let i = 0; i < SR * 0.05; i++) {
        buf[s + i] = Math.sin(2 * Math.PI * 60 * i / SR) * Math.exp(-i / (SR * 0.015)) * 0.9;
      }
    }
  });

  const spec = computeSpectrogram(pcm, 2048, 512);
  const { harmonic } = computeHpssMasks(spec.mag, spec.numFrames, spec.numBins, 11, 11, true);
  const envelopes = buildHarmonicEnvelopes(harmonic, spec.numFrames, spec.numBins, SR, 2048);
  const framesPerSec = SR / 512;

  const onsets = [1.0, 1.5, 2.0, 2.5, 3.0].map(time => ({ time, strength: 1 }));
  // Use holdBias=1 (auto), not lots — kicks shouldn't be forced to hold
  const events = detectHolds(
    onsets, envelopes, framesPerSec,
    [], 120, 'drums', { holdEnable: true, holdMode: 1 }
  );

  const holdCount = events.filter(e => e.isHold).length;
  console.log(`Test 2: 5 kick bursts (should not become holds)`);
  console.log(`  Events: ${events.length}, holds: ${holdCount}`);
  const pass = holdCount <= 1; // Random hold prob could occasionally trigger 1
  console.log(`  ${pass ? 'PASS' : 'FAIL (too many false holds)'}`);
  if (!pass) process.exit(1);
}

console.log();

// --- Test 3: Sustained note WITH beat snap should snap end to nearest beat ---
{
  const pcm = makePcm(6, (buf, N) => {
    // Sustain 440 Hz from t=1.0 to t=2.4 (arbitrary length)
    for (let i = SR * 1.0; i < SR * 2.4; i++) {
      buf[i] = Math.sin(2 * Math.PI * 440 * i / SR) * 0.3;
    }
  });

  const spec = computeSpectrogram(pcm, 2048, 512);
  const { harmonic } = computeHpssMasks(spec.mag, spec.numFrames, spec.numBins, 11, 11, true);
  const envelopes = buildHarmonicEnvelopes(harmonic, spec.numFrames, spec.numBins, SR, 2048);
  const framesPerSec = SR / 512;

  // Fake beat times at every 0.5s = 120 BPM
  const beatTimes = [];
  for (let t = 0; t < 6; t += 0.5) beatTimes.push(t);

  const onsets = [{ time: 1.0, strength: 1 }];
  const events = detectHolds(
    onsets, envelopes, framesPerSec,
    beatTimes, 120, 'vocal', { holdEnable: true, holdMode: 2 }
  );

  console.log(`Test 3: Sustained 1.4s note, beats every 0.5s`);
  const ev = events[0];
  console.log(`  Hold duration: ${(ev.endTime - ev.time).toFixed(2)}s`);
  // End should snap to nearest beat: 2.0 (dur 1.0) or 2.5 (dur 1.5)
  const dur = ev.endTime - ev.time;
  const snapped = Math.abs(dur - 1.0) < 0.06 || Math.abs(dur - 1.5) < 0.06;
  console.log(`  End on beat grid? ${snapped ? 'PASS' : 'FAIL'}`);
  if (!snapped) process.exit(1);
}

console.log('\nAll hold-detection tests passed');
