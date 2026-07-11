// Shared mutable game state. Single source of truth for all modules.
// Kept intentionally simple (no reactivity) — we're in a tight render loop.

import { LANES } from '../config.js';

export const state = {
  // Audio
  audioCtx: null,
  audioBuffer: null,
  sourceNode: null,
  gainNode: null,
  fileName: '',
  fileBytes: null,     // Uint8Array — for cache hashing (Etap 10)
  fileHash: '',        // SHA-1 hex, cached from fileBytes (Etap 10)

  // Analysis result
  notes: [],
  currentBpm: 0,
  currentBpmConf: 0,
  bpmStable: true,
  bpmDrift: 0,
  beatTimes: [],

  // Scoring
  score: 0,
  combo: 0,
  maxCombo: 0,
  perfects: 0,
  goods: 0,
  misses: 0,
  hits: 0,
  holdsOk: 0,
  holdsTotal: 0,

  // Runtime
  gameRunning: false,
  paused: false,
  pauseStart: 0,       // audioCtx.currentTime when paused
  pauseOffset: 0,      // cumulative pause seconds — subtracted from songTime
  startTime: 0,
  fallTime: 1.45,
  mode: 'drums',
  currentDifficulty: 'normal',   // captured at play start (Etap 10)
  currentSens: 1.25,              // captured for export (Etap 10)
  lastAnalysis: null,             // full analyzer result — for map export
  pendingImportedMap: null,       // set by import UI, consumed on next play

  // Per-lane transient
  bullets: [],
  particles: [],
  beams:        new Array(LANES).fill(0),
  flashes:      new Array(LANES).fill(0),
  keysDown:     new Array(LANES).fill(false),
  activeHold:   new Array(LANES).fill(null),
  lastShotTime: new Array(LANES).fill(0),
};

export function resetPlayState() {
  state.score = 0;
  state.combo = 0;
  state.maxCombo = 0;
  state.perfects = 0;
  state.goods = 0;
  state.misses = 0;
  state.hits = 0;
  state.holdsOk = 0;
  state.bullets.length = 0;
  state.particles.length = 0;
  state._notesCursor = 0;
  for (let i = 0; i < LANES; i++) {
    state.keysDown[i] = false;
    state.activeHold[i] = null;
    state.beams[i] = 0;
    state.flashes[i] = 0;
    state.lastShotTime[i] = 0;
  }
}
