// Adaptive-threshold peak picker for onset novelty functions.
// Uses local median (via a simple sort-window approx) + margin, following
// the general shape of Böck & Widmer 2013 peak-picking.
//
// Returns onset times in SECONDS.

// Rolling-window median. Naive O(W log W) per position but plenty fast for
// N ≈ 10⁴ frames. If it ever bites, swap for a two-heap or skiplist median.
function rollingMedian(sig, halfWin) {
  const N = sig.length;
  const out = new Float32Array(N);
  const buf = [];
  for (let i = 0; i < N; i++) {
    const lo = Math.max(0, i - halfWin);
    const hi = Math.min(N - 1, i + halfWin);
    const len = hi - lo + 1;
    if (buf.length !== len) buf.length = len;
    for (let k = 0; k < len; k++) buf[k] = sig[lo + k];
    buf.sort((a, b) => a - b);
    out[i] = buf[len >> 1];
  }
  return out;
}

// Small helper: rolling mean (cheaper than median, used as light smoother).
function rollingMean(sig, halfWin) {
  const N = sig.length;
  const out = new Float32Array(N);
  let sum = 0;
  const win = halfWin * 2 + 1;
  // Prime the window
  for (let i = 0; i < Math.min(win, N); i++) sum += sig[i];
  for (let i = 0; i < N; i++) {
    const lo = i - halfWin, hi = i + halfWin;
    if (lo > 0) sum -= sig[lo - 1] ?? 0;
    if (hi < N) sum += sig[hi] ?? 0;
    const cnt = Math.min(hi, N - 1) - Math.max(0, lo) + 1;
    out[i] = sum / cnt;
  }
  return out;
}

/**
 * Detect onsets from a novelty signal.
 *
 * @param {Float32Array} novelty  onset detection function (any non-negative signal)
 * @param {object} opts
 *   framesPerSec  — how many novelty samples per second (sr / hop)
 *   preAvgSec     — local mean window BEFORE current frame (default 0.10 s)
 *   postAvgSec    — local mean window AFTER  current frame (default 0.10 s)
 *   preMedSec     — local median window (default 0.50 s) — used for adaptive threshold
 *   delta         — additive margin above local median (default 0.03)
 *   alpha         — multiplicative margin above local median (default 1.6)
 *   minGapSec     — minimum spacing between onsets (default 0.08 s)
 * @returns array of { frame, time, strength }
 */
export function pickPeaks(novelty, opts) {
  const framesPerSec = opts.framesPerSec;
  const preAvg  = Math.max(1, Math.round((opts.preAvgSec  ?? 0.10) * framesPerSec));
  const postAvg = Math.max(1, Math.round((opts.postAvgSec ?? 0.10) * framesPerSec));
  const preMed  = Math.max(3, Math.round((opts.preMedSec  ?? 0.50) * framesPerSec));
  const delta   = opts.delta ?? 0.03;
  const alpha   = opts.alpha ?? 1.6;
  const minGap  = Math.max(1, Math.round((opts.minGapSec  ?? 0.08) * framesPerSec));

  const N = novelty.length;
  const medianWin = Math.max(preAvg, preMed);
  const localMedian = rollingMedian(novelty, medianWin);
  const smoothed    = rollingMean(novelty, 1); // tiny 3-tap smoother

  const peaks = [];
  let lastPeakFrame = -Infinity;

  for (let i = Math.max(preAvg, 2); i < N - Math.max(postAvg, 2); i++) {
    const v = smoothed[i];
    const thr = localMedian[i] * alpha + delta;
    if (v < thr) continue;
    // Local maximum within ±3 frames
    if (v < smoothed[i - 1] || v < smoothed[i + 1]) continue;
    if (v < smoothed[i - 2] || v < smoothed[i + 2]) continue;
    // Refractory
    if (i - lastPeakFrame < minGap) {
      // If this peak is stronger than the previous, replace it
      const last = peaks[peaks.length - 1];
      if (last && v > last.strength) {
        peaks.pop();
        peaks.push({ frame: i, time: i / framesPerSec, strength: v });
        lastPeakFrame = i;
      }
      continue;
    }
    peaks.push({ frame: i, time: i / framesPerSec, strength: v });
    lastPeakFrame = i;
  }
  return peaks;
}

// If we didn't get enough onsets, relax parameters and try again.
// Helper used by the analyzer to guarantee minimum note density.
export function pickPeaksAdaptive(novelty, opts, targetPerSec = 1.5) {
  const totalSec = novelty.length / opts.framesPerSec;
  let picked = pickPeaks(novelty, opts);
  const target = totalSec * targetPerSec;
  if (picked.length >= target) return picked;
  // Relax alpha (lower threshold) and try again
  const relaxed = pickPeaks(novelty, { ...opts, alpha: Math.max(1.0, (opts.alpha ?? 1.6) * 0.65), delta: (opts.delta ?? 0.03) * 0.5 });
  return relaxed.length > picked.length ? relaxed : picked;
}
