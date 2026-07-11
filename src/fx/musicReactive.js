// Etap 9: Live music-reactive visuals.
//
// Attaches an AnalyserNode in parallel to the playback chain (source → gain
// → destination is untouched; we tap off `source → analyser` too). Each
// render frame samples the analyser and exposes:
//
//   - bass / mid / high energy (0..1 smoothed)
//   - overall RMS (0..1 smoothed)
//   - a live beat flash flag (short pulse on sudden RMS jumps)
//
// The renderer reads these values to modulate:
//   - background radial gradient brightness (from bass)
//   - HUD/hit-line pulse (from beat flag)
//   - saturation multiplier (from overall RMS)
//   - optional spectrum-bar visualisation at the bottom of the screen
//
// Cheap: 1 analyser + ~128 bytes/frame, no per-pixel work.

const FFT_SIZE = 256;   // 128 bins is plenty for cosmetic reactivity
const BASS_HI  = 6;     // bin index for ~1 kHz range boundary (band 0..5 = bass)
const MID_HI   = 32;    // bin 6..31 = mid (roughly 1-6 kHz)

export const reactive = {
  bass: 0,
  mid: 0,
  high: 0,
  rms: 0,
  beatFlash: 0,   // 0..1 decaying
  bars: null,     // Uint8Array of 32 bar heights for spectrum viz

  _analyser: null,
  _buf: null,
  _rmsHistory: [],
  _lastPeakTime: 0,
};

/**
 * Attach analyser to the given audio node (typically gainNode).
 * Call once when play starts. Safe to re-attach — old analyser is replaced.
 */
export function attachAnalyser(audioCtx, sourceOrGain) {
  if (!audioCtx || !sourceOrGain) return;
  detachAnalyser();
  const a = audioCtx.createAnalyser();
  a.fftSize = FFT_SIZE;
  a.smoothingTimeConstant = 0.75;
  sourceOrGain.connect(a);
  // NB: we do NOT connect analyser to destination — it's a tap point.
  reactive._analyser = a;
  reactive._buf = new Uint8Array(a.frequencyBinCount);
  reactive._rmsHistory.length = 0;
  reactive._lastPeakTime = 0;
  reactive.bars = new Uint8Array(32);
}

export function detachAnalyser() {
  if (reactive._analyser) {
    try { reactive._analyser.disconnect(); } catch {}
  }
  reactive._analyser = null;
  reactive._buf = null;
  reactive.bass = 0;
  reactive.mid = 0;
  reactive.high = 0;
  reactive.rms = 0;
  reactive.beatFlash = 0;
  reactive.bars = null;
}

/**
 * Sample the analyser and update reactive.* fields. Call every render frame.
 * @param {number} dt  seconds since last frame (for decay)
 * @param {number} nowSec  clock time for beat-flash rate limiting
 */
export function sampleReactive(dt, nowSec) {
  if (!reactive._analyser) return;
  const buf = reactive._buf;
  reactive._analyser.getByteFrequencyData(buf);

  // Band energies (0..1)
  let bassSum = 0, midSum = 0, highSum = 0, allSum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i] / 255;
    allSum += v;
    if (i < BASS_HI)      bassSum += v;
    else if (i < MID_HI)  midSum += v;
    else                  highSum += v;
  }
  const bass = bassSum / BASS_HI;
  const mid  = midSum / (MID_HI - BASS_HI);
  const high = highSum / (buf.length - MID_HI);
  const rms  = allSum / buf.length;

  // Attack-release smoothing so the values don't jitter frame-to-frame.
  // Fast attack, slow release: reacts quickly to hits, decays gracefully.
  const attack  = Math.min(1, dt * 18);
  const release = Math.min(1, dt * 4);
  reactive.bass = bass > reactive.bass ? reactive.bass + (bass - reactive.bass) * attack
                                        : reactive.bass + (bass - reactive.bass) * release;
  reactive.mid  = mid  > reactive.mid  ? reactive.mid  + (mid  - reactive.mid)  * attack
                                        : reactive.mid  + (mid  - reactive.mid)  * release;
  reactive.high = high > reactive.high ? reactive.high + (high - reactive.high) * attack
                                        : reactive.high + (high - reactive.high) * release;
  reactive.rms  = rms  > reactive.rms  ? reactive.rms  + (rms  - reactive.rms)  * attack
                                        : reactive.rms  + (rms  - reactive.rms)  * release;

  // Beat flash: sudden RMS jumps trigger a short pulse. Simple flux:
  //   if current bass rise > 0.10 relative to short average → flash
  reactive._rmsHistory.push(bass);
  if (reactive._rmsHistory.length > 12) reactive._rmsHistory.shift();
  const hist = reactive._rmsHistory;
  const avg = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : 0;
  const rise = bass - avg;
  if (rise > 0.10 && nowSec - reactive._lastPeakTime > 0.12) {
    reactive.beatFlash = Math.min(1, reactive.beatFlash + Math.min(1, rise * 3));
    reactive._lastPeakTime = nowSec;
  }
  reactive.beatFlash = Math.max(0, reactive.beatFlash - dt * 4);

  // Downsample buf → 32 bars for the equaliser viz
  const bars = reactive.bars;
  const step = buf.length / bars.length;
  for (let b = 0; b < bars.length; b++) {
    const lo = Math.floor(b * step);
    const hi = Math.floor((b + 1) * step);
    let s = 0;
    for (let i = lo; i < hi; i++) s += buf[i];
    bars[b] = s / (hi - lo);
  }
}
