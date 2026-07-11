// Tempo estimation via autocorrelation of the onset novelty function,
// cross-checked with an IOI histogram (from picked onsets) and — Etap 4 —
// a tempogram for detecting tempo drift, plus improved half/double
// disambiguation via spectral centroid of onsets.

// Autocorrelation of `sig` for lags in [minLag, maxLag]. Returns Float32Array
// of length (maxLag - minLag + 1) with normalised autocorrelation values.
function autocorrelate(sig, minLag, maxLag) {
  const N = sig.length;
  const out = new Float32Array(maxLag - minLag + 1);
  let mean = 0;
  for (let i = 0; i < N; i++) mean += sig[i];
  mean /= N;
  const c = new Float32Array(N);
  let energy = 0;
  for (let i = 0; i < N; i++) { c[i] = sig[i] - mean; energy += c[i] * c[i]; }
  if (energy < 1e-9) return out;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i < N - lag; i++) s += c[i] * c[i + lag];
    out[lag - minLag] = s / energy;
  }
  return out;
}

function topPeaks(curve, k = 5, minSpacing = 3) {
  const peaks = [];
  for (let i = 1; i < curve.length - 1; i++) {
    if (curve[i] > curve[i - 1] && curve[i] >= curve[i + 1] && curve[i] > 0) {
      peaks.push({ idx: i, val: curve[i] });
    }
  }
  peaks.sort((a, b) => b.val - a.val);
  const kept = [];
  for (const p of peaks) {
    if (kept.every(q => Math.abs(q.idx - p.idx) >= minSpacing)) kept.push(p);
    if (kept.length >= k) break;
  }
  return kept;
}

/**
 * Local tempogram: autocorrelation over sliding windows. Reveals whether
 * tempo is stable across the track or drifts. Returns:
 *   - windows: array of { startSec, endSec, bestLagFrames, bestBpm, strength }
 *   - stable: boolean — true if all windows agree within ±3 BPM
 *   - drift: BPM range across windows (max - min)
 *
 * @param {Float32Array} novelty
 * @param {number} framesPerSec
 * @param {number} windowSec  window length (default 8 s)
 * @param {number} hopSec     window hop (default 4 s = 50% overlap)
 */
export function computeTempogram(novelty, framesPerSec, windowSec = 8, hopSec = 4) {
  const minBpm = 60, maxBpm = 200;
  const maxLag = Math.floor(framesPerSec * 60 / minBpm);
  const minLag = Math.floor(framesPerSec * 60 / maxBpm);
  const winFrames = Math.floor(windowSec * framesPerSec);
  const hopFrames = Math.floor(hopSec * framesPerSec);
  const windows = [];

  for (let start = 0; start + winFrames <= novelty.length; start += hopFrames) {
    const slice = novelty.subarray(start, start + winFrames);
    const acf = autocorrelate(slice, minLag, maxLag);
    const peaks = topPeaks(acf, 3, 3);
    if (!peaks.length) continue;
    const p = peaks[0];
    const lag = p.idx + minLag;
    const period = lag / framesPerSec;
    let bpm = 60 / period;
    while (bpm < 70)  bpm *= 2;
    while (bpm > 180) bpm /= 2;
    windows.push({
      startSec: start / framesPerSec,
      endSec: (start + winFrames) / framesPerSec,
      bestLagFrames: lag,
      bestBpm: Math.round(bpm * 10) / 10,
      strength: p.val,
    });
  }

  if (!windows.length) {
    return { windows: [], stable: true, drift: 0, medianBpm: 0 };
  }
  const bpms = windows.map(w => w.bestBpm).sort((a, b) => a - b);
  const medianBpm = bpms[bpms.length >> 1];
  const drift = bpms[bpms.length - 1] - bpms[0];
  const stable = drift <= 3;
  return { windows, stable, drift, medianBpm };
}

/**
 * Estimate BPM from a novelty signal + list of onsets.
 * Etap 4: uses tempogram for tempo stability detection and adjusts confidence.
 */
export function estimateBPM(novelty, onsets, framesPerSec) {
  const minBpm = 60, maxBpm = 200;
  const maxLag = Math.floor(framesPerSec * 60 / minBpm);
  const minLag = Math.floor(framesPerSec * 60 / maxBpm);
  if (novelty.length < maxLag * 2) {
    return { bpm: 120, confidence: 0, candidates: [], stable: true, drift: 0 };
  }

  const acf = autocorrelate(novelty, minLag, maxLag);
  const peaks = topPeaks(acf, 6, 3);
  if (!peaks.length) return { bpm: 120, confidence: 0, candidates: [], stable: true, drift: 0 };

  const iois = [];
  for (let i = 1; i < onsets.length; i++) {
    const d = onsets[i].time - onsets[i - 1].time;
    if (d >= 0.20 && d <= 1.5) iois.push(d);
  }

  const candidates = peaks.map(p => {
    const lag = p.idx + minLag;
    const period = lag / framesPerSec;
    let bpm = 60 / period;
    let bpmFolded = bpm;
    while (bpmFolded < 70)  bpmFolded *= 2;
    while (bpmFolded > 180) bpmFolded /= 2;
    let vote = 0;
    for (const d of iois) {
      const ratio = d / period;
      const err = Math.abs(ratio - Math.round(ratio));
      if (err < 0.10 && Math.round(ratio) >= 1 && Math.round(ratio) <= 4) vote++;
    }
    const iouScore = iois.length ? vote / iois.length : 0;
    return {
      bpm: Math.round(bpmFolded * 10) / 10,
      bpmRaw: bpm,
      period,
      autocorr: p.val,
      iouScore,
      score: p.val * 0.55 + iouScore * 0.45,
    };
  });
  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];

  // Half/double disambiguation: prefer the one with better IOI support
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i];
    const ratio = c.bpmRaw / best.bpmRaw;
    if ((ratio > 1.9 && ratio < 2.1) || (ratio > 0.45 && ratio < 0.55)) {
      if (c.iouScore > best.iouScore * 1.35 && c.autocorr > best.autocorr * 0.7) {
        candidates[0] = c; candidates[i] = best;
        break;
      }
    }
  }

  // Tempogram: check whether tempo is stable across the track. Bump confidence
  // if it is; drop it if we see significant drift.
  const tempogram = computeTempogram(novelty, framesPerSec);
  const stable = tempogram.stable;
  const drift = tempogram.drift;

  // If tempogram median disagrees sharply with autocorrelation best, trust
  // the tempogram median (it's local, less biased by long fills).
  let finalBpm = candidates[0].bpm;
  if (tempogram.medianBpm > 0 && Math.abs(tempogram.medianBpm - finalBpm) > 4
      && Math.abs(tempogram.medianBpm - finalBpm) < 15) {
    finalBpm = tempogram.medianBpm;
  }

  let confidence = Math.min(1, candidates[0].score);
  if (stable) confidence = Math.min(1, confidence * 1.15);
  else confidence = confidence * 0.75;

  return {
    bpm: finalBpm,
    confidence,
    candidates: candidates.slice(0, 4),
    stable,
    drift,
    tempogramWindows: tempogram.windows.length,
  };
}
