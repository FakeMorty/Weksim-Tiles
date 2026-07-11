// Etap 10: Per-song play history + best scores.
//
// Stored in localStorage as a single JSON blob (small — ~100 bytes per play).
// Keyed by songHash (SHA-1 of file bytes) so the same track always aggregates
// regardless of file name.

const LS_KEY = 'wt.stats.v1';
const MAX_HISTORY = 200;   // total plays to keep across all songs

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(LS_KEY);
    cache = raw ? JSON.parse(raw) : { plays: [] };
  } catch {
    cache = { plays: [] };
  }
  if (!Array.isArray(cache.plays)) cache.plays = [];
  return cache;
}

function persist() {
  if (!cache) return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cache));
  } catch { /* quota exceeded — silently drop */ }
}

/**
 * Record a finished play. Auto-trims to MAX_HISTORY most recent.
 */
export function recordPlay(entry) {
  const data = load();
  data.plays.push({
    songHash: entry.songHash || '',
    fileName: entry.fileName || '',
    mode:     entry.mode || 'classic',
    difficulty: entry.difficulty || 'normal',
    bpm:      entry.bpm || 0,
    score:    entry.score || 0,
    accuracy: entry.accuracy || 0,
    maxCombo: entry.maxCombo || 0,
    perfects: entry.perfects || 0,
    goods:    entry.goods || 0,
    misses:   entry.misses || 0,
    holdsOk:  entry.holdsOk || 0,
    holdsTotal: entry.holdsTotal || 0,
    notes:    entry.notes || 0,
    durationSec: entry.durationSec || 0,
    date:     Date.now(),
    fpsAvg:   entry.fpsAvg || 0,
  });
  // Trim oldest if we exceed cap
  if (data.plays.length > MAX_HISTORY) {
    data.plays.splice(0, data.plays.length - MAX_HISTORY);
  }
  persist();
}

/**
 * Best score for a given song+difficulty combo (across all modes).
 * Returns null if no previous play exists.
 */
export function bestScoreFor(songHash, difficulty) {
  const data = load();
  let best = null;
  for (const p of data.plays) {
    if (p.songHash !== songHash) continue;
    if (p.difficulty !== difficulty) continue;
    if (!best || p.score > best.score) best = p;
  }
  return best;
}

/**
 * All plays for a specific song (any difficulty).
 */
export function historyFor(songHash) {
  const data = load();
  return data.plays.filter(p => p.songHash === songHash)
                   .sort((a, b) => b.date - a.date);
}

/**
 * Global recent history (all songs).
 */
export function recentPlays(limit = 20) {
  const data = load();
  return data.plays.slice().sort((a, b) => b.date - a.date).slice(0, limit);
}

/**
 * Aggregate stats across all plays — for a future stats screen.
 */
export function totalStats() {
  const data = load();
  const t = { plays: data.plays.length, notesHit: 0, notesTotal: 0, playtimeSec: 0 };
  for (const p of data.plays) {
    t.notesHit += (p.perfects + p.goods);
    t.notesTotal += p.notes;
    t.playtimeSec += p.durationSec;
  }
  return t;
}

export function clearStats() {
  cache = { plays: [] };
  try { localStorage.removeItem(LS_KEY); } catch {}
}
