// Etap 10: Analysis cache via IndexedDB.
//
// Key = SHA-1 of the raw file bytes + mode + hpssMode + difficulty.
// Value = the full analyzer result (notes, bpm, beats, holds count, ...).
//
// Typical cache entry ~50-200 KB depending on song length. IDB quota on
// Chrome is at least 60% of free disk, so 10k+ songs fit easily.
//
// Rationale: on the same track, HPSS+STFT+onset picking take 5-8 seconds.
// A cache hit takes ~10 ms. Big UX win when you replay the same song at
// a different difficulty or after tweaking calibration.

const DB_NAME = 'weksim-tiles';
const DB_VERSION = 2;
const STORE = 'analysis';
const LIB_STORE = 'library';

let dbPromise = null;

function idbAvailable() {
  return typeof indexedDB !== 'undefined';
}

function openDb() {
  if (dbPromise) return dbPromise;
  if (!idbAvailable()) return Promise.reject(new Error('no indexedDB'));
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'key' });
        s.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(LIB_STORE)) {
        db.createObjectStore(LIB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// Compute SHA-1 hex of a Uint8Array (raw file bytes). Uses WebCrypto —
// available in every browser we target.
export async function sha1(bytes) {
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  const arr = new Uint8Array(digest);
  let s = '';
  for (let i = 0; i < arr.length; i++) s += arr[i].toString(16).padStart(2, '0');
  return s;
}

// Bump this whenever onset / source / HPSS behaviour changes so IndexedDB
// does not serve maps built by a previous algorithm.
export const ANALYZER_ALGO = 'sf1';

// Build a cache key that reflects EVERY analyzer input that changes output.
// Sensitivity and hold-mode change note count, so they're in the key too.
export function buildKey(fileHash, opts) {
  return [
    ANALYZER_ALGO,
    fileHash,
    opts.mode,
    opts.difficulty,
    opts.hpssMode,
    opts.nmfMode || 'auto',
    'sens' + Math.round(opts.sens * 100),
    'hold' + opts.holdMode,
    opts.holdEnable ? 'h1' : 'h0',
    opts.dual ? 'd1' : 'd0',
    opts.smartLane ? 'sl1' : 'sl0',
  ].join('|');
}

/**
 * Look up a cached analysis. Returns the stored object or null.
 */
export async function getCached(key) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result?.value ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('cache get failed:', e);
    return null;
  }
}

/**
 * Store an analysis result. `value` should be JSON-serialisable — no
 * TypedArrays with SharedArrayBuffer. Small TypedArrays (Float32Array etc.)
 * DO survive structured clone into IDB.
 */
export async function putCached(key, value, meta = {}) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const record = {
        key,
        value,
        createdAt: Date.now(),
        fileName: meta.fileName || '',
        durationSec: meta.durationSec || 0,
      };
      const req = tx.objectStore(STORE).put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('cache put failed:', e);
  }
}

/**
 * List all cache entries (metadata only, not the full analysis payload).
 * Useful for a future "recent tracks" UI.
 */
export async function listCached() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const rows = req.result || [];
        resolve(rows.map(r => ({
          key: r.key,
          createdAt: r.createdAt,
          fileName: r.fileName,
          durationSec: r.durationSec,
        })));
      };
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('cache list failed:', e);
    return [];
  }
}

/**
 * Purge all cache entries. Called from settings UI if user wants a reset.
 */
export async function clearCache() {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    return true;
  } catch (e) {
    console.warn('cache clear failed:', e);
    return false;
  }
}

const MAX_PERSISTED_TRACKS = 12;
const MAX_PERSIST_BYTES = 40 * 1024 * 1024;

export async function putLibraryTrack(track) {
  if (!idbAvailable()) return;
  if (!track || track.isDemo) return;
  if (!track.fileBytes || track.fileBytes.byteLength > MAX_PERSIST_BYTES) return;
  try {
    const db = await openDb();
    const record = {
      id: track.id,
      name: track.name,
      size: track.size,
      duration: track.duration,
      sampleRate: track.sampleRate,
      fileHash: track.fileHash || '',
      fileBytes: track.fileBytes,
      bpm: track.bpm || 0,
      difficulty: track.difficulty || 0,
      genre: track.genre || '',
      addedAt: track.addedAt || Date.now(),
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction(LIB_STORE, 'readwrite');
      const store = tx.objectStore(LIB_STORE);
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    await trimLibraryStore();
  } catch (e) {
    console.warn('library persist failed:', e);
  }
}

export async function deleteLibraryTrack(id) {
  if (!idbAvailable()) return;
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(LIB_STORE, 'readwrite');
      const req = tx.objectStore(LIB_STORE).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('library delete failed:', e);
  }
}

export async function listLibraryTracks() {
  if (!idbAvailable()) return [];
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(LIB_STORE, 'readonly');
      const req = tx.objectStore(LIB_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('library list failed:', e);
    return [];
  }
}

export async function clearLibraryStore() {
  if (!idbAvailable()) return;
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(LIB_STORE, 'readwrite');
      const req = tx.objectStore(LIB_STORE).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('library clear failed:', e);
  }
}

async function trimLibraryStore() {
  try {
    const rows = await listLibraryTracks();
    if (rows.length <= MAX_PERSISTED_TRACKS) return;
    rows.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
    const drop = rows.length - MAX_PERSISTED_TRACKS;
    for (let i = 0; i < drop; i++) await deleteLibraryTrack(rows[i].id);
  } catch { /* ignore */ }
}
