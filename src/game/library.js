// Track library — in-memory list + IndexedDB persistence across reloads.

import {
  putLibraryTrack, deleteLibraryTrack, listLibraryTracks, clearLibraryStore, sha1,
} from '../audio/cache.js';

let nextId = 1;
const tracks = [];
const listeners = new Set();

/**
 * Add a decoded track to the library.
 * @returns {number} id
 */
export function addTrack(entry, opts = {}) {
  const persist = opts.persist !== false && !entry.isDemo;
  const id = entry.id != null ? entry.id : nextId++;
  if (id >= nextId) nextId = id + 1;
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
    bpm: entry.bpm || 0,
    difficulty: entry.difficulty || 0,
    analysis: null,
    addedAt: entry.addedAt || Date.now(),
    isDemo: !!entry.isDemo,
  };
  tracks.push(track);
  emit();
  if (persist) putLibraryTrack(track);
  return id;
}

export function removeTrack(id) {
  const idx = tracks.findIndex(t => t.id === id);
  if (idx < 0) return;
  const was = tracks[idx];
  tracks.splice(idx, 1);
  emit();
  if (!was.isDemo) deleteLibraryTrack(id);
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
  if (!t.isDemo) putLibraryTrack(t);
}

export function clearAllTracks() {
  const ids = tracks.map(t => t.id);
  tracks.length = 0;
  emit();
  for (const id of ids) deleteLibraryTrack(id);
  clearLibraryStore();
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
 * Reload persisted tracks from IndexedDB and decode them.
 * @param {AudioContext} audioCtx
 */
export async function restoreLibrary(audioCtx) {
  if (!audioCtx) return [];
  let rows = [];
  try {
    rows = await listLibraryTracks();
  } catch {
    return [];
  }
  rows.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
  const restored = [];
  for (const row of rows) {
    if (!row.fileBytes) continue;
    try {
      const bytes = row.fileBytes instanceof Uint8Array
        ? row.fileBytes
        : new Uint8Array(row.fileBytes);
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const audioBuffer = await audioCtx.decodeAudioData(ab.slice(0));
      let fileHash = row.fileHash || '';
      if (!fileHash) {
        try { fileHash = await sha1(bytes); } catch { /* ignore */ }
      }
      const id = addTrack({
        id: row.id,
        name: row.name,
        size: row.size || bytes.byteLength,
        duration: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate,
        audioBuffer,
        fileBytes: bytes,
        fileHash,
        bpm: row.bpm || 0,
        difficulty: row.difficulty || 0,
        genre: row.genre || '',
        addedAt: row.addedAt,
      }, { persist: false });
      restored.push(getTrack(id));
    } catch (e) {
      console.warn('failed to restore track', row.name, e);
    }
  }
  return restored;
}

/**
 * Difficulty stars (0..5) from BPM + note density.
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

export function guessGenreFromBpm(bpm) {
  if (bpm < 70) return 'Ballad';
  if (bpm < 90) return 'Downtempo';
  if (bpm < 110) return 'Pop / Hip-hop';
  if (bpm < 130) return 'Rock / House';
  if (bpm < 150) return 'Dance';
  if (bpm < 170) return 'Techno / D&B';
  return 'Speed / Metal';
}
