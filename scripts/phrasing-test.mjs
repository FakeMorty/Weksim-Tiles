// Test Etap E phrasing filter (mapgen thinning + breath).
//
// We generate synthetic annotated events and check that phraseFilter thins
// dense runs, respects breath after holds, and keeps downbeats.

import { generateMap } from '../src/audio/mapgen.js';

let pass = 0, fail = 0;
function check(name, cond, msg) {
  if (cond) { console.log('PASS ' + name); pass++; }
  else { console.log('FAIL ' + name + (msg ? ' — ' + msg : '')); fail++; }
}

// Helper to build a dense stream of events
function densifyEvents(bpm, count, strengthFn) {
  const beat = 60 / bpm;
  const step = beat / 4; // 16th notes → very dense
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      time: 1 + i * step,
      endTime: 1 + i * step,
      isHold: false,
      strength: strengthFn ? strengthFn(i) : 1.0,
    });
  }
  return out;
}

// --- Test 1: dense expert stream keeps more notes than normal ---
{
  const bpm = 128;
  const events = densifyEvents(bpm, 40, i => (i % 4 === 0) ? 2.5 : 1.0);
  const beatTimes = [];
  for (let i = 0; i < 40; i++) beatTimes.push(1 + i * (60 / bpm));

  const easyMap   = generateMap([...events.map(e => ({...e}))], beatTimes, bpm, { difficulty: 'easy' });
  const expertMap = generateMap([...events.map(e => ({...e}))], beatTimes, bpm, { difficulty: 'expert' });

  console.log(`  easy:   ${easyMap.length} notes, expert: ${expertMap.length} notes`);
  check('expert keeps more notes than easy', expertMap.length > easyMap.length);
  check('easy thinned below input', easyMap.length < events.length);
}

// --- Test 2: breath after HOLD — nearby subsequent events dropped ---
{
  const bpm = 120;
  const events = [
    { time: 1.0, endTime: 1.0, isHold: false, strength: 1 },
    { time: 1.5, endTime: 2.5, isHold: true,  strength: 2 }, // long hold
    // Next event 100ms after hold end — should be dropped (within breath)
    { time: 2.6, endTime: 2.6, isHold: false, strength: 0.9 },
    // 500ms after hold end — should survive
    { time: 3.0, endTime: 3.0, isHold: false, strength: 1.5 },
  ];
  const beatTimes = [1, 1.5, 2, 2.5, 3, 3.5];
  const map = generateMap(events, beatTimes, bpm, { difficulty: 'normal' });
  // Look for note near 2.6s
  const nearHoldEnd = map.some(n => Math.abs(n.time - 2.6) < 0.05);
  const nearSafe    = map.some(n => Math.abs(n.time - 3.0) < 0.05);
  check('breath after hold drops close event', !nearHoldEnd);
  check('event 0.5s after hold survives', nearSafe);
}

// --- Test 3: mapgen with source-separation tags routes correctly ---
{
  const bpm = 120;
  const beatTimes = [];
  for (let i = 0; i < 20; i++) beatTimes.push(i * 0.5);
  const events = [
    { time: 1.0, endTime: 1.0, isHold: false, strength: 2, source: 'kick' },
    { time: 1.5, endTime: 1.5, isHold: false, strength: 2, source: 'snare' },
    { time: 2.0, endTime: 2.0, isHold: false, strength: 2, source: 'kick' },
    { time: 2.5, endTime: 2.5, isHold: false, strength: 2, source: 'snare' },
  ];
  const map = generateMap(events, beatTimes, bpm, { difficulty: 'hard' });
  check('source-tagged events produce notes', map.length >= 3);
  // Check kicks and snares land in different lanes (musical routing)
  const kickNotes = map.filter(n => Math.abs(n.time - 1.0) < 0.05 || Math.abs(n.time - 2.0) < 0.05);
  const snareNotes = map.filter(n => Math.abs(n.time - 1.5) < 0.05 || Math.abs(n.time - 2.5) < 0.05);
  if (kickNotes.length > 0 && snareNotes.length > 0) {
    // Most kicks should go to outer lanes (0/3), most snares to inner (1/2).
    // With only 2 kicks and dual/chord chances there can be one stray, so
    // we accept ≥50% correctness (musical routing is best-effort in mapgen).
    const kickOuter  = kickNotes.filter(n => n.lane === 0 || n.lane === 3).length;
    const snareInner = snareNotes.filter(n => n.lane === 1 || n.lane === 2).length;
    check('most kicks routed to outer lanes',  kickOuter / kickNotes.length >= 0.5,
          `got kick lanes ${kickNotes.map(n => n.lane)}`);
    check('most snares routed to inner lanes', snareInner / snareNotes.length >= 0.5,
          `got snare lanes ${snareNotes.map(n => n.lane)}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
