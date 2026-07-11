// Etap E (v1.24): In-session track library.
//
// Holds a list of loaded audio files in memory (no persistence). Each entry:
//   { id, name, size, duration, bpm, difficulty, audioBuffer, fileBytes,
//     analysis?, genre? }
//
// Analysis result is cached per track when it's played, so replaying the
// same track from the library skips the 5-8 s analysis.

let nextId = 1;
const tracks = [];
const listeners = new Set();

/**
 * Add a decoded track to the library.
 * @returns {number} id
 */
export function addTrack(entry) {
  const id = nextId++;
  const track = {
    id,
    name: entry.name || 'Untitled',
    size: entry.size || 0,
    duration: entry.duration || 0,
    sampleRate: entry.sampleRate || 44100,
    audioBuffer: entry.audioBuffer,
    fileBytes: entry.fileBytes,
    fileHash: entry.fileHash || '',
    genre: entry.genre || '',
    bpm: 0,
    difficulty: 0,   // 0..5 stars, filled after analysis
    analysis: null,
    addedAt: Date.now(),
  };
  tracks.push(track);
  emit();
  return id;
}

export function removeTrack(id) {
  const idx = tracks.findIndex(t => t.id === id);
  if (idx < 0) return;
  tracks.splice(idx, 1);
  emit();
}

export function getTrack(id) {
  return tracks.find(t => t.id === id) || null;
}

export function listTracks() {
  return tracks.slice();
}

export function updateTrack(id, patch) {
  const t = getTrack(id);
  if (!t) return;
  Object.assign(t, patch);
  emit();
}

export function onLibraryChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit() {
  for (const cb of listeners) {
    try { cb(); } catch (e) { console.error(e); }
  }
}

/**
 * Difficulty stars (0..5) from BPM + note density. Approx heuristic:
 *   <90 BPM or <2 nps           → 1 star
 *   90-110 BPM, 2-3 nps         → 2 stars
 *   110-130 BPM, 3-4 nps        → 3 stars
 *   130-160 BPM, 4-6 nps        → 4 stars
 *   >160 BPM or >6 nps          → 5 stars
 */
export function difficultyStars(bpm, notesPerSec) {
  const bpmScore =
    bpm < 90 ? 1 :
    bpm < 110 ? 2 :
    bpm < 130 ? 3 :
    bpm < 160 ? 4 : 5;
  const npsScore =
    notesPerSec < 2 ? 1 :
    notesPerSec < 3 ? 2 :
    notesPerSec < 4 ? 3 :
    notesPerSec < 6 ? 4 : 5;
  return Math.round((bpmScore + npsScore) / 2);
}

/**
 * Best-guess genre tag from BPM (very approximate — user can override).
 * We use it only for display, not for anything analytical.
 */
export function guessGenreFromBpm(bpm) {
  if (bpm < 70) return 'Ballad';
  if (bpm < 90) return 'Downtempo';
  if (bpm < 110) return 'Pop / Hip-hop';
  if (bpm < 130) return 'Rock / House';
  if (bpm < 150) return 'Dance';
  if (bpm < 170) return 'Techno / D&B';
  return 'Speed / Metal';
}
