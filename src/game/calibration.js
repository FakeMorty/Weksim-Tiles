// User-tunable audio/visual offsets and judge strictness.
// Persisted in localStorage. Applied in judge.js on every hit-check.

const LS_KEY = 'wt.calibration.v1';

const DEFAULTS = {
  // Positive audioOffset (ms) = "you hear the beat later than it happens" →
  // shift judged time LATER so a slightly-late tap counts as on-time.
  audioOffset: 0,
  // Positive visualOffset (ms) = "notes appear to arrive later than they do" →
  // shift rendered position earlier. Rendering only; does NOT affect scoring.
  visualOffset: 0,
  // Judge strictness multiplier applied to base windows in config.JUDGE.
  // 'lenient' 1.35 · 'normal' 1.00 · 'strict' 0.75 · 'insane' 0.55
  judgeMode: 'normal',
};

export const calibration = { ...DEFAULTS };

export function loadCalibration() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (typeof obj.audioOffset  === 'number') calibration.audioOffset  = obj.audioOffset;
    if (typeof obj.visualOffset === 'number') calibration.visualOffset = obj.visualOffset;
    if (typeof obj.judgeMode    === 'string') calibration.judgeMode    = obj.judgeMode;
  } catch { /* ignore */ }
}

export function saveCalibration() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      audioOffset:  calibration.audioOffset,
      visualOffset: calibration.visualOffset,
      judgeMode:    calibration.judgeMode,
    }));
  } catch { /* ignore */ }
}

export function resetCalibration() {
  Object.assign(calibration, DEFAULTS);
  saveCalibration();
}

const JUDGE_MULT = {
  lenient: 1.35,
  normal:  1.00,
  strict:  0.75,
  insane:  0.55,
};

export function judgeMultiplier() {
  return JUDGE_MULT[calibration.judgeMode] ?? 1.0;
}

// Compute Web Audio-based initial guess for audio latency.
// Chromium exposes baseLatency (device→speaker) and outputLatency (real hw buffer).
export function suggestAudioOffsetMs(audioCtx) {
  if (!audioCtx) return 0;
  const base = (audioCtx.baseLatency   || 0) * 1000;
  const out  = (audioCtx.outputLatency || 0) * 1000;
  // outputLatency is what the user actually hears late; use it if available.
  return Math.round(out || base);
}
