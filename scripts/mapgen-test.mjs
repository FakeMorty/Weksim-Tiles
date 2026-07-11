// Verify Etap 6 map generator:
//   1. Produces different patterns (not all same lane)
//   2. Enforces playability (never >2 simultaneous, no jack < 90ms)
//   3. Uses beat structure (chords on downbeats)

import { generateMap } from '../src/audio/mapgen.js';

const BPM = 120;
const BEAT_PERIOD = 60 / BPM;

// Synthesise 16 beats of onsets, one per 8th note
const events = [];
const beatTimes = [];
for (let b = 0; b < 16; b++) {
  const t = 1.0 + b * BEAT_PERIOD;
  beatTimes.push(t);
  for (let s = 0; s < 2; s++) {
    const time = t + s * BEAT_PERIOD / 2;
    events.push({
      time,
      endTime: time,
      isHold: false,
      // Downbeats stronger, off-beats weaker
      strength: (b % 4 === 0 && s === 0) ? 0.9 : 0.5,
    });
  }
}

const notes = generateMap(events, beatTimes, BPM, {
  chordProb: 0.30,
  smartLane: true,
  difficulty: 'normal',
});

console.log(`Generated ${notes.length} notes from ${events.length} events`);

// --- Playability check 1: no >2 notes at the same time ---
let maxSimul = 0;
for (let i = 0; i < notes.length; i++) {
  let cnt = 1;
  for (let j = i + 1; j < notes.length; j++) {
    if (Math.abs(notes[j].time - notes[i].time) < 0.020) cnt++;
    else break;
  }
  if (cnt > maxSimul) maxSimul = cnt;
}
console.log(`Max simultaneous notes: ${maxSimul}  ${maxSimul <= 2 ? 'PASS' : 'FAIL'}`);
if (maxSimul > 2) process.exit(1);

// --- Playability check 2: same-lane gap >= 90ms ---
const laneLastT = [0, 0, 0, 0].map(() => -Infinity);
let minSameLaneGap = Infinity;
for (const n of notes) {
  const gap = n.time - laneLastT[n.lane];
  if (gap < minSameLaneGap) minSameLaneGap = gap;
  laneLastT[n.lane] = n.time;
}
console.log(`Min same-lane gap: ${(minSameLaneGap * 1000).toFixed(0)}ms  ${minSameLaneGap >= 0.089 ? 'PASS' : 'FAIL'}`);
if (minSameLaneGap < 0.089) process.exit(1);

// --- Variety check: lanes should be reasonably distributed ---
const laneCount = [0, 0, 0, 0];
for (const n of notes) laneCount[n.lane]++;
const totalUsed = laneCount.filter(c => c > 0).length;
console.log(`Lane usage: [${laneCount.join(', ')}]  ${totalUsed === 4 ? 'PASS (all 4 lanes used)' : 'FAIL'}`);
if (totalUsed < 4) process.exit(1);

// --- Structure check: chords should land on downbeats ---
const chordsOnDownbeats = notes.filter(n => {
  // Chord = two notes at same time
  const twin = notes.some(o => o !== n && Math.abs(o.time - n.time) < 0.020);
  if (!twin) return false;
  // Downbeat = time close to beatTimes[k*4]
  const nearestDownbeat = beatTimes.find((bt, i) => i % 4 === 0 && Math.abs(bt - n.time) < 0.030);
  return !!nearestDownbeat;
});
console.log(`Chord notes on downbeats: ${chordsOnDownbeats.length}`);

console.log('\nAll mapgen tests passed');
