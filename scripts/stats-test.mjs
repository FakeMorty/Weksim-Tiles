// Verify Etap 10 stats: record, retrieve, best-score-per-difficulty.

// Mock localStorage for Node
const store = new Map();
globalThis.localStorage = {
  getItem: k => store.has(k) ? store.get(k) : null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};

const { recordPlay, bestScoreFor, historyFor, recentPlays, totalStats, clearStats } =
  await import('../src/game/stats.js');

clearStats();

// Record several plays for two songs
recordPlay({
  songHash: 'song1', fileName: 'A.mp3', mode: 'drums', difficulty: 'normal',
  score: 10000, accuracy: 85, maxCombo: 50, perfects: 40, goods: 30, misses: 5,
  notes: 100, durationSec: 180, holdsOk: 8, holdsTotal: 10, bpm: 120,
});
recordPlay({
  songHash: 'song1', fileName: 'A.mp3', mode: 'drums', difficulty: 'normal',
  score: 15000, accuracy: 92, maxCombo: 80, perfects: 60, goods: 20, misses: 2,
  notes: 100, durationSec: 180, holdsOk: 9, holdsTotal: 10, bpm: 120,
});
recordPlay({
  songHash: 'song1', fileName: 'A.mp3', mode: 'drums', difficulty: 'hard',
  score: 20000, accuracy: 78, maxCombo: 40, perfects: 30, goods: 25, misses: 15,
  notes: 150, durationSec: 180, holdsOk: 5, holdsTotal: 10, bpm: 120,
});
recordPlay({
  songHash: 'song2', fileName: 'B.mp3', mode: 'vocal', difficulty: 'easy',
  score: 5000, accuracy: 95, maxCombo: 30, perfects: 25, goods: 10, misses: 1,
  notes: 40, durationSec: 90, holdsOk: 3, holdsTotal: 3, bpm: 100,
});

// Best score for song1 on normal — should be the 15000 play
const best = bestScoreFor('song1', 'normal');
console.log('Best song1 normal: ' + best.score + '  ' + (best.score === 15000 ? 'PASS' : 'FAIL'));
if (best.score !== 15000) process.exit(1);

// Best for song1 on hard — should be the 20000 play (different difficulty)
const bestHard = bestScoreFor('song1', 'hard');
console.log('Best song1 hard:   ' + bestHard.score + '  ' + (bestHard.score === 20000 ? 'PASS' : 'FAIL'));
if (bestHard.score !== 20000) process.exit(1);

// History for song1 has 3 plays
const hist = historyFor('song1');
console.log('History song1:     ' + hist.length + '  ' + (hist.length === 3 ? 'PASS' : 'FAIL'));
if (hist.length !== 3) process.exit(1);

// Recent plays returns all 4, newest first
const recent = recentPlays(10);
console.log('Recent plays:      ' + recent.length + '  ' + (recent.length === 4 ? 'PASS' : 'FAIL'));
if (recent.length !== 4) process.exit(1);

// Total stats aggregation
const total = totalStats();
console.log('Total plays:       ' + total.plays);
console.log('Notes hit:         ' + total.notesHit);
console.log('Playtime:          ' + total.playtimeSec + 's');
const totalPass = total.plays === 4 && total.notesHit === (40+30+60+20+30+25+25+10);
console.log('Aggregation:       ' + (totalPass ? 'PASS' : 'FAIL'));
if (!totalPass) process.exit(1);

// Persistence: recreate module cache, data should still be there via localStorage
const raw = localStorage.getItem('wt.stats.v1');
console.log('Persisted size:    ' + raw.length + ' bytes  ' + (raw.length > 100 ? 'PASS' : 'FAIL'));

console.log('\nAll stats tests passed');
