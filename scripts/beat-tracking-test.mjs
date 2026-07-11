// Verify that Ellis DP beat tracking:
//   1. Finds beats close to ground truth on a clean synthetic signal
//   2. Handles a track that starts with silence (offset intro)
//   3. Detects tempo drift via tempogram

import { computeSpectrogram } from '../src/audio/stft.js';
import { computeMultibandFlux, weightedFlux, MODE_WEIGHTS } from '../src/audio/spectralFlux.js';
import { estimateBPM, computeTempogram } from '../src/audio/bpm.js';
import { trackBeats, snapToTrackedBeats } from '../src/audio/beatTracking.js';

const SR = 44100;

function synthKickTrack(kickTimes, durationSec) {
  const N = SR * durationSec;
  const pcm = new Float32Array(N);
  for (const t of kickTimes) {
    const start = Math.floor(t * SR);
    for (let i = 0; i < SR * 0.08; i++) {
      const env = Math.exp(-i / (SR * 0.02));
      if (start + i < N) pcm[start + i] += Math.sin(2 * Math.PI * 60 * i / SR) * env * 0.85;
    }
  }
  return pcm;
}

function analyze(pcm) {
  const spec = computeSpectrogram(pcm, 2048, 512);
  const framesPerSec = SR / 512;
  const { fluxBands } = computeMultibandFlux(spec, SR);
  const novelty = weightedFlux(fluxBands, MODE_WEIGHTS.drums);
  return { novelty, framesPerSec };
}

// --- Test 1: Steady 120 BPM starting at t=1s (has intro silence) ---
{
  const kicks = [];
  for (let t = 1.0; t <= 9.5; t += 0.5) kicks.push(t);
  const pcm = synthKickTrack(kicks, 10);
  const { novelty, framesPerSec } = analyze(pcm);
  const bpmInfo = estimateBPM(novelty, kicks.map(t => ({ time: t })), framesPerSec);
  const { beats } = trackBeats(novelty, framesPerSec, bpmInfo.bpm);

  console.log(`Test 1: Steady 120 BPM, intro=1s`);
  console.log(`  BPM detected: ${bpmInfo.bpm} (expected 120)`);
  console.log(`  Beats found: ${beats.length} (expected ~${kicks.length})`);
  console.log(`  First 4 tracked beats: [${beats.slice(0, 4).map(b => b.toFixed(2)).join(', ')}]`);
  console.log(`  First 4 real kicks:    [${kicks.slice(0, 4).map(b => b.toFixed(2)).join(', ')}]`);

  // How close are tracked beats to real kicks?
  let matched = 0;
  for (const k of kicks) {
    if (beats.some(b => Math.abs(b - k) < 0.06)) matched++;
  }
  const recall = matched / kicks.length;
  console.log(`  Beat/kick recall: ${matched}/${kicks.length} = ${(recall * 100).toFixed(0)}%  ${recall >= 0.75 ? 'PASS' : 'FAIL'}`);
  if (recall < 0.75) process.exit(1);
}

console.log();

// --- Test 2: Tempo drift 120 -> 140 BPM should be detected ---
{
  const kicks = [];
  let t = 1.0;
  let bpm = 120;
  while (t < 14) {
    kicks.push(t);
    // Ramp BPM slowly
    bpm += 0.5;
    t += 60 / bpm;
  }
  const pcm = synthKickTrack(kicks, 15);
  const { novelty, framesPerSec } = analyze(pcm);
  const tempogram = computeTempogram(novelty, framesPerSec, 4, 2);

  console.log(`Test 2: Tempo drift 120 -> ~${bpm.toFixed(0)} BPM`);
  console.log(`  Tempogram windows: ${tempogram.windows.length}`);
  console.log(`  BPM range across windows: ${tempogram.drift.toFixed(1)}`);
  console.log(`  Stable? ${tempogram.stable}  ${!tempogram.stable ? 'PASS' : 'FAIL (should detect drift)'}`);
  if (tempogram.stable) process.exit(1);
}

console.log();

// --- Test 3: Snap-to-beats moves misaligned onsets onto the grid ---
{
  const kicks = [];
  for (let t = 1.0; t <= 5.5; t += 0.5) kicks.push(t);
  const pcm = synthKickTrack(kicks, 6);
  const { novelty, framesPerSec } = analyze(pcm);
  const bpmInfo = estimateBPM(novelty, kicks.map(t => ({ time: t })), framesPerSec);
  const { beats } = trackBeats(novelty, framesPerSec, bpmInfo.bpm);

  // Simulate off-grid onsets: real kicks shifted by ~30 ms
  const offGrid = kicks.map(t => t + (Math.random() - 0.5) * 0.06);
  const snapped = snapToTrackedBeats(offGrid, beats, 4, 90);

  let totalShift = 0, snappedCount = 0;
  for (let i = 0; i < offGrid.length; i++) {
    const shift = Math.abs(snapped[i] - offGrid[i]);
    if (shift > 0.001) snappedCount++;
    totalShift += shift;
  }
  console.log(`Test 3: Snap off-grid onsets to tracked beats`);
  console.log(`  Snapped ${snappedCount}/${offGrid.length} onsets, avg shift ${(totalShift/offGrid.length*1000).toFixed(1)} ms`);

  // After snap, most should be within 5 ms of the beat grid
  let onGrid = 0;
  for (const s of snapped) {
    if (beats.some(b => Math.abs(b - s) < 0.005)) onGrid++;
  }
  console.log(`  On grid after snap: ${onGrid}/${snapped.length}  ${onGrid >= snapped.length * 0.7 ? 'PASS' : 'FAIL'}`);
  if (onGrid < snapped.length * 0.7) process.exit(1);
}

console.log('\nAll beat-tracking tests passed');
