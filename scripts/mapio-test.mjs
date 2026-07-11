// Verify Etap 10 export/import round-trip preserves note data.

import { exportMap, importMap } from '../src/audio/mapIO.js';

const source = {
  notes: [
    { time: 1.234,  endTime: 1.234, lane: 0, isHold: false, judged: true, holding: false, holdProgress: 0 },
    { time: 2.000,  endTime: 3.500, lane: 2, isHold: true,  judged: false, holding: false, holdProgress: 0 },
    { time: 4.111,  endTime: 4.111, lane: 3, isHold: false, judged: false, holding: false, holdProgress: 0 },
  ],
  bpm: 137.5,
  bpmConfidence: 0.82,
  bpmStable: true,
  beatTimes: [0.5, 0.94, 1.38, 1.82, 2.26],
};

const json = exportMap(source, {
  fileName: 'test.mp3',
  fileHash: 'abc123',
  durationSec: 180,
  mode: 'drums',
  difficulty: 'hard',
  sens: 1.4,
  hpssMode: 'soft',
  holdMode: 2,
});

console.log('Exported JSON size: ' + json.length + ' bytes');

const round = importMap(json);
console.log('Round-tripped notes: ' + round.notes.length);
console.log('First note:', round.notes[0]);

const pass = round.notes.length === source.notes.length &&
             Math.abs(round.bpm - source.bpm) < 0.01 &&
             round.notes[1].isHold === true &&
             round.notes[1].lane === 2 &&
             Math.abs(round.notes[1].endTime - 3.5) < 0.001 &&
             round._importMeta.difficulty === 'hard' &&
             round._importMeta.hpssMode === 'soft';

console.log('\nRound-trip preserved: ' + (pass ? 'PASS' : 'FAIL'));
if (!pass) process.exit(1);

// Verify format guard
try {
  importMap('{"format": "something-else"}');
  console.log('Wrong-format guard: FAIL (should have thrown)');
  process.exit(1);
} catch (e) {
  console.log('Wrong-format guard: PASS (' + e.message + ')');
}

console.log('\nAll mapIO tests passed');
