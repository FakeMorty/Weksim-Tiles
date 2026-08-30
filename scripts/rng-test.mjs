// Seeded PRNG + mapgen determinism.

import { mulberry32, seedFromString } from '../src/utils/rng.js';
import { generateMap } from '../src/audio/mapgen.js';
import { computeAccuracy } from '../src/game/accuracy.js';

let fail = 0;
function check(name, cond) {
  if (cond) console.log('PASS ' + name);
  else { console.log('FAIL ' + name); fail++; }
}

{
  const a = mulberry32(42);
  const b = mulberry32(42);
  const seqA = [a(), a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b(), b()];
  check('same seed same sequence', seqA.every((v, i) => v === seqB[i]));
  const c = mulberry32(43);
  check('different seed diverges', c() !== seqA[0]);
  check('range 0..1', seqA.every(v => v >= 0 && v < 1));
}

{
  check('seedFromString stable', seedFromString('abc') === seedFromString('abc'));
  check('seedFromString differs', seedFromString('abc') !== seedFromString('abd'));
}

{
  const events = [];
  const beatTimes = [];
  for (let i = 0; i < 32; i++) {
    const time = 1 + i * 0.25;
    events.push({ time, endTime: time, isHold: false, strength: 0.6 + (i % 4 === 0 ? 0.4 : 0) });
    if (i % 2 === 0) beatTimes.push(time);
  }
  const a = generateMap(events, beatTimes, 120, { difficulty: 'hard', chordProb: 0.2, seed: 12345 });
  const b = generateMap(events, beatTimes, 120, { difficulty: 'hard', chordProb: 0.2, seed: 12345 });
  const lanesA = a.map(n => n.lane + ':' + n.time.toFixed(3)).join('|');
  const lanesB = b.map(n => n.lane + ':' + n.time.toFixed(3)).join('|');
  check('mapgen same seed identical', lanesA === lanesB && a.length === b.length);
  const c = generateMap(events, beatTimes, 120, { difficulty: 'hard', chordProb: 0.2, seed: 99999 });
  const lanesC = c.map(n => n.lane + ':' + n.time.toFixed(3)).join('|');
  check('mapgen different seed can differ', lanesC !== lanesA || c.length !== a.length);
}

{
  check('acc all marvelous', computeAccuracy({ marvelous: 10, perfects: 0, greats: 0, goods: 0, oks: 0, misses: 0 }) === 100);
  check('acc half miss', computeAccuracy({ marvelous: 5, perfects: 0, greats: 0, goods: 0, oks: 0, misses: 5 }) === 50);
  check('acc empty', computeAccuracy({ marvelous: 0, perfects: 0, greats: 0, goods: 0, oks: 0, misses: 0 }) === 100);
  check('acc mixed', computeAccuracy({ marvelous: 0, perfects: 0, greats: 4, goods: 0, oks: 0, misses: 0 }) === 75);
}

if (fail) {
  console.log('\n' + fail + ' failed');
  process.exit(1);
}
console.log('\nAll rng/accuracy tests passed');
