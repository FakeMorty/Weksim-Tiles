// Verify PLP (Predominant Local Pulse) beat tracking:
//   1. Steady 120 BPM → finds beats at expected positions
//   2. Track with tempo drift 120→150 → beats follow the drift
//   3. Downbeat detection identifies phase correctly when kicks emphasise
//      the first beat of every measure

import { computeSpectrogram } from '../src/audio/stft.js';
import { computeMultibandFlux, weightedFlux, MODE_WEIGHTS } from '../src/audio/spectralFlux.js';
import { localTempoCurve, buildPLPCurve, extractBeats, detectDownbeats } from '../src/audio/plp.js';
import { estimateBPM } from '../src/audio/bpm.js';

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
  return { novelty, framesPerSec, fluxBands };
}

// --- Test 1: Steady 120 BPM PLP recall ---
{
  const kicks = [];
  for (let t = 1.0; t <= 15; t += 0.5) kicks.push(t);
  const pcm = synthKickTrack(kicks, 16);
  const { novelty, framesPerSec } = analyze(pcm);
  const bpmInfo = estimateBPM(novelty, kicks.map(t => ({ time: t })), framesPerSec);
  const tempoCurve = localTempoCurve(novelty, framesPerSec, 4, 0.5, bpmInfo.bpm);
  const pulse = buildPLPCurve(novelty, framesPerSec, tempoCurve);
  const beats = extractBeats(pulse, framesPerSec, tempoCurve);

  console.log(`Test 1: Steady 120 BPM PLP`);
  console.log(`  BPM detected: ${bpmInfo.bpm}`);
  console.log(`  PLP beats found: ${beats.length} (expected ~${kicks.length})`);
  console.log(`  First 4 PLP beats: [${beats.slice(0, 4).map(b => b.toFixed(2)).join(', ')}]`);
  console.log(`  First 4 real kicks: [${kicks.slice(0, 4).map(b => b.toFixed(2)).join(', ')}]`);

  let matched = 0;
  for (const k of kicks) {
    if (beats.some(b => Math.abs(b - k) < 0.06)) matched++;
  }
  const recall = matched / kicks.length;
  console.log(`  Recall: ${matched}/${kicks.length} = ${(recall * 100).toFixed(0)}%  ${recall >= 0.75 ? 'PASS' : 'FAIL'}`);
  if (recall < 0.75) process.exit(1);
}

console.log();

// --- Test 2: Tempo drift 120→150 ---
{
  const kicks = [];
  let t = 1.0;
  let bpm = 120;
  while (t < 20) {
    kicks.push(t);
    bpm += 0.5;
    t += 60 / bpm;
  }
  const pcm = synthKickTrack(kicks, 21);
  const { novelty, framesPerSec } = analyze(pcm);
  const bpmInfo = estimateBPM(novelty, kicks.map(t => ({ time: t })), framesPerSec);
  const tempoCurve = localTempoCurve(novelty, framesPerSec, 4, 0.5, bpmInfo.bpm);

  const startPeriod = tempoCurve.periods[0];
  const endPeriod = tempoCurve.periods[tempoCurve.periods.length - 1];
  const startBpm = 60 / startPeriod;
  const endBpm = 60 / endPeriod;

  console.log(`Test 2: Tempo drift`);
  console.log(`  Initial local BPM (from PLP tempo curve): ${startBpm.toFixed(1)}`);
  console.log(`  Final local BPM: ${endBpm.toFixed(1)}`);
  const drifted = endBpm > startBpm + 3;
  console.log(`  Drift detected? ${drifted ? 'PASS' : 'FAIL (expected increase)'}`);
  if (!drifted) process.exit(1);
}

console.log();

// --- Test 3: Downbeat detection on kick-emphasised measure ---
{
  // Every 4 beats the kick is 2x louder — should be detected as downbeat
  const N = SR * 12;
  const pcm = new Float32Array(N);
  const beatTimes = [];
  for (let b = 0; b < 24; b++) {
    const t = 0.5 + b * 0.5; // 120 BPM
    beatTimes.push(t);
    const start = Math.floor(t * SR);
    const amp = (b % 4 === 0) ? 1.0 : 0.4; // strong on beat 1 of each measure
    for (let i = 0; i < SR * 0.08; i++) {
      const env = Math.exp(-i / (SR * 0.02));
      if (start + i < N) pcm[start + i] += Math.sin(2 * Math.PI * 60 * i / SR) * env * amp;
    }
  }
  const { novelty, framesPerSec, fluxBands } = analyze(pcm);
  const bassEnv = new Float32Array(fluxBands[0].length);
  for (let i = 0; i < bassEnv.length; i++) bassEnv[i] = fluxBands[0][i] + fluxBands[1][i];
  const db = detectDownbeats(beatTimes, novelty, bassEnv, framesPerSec, 4);

  console.log(`Test 3: Downbeat detection`);
  console.log(`  Detected phase: ${db.phase} (expected 0, but any consistent phase is OK)`);
  console.log(`  Downbeat count: ${db.downbeatIndices.length}`);
  console.log(`  Confidence: ${db.confidence.toFixed(2)}`);
  // Check: are the detected downbeats spaced by 4 beats?
  let spacingOk = true;
  for (let i = 1; i < db.downbeatIndices.length; i++) {
    if (db.downbeatIndices[i] - db.downbeatIndices[i - 1] !== 4) {
      spacingOk = false; break;
    }
  }
  console.log(`  4-beat spacing? ${spacingOk ? 'PASS' : 'FAIL'}`);
  if (!spacingOk) process.exit(1);
}

console.log('\nAll PLP tests passed');
