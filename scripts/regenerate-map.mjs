// Regenerate a map from an exported .wtmap.json using the current mapgen.
// Compares the OLD note distribution against what the NEW generator produces
// for the same set of onsets.

import fs from 'node:fs';
import { generateMap } from '../src/audio/mapgen.js';

const inFile = process.argv[2];
const difficulty = process.argv[3] || 'expert';
if (!inFile) { console.log('usage: node regenerate-map.mjs <wtmap.json> [difficulty]'); process.exit(1); }

const d = JSON.parse(fs.readFileSync(inFile, 'utf8'));
console.log('Source: ' + inFile);
console.log('  original notes: ' + d.notes.length + ' at difficulty ' + d.meta.difficulty);
console.log('  BPM: ' + d.bpm);

// Reconstruct events from the exported notes (we don't have raw bands here,
// so classification will fall back to pattern-based routing — but we still
// gain the broken-stream fix).
const events = d.notes.map(n => ({
  time: n.t,
  endTime: n.e,
  isHold: !!n.h,
  strength: 1,     // no per-note strength in export format
  bands: null,     // no band info in export
}));

const notes = generateMap(events, d.beatTimes || [], d.bpm, {
  chordProb: 0.06,
  smartLane: true,
  difficulty,
});

function analyzeDistribution(label, notesArr) {
  console.log('\n' + label + ':');
  console.log('  total: ' + notesArr.length);
  const laneCount = [0, 0, 0, 0];
  for (const n of notesArr) laneCount[n.lane ?? n.l]++;
  console.log('  lane distribution: [' + laneCount.join(', ') + ']');
  let stair = 0, jack = 0, jump2 = 0, jump3 = 0;
  for (let i = 1; i < notesArr.length; i++) {
    const gap = (notesArr[i].time ?? notesArr[i].t) - (notesArr[i-1].time ?? notesArr[i-1].t);
    if (gap > 0.5) continue;
    const diff = Math.abs((notesArr[i].lane ?? notesArr[i].l) - (notesArr[i-1].lane ?? notesArr[i-1].l));
    if (diff === 0) jack++;
    else if (diff === 1) stair++;
    else if (diff === 2) jump2++;
    else if (diff === 3) jump3++;
  }
  const total = stair + jack + jump2 + jump3;
  console.log('  transitions (<500ms gap):');
  console.log('    stair (±1): ' + stair + ' (' + (stair*100/total).toFixed(0) + '%)');
  console.log('    jack (=0):  ' + jack + ' (' + (jack*100/total).toFixed(0) + '%)');
  console.log('    jump (±2):  ' + jump2 + ' (' + (jump2*100/total).toFixed(0) + '%)');
  console.log('    jump (±3):  ' + jump3 + ' (' + (jump3*100/total).toFixed(0) + '%)');
}

analyzeDistribution('OLD (v1.18 output from JSON)', d.notes);
analyzeDistribution('NEW (v1.19 regenerated at ' + difficulty + ')', notes);
