// Tempo estimation via autocorrelation of the onset novelty function,
// cross-checked with an IOI histogram (from picked onsets). Etap 4 will
// add tempogram + beat-tracking DP; for now this already beats the v1.1
// simple histogram on tricky tracks.

// Autocorrelation of `sig` for lags in [minLag, maxLag]. Returns Float32Array
// of length (maxLag - minLag + 1) with normalised autocorrelation values.
function autocorrelate(sig, minLag, maxLag) {
  const N = sig.length;
  const out = new Float32Array(maxLag - minLag + 1);
  // Precompute mean-centered signal
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

// Find the top-K peaks in an autocorrelation curve, with a minimum spacing.
function topPeaks(curve, k = 5, minSpacing = 3) {
  const peaks = [];
  for (let i = 1; i < curve.length - 1; i++) {
    if (curve[i] > curve[i - 1] && curve[i] >= curve[i + 1] && curve[i] > 0) {
      peaks.push({ idx: i, val: curve[i] });
    }
  }
  peaks.sort((a, b) => b.val - a.val);
  // Enforce spacing
  const kept = [];
  for (const p of peaks) {
    if (kept.every(q => Math.abs(q.idx - p.idx) >= minSpacing)) kept.push(p);
    if (kept.length >= k) break;
  }
  return kept;
}

/**
 * Estimate BPM from a novelty signal + list of onsets.
 * @param {Float32Array} novelty  novelty per frame
 * @param {Array<{time:number}>} onsets  detected onsets
 * @param {number} framesPerSec  novelty frame rate
 * @returns {{bpm:number, confidence:number, candidates:Array}}
 */
export function estimateBPM(novelty, onsets, framesPerSec) {
  // BPM range: 60–200 → period 0.30–1.00 s → lag in frames
  const minBpm = 60, maxBpm = 200;
  const maxLag = Math.floor(framesPerSec * 60 / minBpm);
  const minLag = Math.floor(framesPerSec * 60 / maxBpm);
  if (novelty.length < maxLag * 2) {
    return { bpm: 120, confidence: 0, candidates: [] };
  }

  const acf = autocorrelate(novelty, minLag, maxLag);
  const peaks = topPeaks(acf, 6, 3);
  if (!peaks.length) return { bpm: 120, confidence: 0, candidates: [] };

  // Score each peak: autocorr value + IOI-histogram support (folded to same range)
  const iois = [];
  for (let i = 1; i < onsets.length; i++) {
    const d = onsets[i].time - onsets[i - 1].time;
    if (d >= 0.20 && d <= 1.5) iois.push(d);
  }

  const candidates = peaks.map(p => {
    const lag = p.idx + minLag;
    const period = lag / framesPerSec;
    let bpm = 60 / period;
    // Fold to 70..180 range for scoring but keep original candidate too
    let bpmFolded = bpm;
    while (bpmFolded < 70)  bpmFolded *= 2;
    while (bpmFolded > 180) bpmFolded /= 2;
    // IOI vote: how many IOIs are close to an integer multiple of period?
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

  // Half/double disambiguation: if the second-best is ×2 or ÷2 and much better on IOI
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i];
    const ratio = c.bpmRaw / best.bpmRaw;
    if ((ratio > 1.9 && ratio < 2.1) || (ratio > 0.45 && ratio < 0.55)) {
      if (c.iouScore > best.iouScore * 1.35 && c.autocorr > best.autocorr * 0.7) {
        // Swap
        candidates[0] = c; candidates[i] = best;
        break;
      }
    }
  }

  const finalBpm = candidates[0].bpm;
  const confidence = Math.min(1, candidates[0].score);
  return { bpm: finalBpm, confidence, candidates: candidates.slice(0, 4) };
}
