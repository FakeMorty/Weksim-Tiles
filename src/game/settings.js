// Persistent user settings (volume, FX quality). Separate from calibration.js
// so that things which change per-play don't touch calibration data.

const LS_KEY = 'wt.settings.v1';

const DEFAULTS = {
  volume: 0.55,        // 0..1, master output volume
  fxQuality: 'high',   // 'high' | 'medium' | 'low'
};

export const settings = { ...DEFAULTS };

export function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (typeof obj.volume    === 'number') settings.volume    = Math.max(0, Math.min(1, obj.volume));
    if (typeof obj.fxQuality === 'string') settings.fxQuality = obj.fxQuality;
  } catch { /* ignore */ }
}

export function saveSettings() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      volume: settings.volume,
      fxQuality: settings.fxQuality,
    }));
  } catch { /* ignore */ }
}

// Convenience flags for the renderer/particles
export function fxLevel() {
  return settings.fxQuality; // 'high' | 'medium' | 'low'
}
export function fxHigh()   { return settings.fxQuality === 'high'; }
export function fxMedium() { return settings.fxQuality !== 'low'; }
export function fxLow()    { return settings.fxQuality === 'low'; }
