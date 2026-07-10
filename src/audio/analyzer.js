// Etap 1: new analyzer. Spawns a Web Worker that does STFT + multiband spectral
// flux + adaptive peak-picking + autocorrelation BPM. This module then converts
// the returned onsets into the note layout the game expects (with HOLD detection
// and lane distribution, ported from v1.1 with minor cleanup).

let worker = null;
function getWorker() {
  if (worker) return worker;
  // Vite/Electron file:// friendly: module worker with relative URL
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  return worker;
}

// Downmix a decoded AudioBuffer to mono Float32Array.
function downmix(audioBuffer) {
  const n = audioBuffer.length;
  const ch = audioBuffer.numberOfChannels;
  const out = new Float32Array(n);
  for (let c = 0; c < ch; c++) {
    const cd = audioBuffer.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += cd[i] / ch;
  }
  return out;
}

/**
 * @param {AudioBuffer} audioBuffer
 * @param {string} modeStr  'drums' | 'classic' | 'vocal'
 * @param {number} sens     0.5..2.5
 * @param {object} opts     { holdEnable, holdMode, dual, smartLane, onProgress? }
 * @returns {Promise<{notes,bpm,bpmConfidence,times,analysisMs}>}
 */
export async function analyzeTrack(audioBuffer, modeStr, sens, opts) {
  const sr = audioBuffer.sampleRate;
  const mono = downmix(audioBuffer);
  const w = getWorker();

  const result = await new Promise((resolve, reject) => {
    const onMessage = (e) => {
      const d = e.data;
      if (d.progress !== undefined) {
        opts.onProgress?.(d.progress, d.stage);
        return;
      }
      w.removeEventListener('message', onMessage);
      if (d.ok) resolve(d); else reject(new Error(d.error || 'worker failed'));
    };
    w.addEventListener('message', onMessage);
    // Transfer PCM ownership to worker — zero copy
    w.postMessage(
      { pcm: mono, sampleRate: sr, mode: modeStr, sens },
      [mono.buffer]
    );
  });

  // Build note events from onsets + HOLD detection (uses novelty as sustain proxy)
  const events = buildEvents(result, audioBuffer.duration, modeStr, opts);

  // Chord doubling
  if (opts.dual) {
    const dualEvents = [];
    for (let i = 1; i < events.length - 1; i++) {
      if (!events[i].isHold && Math.random() < 0.11) {
        dualEvents.push({ ...events[i], chord: true });
      }
    }
    events.push(...dualEvents);
    events.sort((a, b) => a.time - b.time);
  }

  // Lane assignment
  const out = assignLanes(events, opts.smartLane);

  return {
    notes: out,
    bpm: result.bpm,
    bpmConfidence: result.bpmConfidence,
    bpmCandidates: result.bpmCandidates,
    times: result.onsetTimes,
    analysisMs: result.analysisMs,
  };
}

// Build note events (time, endTime, isHold) from the worker output.
function buildEvents(res, duration, modeStr, opts) {
  const { onsetTimes, novelty, framesPerSec, bpm } = res;
  const holdEnable = opts.holdEnable;
  const holdBias = opts.holdMode; // 0=off, 1=auto, 2=lots

  // Estimate frame-level sustained energy for hold detection using a smoothed
  // novelty envelope. High and stable → sustain (harmonic-like passage).
  const smoothN = smoothEnvelope(novelty, 5);
  const nMean = mean(smoothN) || 1e-6;

  const sustainParams = modeStr === 'vocal'
    ? { thr: nMean * 0.55, minH: 0.36, maxH: 2.10, prob: holdBias === 2 ? 0.70 : holdBias === 1 ? 0.50 : 0 }
    : modeStr === 'classic'
      ? { thr: nMean * 0.70, minH: 0.34, maxH: 1.6,  prob: holdBias === 2 ? 0.48 : holdBias === 1 ? 0.32 : 0 }
      : { thr: nMean * 1.10, minH: 0.28, maxH: 0.90, prob: holdBias === 2 ? 0.28 : holdBias === 1 ? 0.14 : 0 };

  const beatLen = bpm > 40 ? 60 / bpm : 0.5;
  const events = [];

  for (let idx = 0; idx < onsetTimes.length; idx++) {
    const t = onsetTimes[idx];
    if (t < 0.30 || t > duration - 0.30) continue;
    const nextT = onsetTimes[idx + 1] || duration;
    let holdDur = 0;

    if (holdEnable && sustainParams.prob > 0 && Math.random() < sustainParams.prob) {
      const f0 = Math.floor(t * framesPerSec);
      const maxFrames = Math.floor(sustainParams.maxH * framesPerSec);
      let sustainFrames = 0;
      let below = 0;
      for (let f = f0 + 1; f < smoothN.length && sustainFrames < maxFrames; f++) {
        if (smoothN[f] > sustainParams.thr) { sustainFrames++; below = 0; }
        else { below++; if (below > 3) break; sustainFrames++; }
      }
      holdDur = sustainFrames / framesPerSec;
      if (holdDur < sustainParams.minH) holdDur = 0;
      const gap = nextT - t - 0.16;
      if (holdDur > gap) holdDur = gap > sustainParams.minH ? gap : 0;
      if (holdDur > sustainParams.maxH) holdDur = sustainParams.maxH;
      if (modeStr === 'drums' && holdDur > 0.72) holdDur = 0.45 + Math.random() * 0.27;
      // Snap to nearest 0.5 beat when we know BPM
      if (bpm > 50 && holdDur > 0.35) {
        const beats = Math.round(holdDur / beatLen * 2) / 2;
        const snapped = Math.max(sustainParams.minH, beats * beatLen);
        if (snapped <= sustainParams.maxH && snapped < gap) holdDur = snapped;
      }
    }
    events.push({ time: t, endTime: t + holdDur, isHold: holdDur >= 0.34 });
  }
  return events;
}

function assignLanes(events, smartLane) {
  const laneEnd = [0, 0, 0, 0];
  const out = [];
  for (const ev of events) {
    let candidates = [0, 1, 2, 3].filter(l => laneEnd[l] + 0.06 < ev.time);
    if (candidates.length === 0) {
      candidates = [0, 1, 2, 3];
      candidates.sort((a, b) => laneEnd[a] - laneEnd[b]);
      candidates = [candidates[0]];
    }
    let lane;
    if (smartLane) {
      const lastLane = out.length ? out[out.length - 1].lane : -1;
      const filtered = candidates.filter(c => c !== lastLane);
      lane = (filtered.length ? filtered : candidates)[Math.floor(Math.random() * (filtered.length || candidates.length))];
    } else {
      lane = candidates[Math.floor(Math.random() * candidates.length)];
    }
    if (ev.chord) {
      const twin = out.find(o => Math.abs(o.time - ev.time) < 0.015);
      if (twin) { lane = ([0, 1, 2, 3].find(c => c !== twin.lane && laneEnd[c] + 0.05 < ev.time)) ?? lane; }
    }
    laneEnd[lane] = ev.endTime + 0.035;
    out.push({
      time: ev.time,
      endTime: ev.endTime,
      isHold: ev.isHold,
      lane,
      judged: false,
      holding: false,
      holdProgress: 0,
    });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

function smoothEnvelope(sig, halfWin) {
  const N = sig.length;
  const out = new Float32Array(N);
  let sum = 0;
  const win = halfWin * 2 + 1;
  for (let i = 0; i < Math.min(win, N); i++) sum += sig[i];
  for (let i = 0; i < N; i++) {
    const lo = i - halfWin, hi = i + halfWin;
    if (lo > 0)   sum -= sig[lo - 1] ?? 0;
    if (hi < N)   sum += sig[hi]     ?? 0;
    const cnt = Math.min(hi, N - 1) - Math.max(0, lo) + 1;
    out[i] = sum / cnt;
  }
  return out;
}
function mean(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; }

// Kept for API back-compat (someone may still call this from console)
export function detectBPM() {
  return { bpm: 120, confidence: 0 };
}
