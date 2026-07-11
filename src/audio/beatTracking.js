// Beat tracking via dynamic programming (Ellis 2007, "Beat Tracking by Dynamic
// Programming"). Given an onset novelty function and a target BPM, finds the
// optimal sequence of beat times that maximises:
//
//   score(beats) = Σ onset_strength(b_i) - λ · Σ log²(interval / target_period)
//
// The tightness penalty λ controls how strictly beats stick to the target
// tempo (higher = more strict). We use λ=100 which is close to Ellis's suggestion.
//
// Output: an array of beat times in seconds. Useful for:
//   - snap-to-grid on generated notes (higher quality than fixed-BPM snap
//     because it accounts for the trackfs actual downbeat offset)
//   - drawing bar/beat indicators in an editor
//   - Etap 6 mapgen (place chord notes on downbeats)

const TIGHTNESS = 100;      // λ in Ellis's paper — how hard beats stick to target period
const SEARCH_RANGE = 0.32;  // ±32% of target period is the maximum spacing tolerated

/**
 * @param {Float32Array} novelty  onset detection function per frame
 * @param {number} framesPerSec   novelty frame rate (sr / hop)
 * @param {number} targetBpm      preferred tempo (from BPM estimator)
 * @returns {{beats: number[], score: number}}
 */
export function trackBeats(novelty, framesPerSec, targetBpm) {
  if (!novelty.length || !targetBpm || targetBpm < 40) return { beats: [], score: 0 };

  const period = 60 / targetBpm;               // seconds between beats
  const periodFrames = period * framesPerSec;
  const minStep = Math.max(1, Math.floor(periodFrames * (1 - SEARCH_RANGE)));
  const maxStep = Math.ceil(periodFrames * (1 + SEARCH_RANGE));

  const N = novelty.length;
  const cumScore = new Float32Array(N);
  const back = new Int32Array(N);
  back.fill(-1);

  // Normalise novelty a bit so absolute strength doesn't drown out the
  // tempo-consistency penalty.
  const noveltyMax = Math.max(...novelty) || 1;
  const nn = new Float32Array(N);
  for (let i = 0; i < N; i++) nn[i] = novelty[i] / noveltyMax;

  // Base case: first `maxStep` frames — beat could start anywhere here.
  for (let i = 0; i < Math.min(maxStep, N); i++) {
    cumScore[i] = nn[i];
    back[i] = -1;
  }

  // DP: for each frame, look back over [maxStep..minStep] candidates
  for (let i = maxStep; i < N; i++) {
    let bestScore = -Infinity;
    let bestPrev = -1;
    for (let step = minStep; step <= maxStep; step++) {
      const j = i - step;
      if (j < 0) break;
      // Tightness penalty: how far this step is from the target period
      const penalty = TIGHTNESS * Math.pow(Math.log(step / periodFrames), 2);
      const s = cumScore[j] - penalty;
      if (s > bestScore) {
        bestScore = s;
        bestPrev = j;
      }
    }
    cumScore[i] = nn[i] + bestScore;
    back[i] = bestPrev;
  }

  // Backtrace from the best ending position
  let endIdx = 0;
  let endScore = -Infinity;
  for (let i = 0; i < N; i++) {
    if (cumScore[i] > endScore) {
      endScore = cumScore[i];
      endIdx = i;
    }
  }
  const beatFrames = [];
  let cur = endIdx;
  while (cur >= 0) {
    beatFrames.push(cur);
    cur = back[cur];
  }
  beatFrames.reverse();

  const beats = beatFrames.map(f => f / framesPerSec);
  return { beats, score: endScore };
}

/**
 * Snap onset times to the NEAREST tracked beat (with subdivision).
 * More accurate than fixed BPM snap because beat times already account for
 * the track's actual downbeat offset and any minor tempo drift.
 *
 * @param {number[]} times  onset times
 * @param {number[]} beats  beat times from trackBeats()
 * @param {number} subdivision  4 = quarters, 8 = eighths, 16 = sixteenths
 * @param {number} maxSnapMs
 * @returns {number[]}
 */
export function snapToTrackedBeats(times, beats, subdivision, maxSnapMs = 60) {
  if (!beats.length || !times.length) return times;
  const maxSnapSec = maxSnapMs / 1000;
  const div = subdivision / 4; // 1, 2, or 4 sub-beats per beat

  // Build subdivision grid from beat times
  const grid = [];
  for (let i = 0; i < beats.length - 1; i++) {
    const t0 = beats[i], t1 = beats[i + 1];
    for (let s = 0; s < div; s++) {
      grid.push(t0 + (t1 - t0) * s / div);
    }
  }
  grid.push(beats[beats.length - 1]);

  // For each onset, binary-search nearest grid point
  return times.map(t => {
    let lo = 0, hi = grid.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (grid[mid] < t) lo = mid; else hi = mid;
    }
    const g = Math.abs(grid[lo] - t) < Math.abs(grid[hi] - t) ? grid[lo] : grid[hi];
    return Math.abs(g - t) <= maxSnapSec ? g : t;
  });
}
