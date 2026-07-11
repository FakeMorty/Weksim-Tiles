// Post-processing filter: cap note density so gameplay stays humanly playable.
// Runs AFTER the analyzer picks raw onsets, BEFORE lane assignment.
//
// Strategy: sliding 1-second window. If more than `maxPerSec` notes fall in
// any window, drop the weakest ones (by onset strength) until it fits.
// HOLD notes are protected — they're structurally important, we drop taps first.

/**
 * @param {Array<{time:number, strength?:number, isHold?:boolean}>} events
 * @param {number} maxPerSec  target maximum notes per second
 * @returns {Array} filtered events (same shape, subset)
 */
export function limitDensity(events, maxPerSec) {
  if (!events.length || maxPerSec >= 20) return events;
  const sorted = [...events].sort((a, b) => a.time - b.time);
  for (const e of sorted) if (e.strength == null) e.strength = 1;

  const windowSec = 1.0;
  const maxInWindow = Math.max(1, Math.floor(maxPerSec * windowSec));

  // Iterative pass: find any window that's too dense, drop its weakest
  // non-hold note, repeat until stable. Bounded by initial event count.
  const keep = new Array(sorted.length).fill(true);
  let safety = sorted.length;
  while (safety-- > 0) {
    let worstWinStart = -1, worstWinEnd = -1, worstOverflow = 0;
    // Two-pointer scan of surviving events
    const alive = [];
    for (let i = 0; i < sorted.length; i++) if (keep[i]) alive.push(i);
    if (alive.length <= maxInWindow) break;
    let l = 0;
    for (let r = 0; r < alive.length; r++) {
      while (sorted[alive[r]].time - sorted[alive[l]].time > windowSec) l++;
      const winSize = r - l + 1;
      const overflow = winSize - maxInWindow;
      if (overflow > worstOverflow) {
        worstOverflow = overflow;
        worstWinStart = l;
        worstWinEnd = r;
      }
    }
    if (worstOverflow <= 0) break;
    // Drop the weakest tap in that window
    let bestDropIdx = -1;
    let bestScore = Infinity; // lower = drop first
    for (let k = worstWinStart; k <= worstWinEnd; k++) {
      const idx = alive[k];
      const e = sorted[idx];
      // Prefer dropping non-holds with low strength
      const score = e.strength + (e.isHold ? 1000 : 0);
      if (score < bestScore) {
        bestScore = score;
        bestDropIdx = idx;
      }
    }
    if (bestDropIdx < 0) break;
    keep[bestDropIdx] = false;
  }

  return sorted.filter((_, i) => keep[i]);
}

// Per-difficulty caps + beat-snap settings.
// `snapSubdivision` = 0 → no snap, 4 → snap to quarters, 8 → to eighths,
// 16 → to sixteenths. Easier difficulties snap aggressively so the map
// feels "on the beat" even on wall-of-sound tracks.
export const DIFFICULTY_PRESETS = {
  easy:   { maxNps: 2.5, sensBias: -0.4, chordProb: 0.02, snapSubdivision:  4, label: 'EASY'   },
  normal: { maxNps: 4.0, sensBias:  0.0, chordProb: 0.06, snapSubdivision:  8, label: 'NORMAL' },
  hard:   { maxNps: 6.5, sensBias:  0.2, chordProb: 0.11, snapSubdivision: 16, label: 'HARD'   },
  expert: { maxNps: 10,  sensBias:  0.5, chordProb: 0.16, snapSubdivision:  0, label: 'EXPERT' },
};
