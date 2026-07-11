// Predominant Local Pulse (PLP) — Grosche & Müller 2011.
//
// Ellis DP beat tracking (which we already have) assumes a single global
// tempo and locks to it. That's fine on rigid electronic tracks, but on
// anything with expressive timing (live drums, rubato piano, slight
// speeding-up in choruses) it drifts.
//
// PLP is different: for each local window (~4 sec) it estimates a local
// tempo AND a local phase (WHERE the beat is), then sums up sinusoidal
// "beat kernels" that peak at every predicted beat time. The result is a
// smooth "pulse curve" whose peaks are the actual beat times, adapted to
// any tempo drift.
//
// Combining Ellis DP + PLP gives us:
//   - Ellis DP: reliable global tempo estimate → tempo prior for PLP
//   - PLP: precise per-beat timing, robust to drift
//
// Cost: one extra FFT-window scan + Fourier-tempogram, ~50 ms for 4-min track.

/**
 * Compute a local-tempo curve from the novelty function via short-time
 * autocorrelation. For each window position we find the strongest
 * autocorrelation lag → local period in frames.
 *
 * @param {Float32Array} novelty
 * @param {number} framesPerSec
 * @param {number} windowSec        analysis window length (default 4 s)
 * @param {number} hopSec           step between windows (default 0.5 s)
 * @param {number} priorBpm         global tempo prior — search stays close to this
 * @returns {{times: Float32Array, periods: Float32Array}}
 *          periods[i] = local period in seconds at times[i]
 */
export function localTempoCurve(novelty, framesPerSec, windowSec, hopSec, priorBpm) {
  const winFrames = Math.floor(windowSec * framesPerSec);
  const hopFrames = Math.max(1, Math.floor(hopSec * framesPerSec));
  // Search ±30% around the prior tempo to allow drift but not go crazy
  const priorPeriod = 60 / priorBpm;
  const minPeriodSec = priorPeriod * 0.70;
  const maxPeriodSec = priorPeriod * 1.30;
  const minLag = Math.max(2, Math.floor(minPeriodSec * framesPerSec));
  const maxLag = Math.ceil(maxPeriodSec * framesPerSec);

  const positions = [];
  const periods = [];
  for (let start = 0; start + winFrames <= novelty.length; start += hopFrames) {
    const slice = novelty.subarray(start, start + winFrames);
    // Simple autocorrelation over the allowed lag range
    const acf = autocorrelateSlice(slice, minLag, maxLag);
    // Weight peaks by proximity to prior (log-Gaussian penalty) so we don't
    // suddenly jump to double/half tempo on ambiguous stretches.
    let bestLag = minLag, bestScore = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      const val = acf[lag - minLag];
      if (val <= 0) continue;
      const periodSec = lag / framesPerSec;
      const drift = Math.log(periodSec / priorPeriod);
      const prior = Math.exp(-0.5 * (drift / 0.10) ** 2); // σ=10% log-Gaussian
      const score = val * prior;
      if (score > bestScore) { bestScore = score; bestLag = lag; }
    }
    positions.push((start + winFrames / 2) / framesPerSec);
    periods.push(bestLag / framesPerSec);
  }
  return {
    times: new Float32Array(positions),
    periods: new Float32Array(periods),
  };
}

// Local, allocation-free autocorrelate for one slice.
function autocorrelateSlice(sig, minLag, maxLag) {
  const N = sig.length;
  const out = new Float32Array(maxLag - minLag + 1);
  let mean = 0;
  for (let i = 0; i < N; i++) mean += sig[i];
  mean /= N;
  let energy = 0;
  const c = new Float32Array(N);
  for (let i = 0; i < N; i++) { c[i] = sig[i] - mean; energy += c[i] * c[i]; }
  if (energy < 1e-9) return out;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i < N - lag; i++) s += c[i] * c[i + lag];
    out[lag - minLag] = s / energy;
  }
  return out;
}

/**
 * Build the PLP pulse curve: sum of sinusoidal beat kernels, one per
 * analysis window, aligned to local tempo AND local phase.
 *
 * For each window, we find the best phase offset by correlating the local
 * novelty with a template of sin(2π·frame/period). The window then
 * contributes a cosine wave (cos(2π·(t-phase)/period)) to the global pulse.
 *
 * @param {Float32Array} novelty
 * @param {number} framesPerSec
 * @param {{times, periods}} tempoCurve  from localTempoCurve()
 * @returns {Float32Array} pulse per frame — peaks = beats
 */
export function buildPLPCurve(novelty, framesPerSec, tempoCurve) {
  const N = novelty.length;
  const pulse = new Float32Array(N);
  const windowSec = (tempoCurve.times[1] ?? 4) - (tempoCurve.times[0] ?? 0);
  const winFrames = Math.max(2, Math.floor(windowSec * framesPerSec));

  for (let w = 0; w < tempoCurve.times.length; w++) {
    const centerSec = tempoCurve.times[w];
    const centerFrame = Math.round(centerSec * framesPerSec);
    const periodSec = tempoCurve.periods[w];
    const periodFr = periodSec * framesPerSec;

    // Find best phase in this window: which offset makes the local novelty
    // align best with a beat template of period `periodFr`?
    const start = Math.max(0, centerFrame - winFrames);
    const end   = Math.min(N, centerFrame + winFrames);
    let bestPhase = 0, bestCorr = -Infinity;
    // Scan phases in ~10 steps (finer than that is diminishing returns)
    const phaseSteps = 12;
    for (let p = 0; p < phaseSteps; p++) {
      const phase = (p / phaseSteps) * periodFr;
      let corr = 0;
      for (let f = start; f < end; f++) {
        corr += novelty[f] * Math.cos(2 * Math.PI * (f - centerFrame - phase) / periodFr);
      }
      if (corr > bestCorr) { bestCorr = corr; bestPhase = phase; }
    }

    // Add this window's cosine contribution, weighted by a Hann taper so
    // window boundaries blend smoothly.
    for (let f = start; f < end; f++) {
      const rel = (f - start) / (end - start);
      const hann = 0.5 * (1 - Math.cos(2 * Math.PI * rel));
      const v = Math.cos(2 * Math.PI * (f - centerFrame - bestPhase) / periodFr);
      pulse[f] += Math.max(0, v) * hann;
    }
  }
  return pulse;
}

/**
 * Extract beat times as local maxima of the PLP pulse curve.
 * Enforces a minimum spacing of ~70% of the local period.
 */
export function extractBeats(pulse, framesPerSec, tempoCurve) {
  const beats = [];
  const N = pulse.length;
  let lastBeatFrame = -Infinity;
  // Local threshold: 0.3 × running max over the last 2 seconds
  const winFrames = Math.floor(2 * framesPerSec);
  let runningMax = 0;
  for (let f = 1; f < N - 1; f++) {
    // Rolling max update — cheap
    if (pulse[f] > runningMax) runningMax = pulse[f];
    if (f % winFrames === 0) runningMax *= 0.8; // decay
    const thr = runningMax * 0.30;
    if (pulse[f] < thr) continue;
    if (pulse[f] <= pulse[f - 1] || pulse[f] < pulse[f + 1]) continue;
    // Find local period at this time to enforce min spacing
    const tSec = f / framesPerSec;
    const wIdx = findWindowIndex(tempoCurve.times, tSec);
    const localPeriod = tempoCurve.periods[wIdx] || 0.5;
    const minGapFrames = Math.floor(localPeriod * framesPerSec * 0.70);
    if (f - lastBeatFrame < minGapFrames) continue;
    beats.push(tSec);
    lastBeatFrame = f;
  }
  return beats;
}

function findWindowIndex(times, tSec) {
  // times is sorted, binary search
  let lo = 0, hi = times.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= tSec) lo = mid; else hi = mid;
  }
  return lo;
}

/**
 * Downbeat detection — figure out WHICH of the tracked beats are the
 * strong "1" of each measure. Simple heuristic:
 *
 *   For each beat, compute a "downbeat score" = sum of:
 *     - onset strength at that beat (strong beats coincide with kicks)
 *     - low-frequency-band energy at that beat (bass hits on 1)
 *     - repetitive spacing (downbeats are 4 beats apart in 4/4 time)
 *
 *   Then find the phase (0, 1, 2 or 3) that maximises total score.
 *   Return the indices of tracked beats that are downbeats.
 *
 * @param {number[]} beats     tracked beat times
 * @param {Float32Array} novelty
 * @param {Float32Array} bassEnvelope  low-freq energy envelope (optional)
 * @param {number} framesPerSec
 * @param {number} beatsPerMeasure  usually 4
 * @returns {{downbeatIndices: number[], phase: number, confidence: number}}
 */
export function detectDownbeats(beats, novelty, bassEnvelope, framesPerSec, beatsPerMeasure = 4) {
  if (beats.length < beatsPerMeasure * 2) {
    return { downbeatIndices: [], phase: 0, confidence: 0 };
  }
  const scoreAt = (t) => {
    const f = Math.floor(t * framesPerSec);
    if (f < 0 || f >= novelty.length) return 0;
    let s = novelty[f];
    if (bassEnvelope && f < bassEnvelope.length) s += bassEnvelope[f] * 0.5;
    return s;
  };
  // Try each phase, pick the one with highest average score
  const scores = new Array(beatsPerMeasure).fill(0);
  const counts = new Array(beatsPerMeasure).fill(0);
  for (let i = 0; i < beats.length; i++) {
    const p = i % beatsPerMeasure;
    scores[p] += scoreAt(beats[i]);
    counts[p]++;
  }
  const avg = scores.map((s, i) => counts[i] ? s / counts[i] : 0);
  let bestPhase = 0, bestAvg = -Infinity;
  for (let p = 0; p < beatsPerMeasure; p++) {
    if (avg[p] > bestAvg) { bestAvg = avg[p]; bestPhase = p; }
  }
  // Confidence: how much better is the best phase vs the average of others
  const others = avg.filter((_, i) => i !== bestPhase);
  const meanOther = others.reduce((a, b) => a + b, 0) / others.length || 1e-6;
  const confidence = Math.min(1, (bestAvg - meanOther) / (meanOther + 1e-6));

  const downbeatIndices = [];
  for (let i = bestPhase; i < beats.length; i += beatsPerMeasure) {
    downbeatIndices.push(i);
  }
  return { downbeatIndices, phase: bestPhase, confidence };
}
