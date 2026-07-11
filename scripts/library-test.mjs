// Test Etap E library + phrasing filter + hitsound modules.

import { addTrack, removeTrack, listTracks, getTrack, updateTrack, difficultyStars, guessGenreFromBpm } from '../src/game/library.js';

let pass = 0, fail = 0;
function check(name, cond, msg) {
  if (cond) { console.log('PASS ' + name); pass++; }
  else { console.log('FAIL ' + name + (msg ? ' — ' + msg : '')); fail++; }
}

// --- Library CRUD ---
{
  // start clean
  for (const t of listTracks()) removeTrack(t.id);
  const id1 = addTrack({ name: 'song1.mp3', duration: 180, audioBuffer: {}, fileBytes: new Uint8Array(0) });
  const id2 = addTrack({ name: 'song2.mp3', duration: 200, audioBuffer: {}, fileBytes: new Uint8Array(0) });
  check('two tracks added', listTracks().length === 2);
  check('ids are sequential and unique', id2 === id1 + 1);
  check('getTrack returns entry', getTrack(id1).name === 'song1.mp3');

  updateTrack(id1, { bpm: 128, difficulty: 3 });
  check('updateTrack modifies fields', getTrack(id1).bpm === 128 && getTrack(id1).difficulty === 3);

  removeTrack(id1);
  check('removeTrack works', listTracks().length === 1);
  check('getTrack returns null after removal', getTrack(id1) === null);

  // cleanup
  removeTrack(id2);
  check('library empty after cleanup', listTracks().length === 0);
}

// --- Library change listener ---
{
  let calls = 0;
  const { onLibraryChange } = await import('../src/game/library.js');
  const unsub = onLibraryChange(() => calls++);
  const id = addTrack({ name: 'x.mp3', audioBuffer: {}, fileBytes: new Uint8Array(0) });
  check('listener fires on add', calls === 1);
  updateTrack(id, { bpm: 100 });
  check('listener fires on update', calls === 2);
  removeTrack(id);
  check('listener fires on remove', calls === 3);
  unsub();
  addTrack({ name: 'y.mp3', audioBuffer: {}, fileBytes: new Uint8Array(0) });
  check('unsubscribed listener stops firing', calls === 3);
  for (const t of listTracks()) removeTrack(t.id);
}

// --- Difficulty stars ---
{
  check('slow easy → 1 star',   difficultyStars(70, 1.5) === 1);
  check('mid → 3 stars',        difficultyStars(120, 3.5) === 3);
  check('fast metal → 5 stars', difficultyStars(180, 8) === 5);
  check('stars clamped 0..5',   difficultyStars(300, 100) === 5);
}

// --- Genre guess ---
{
  check('slow → Ballad', guessGenreFromBpm(60) === 'Ballad');
  check('120 BPM → Rock/House', guessGenreFromBpm(120).includes('Rock'));
  check('160 BPM → Techno/D&B', guessGenreFromBpm(160).includes('Techno'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
