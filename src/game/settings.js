// Persistent user settings (volume, FX quality). Separate from calibration.js
// so that things which change per-play don't touch calibration data.

const LS_KEY = 'wt.settings.v1';

const DEFAULTS = {
  volume: 0.55,          // 0..1, master output volume
  fxQuality: 'high',     // 'high' | 'medium' | 'low'
  hpssMode: 'hard',      // Etap 2: 'off' | 'hard' | 'soft' | 'iterative'
  bgSpectrum: false,     // Etap 9: show live equaliser bars at bottom
  bgReactive: true,      // Etap 9: bass-pulsed background glow
  motionBlur: false,     // Etap 8: frame accumulation trail
  vignette: true,        // Etap 8: dark corners for depth
  noteTrails: true,      // Etap 8: ghost copies behind moving notes
  bloom: false,          // Etap 8: additive-blend blurred pass over bright bits
};

export const settings = { ...DEFAULTS };

export function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (typeof obj.volume     === 'number')  settings.volume     = Math.max(0, Math.min(1, obj.volume));
    if (typeof obj.fxQuality  === 'string')  settings.fxQuality  = obj.fxQuality;
    if (typeof obj.hpssMode   === 'string')  settings.hpssMode   = obj.hpssMode;
    if (typeof obj.bgSpectrum === 'boolean') settings.bgSpectrum = obj.bgSpectrum;
    if (typeof obj.bgReactive === 'boolean') settings.bgReactive = obj.bgReactive;
    if (typeof obj.motionBlur === 'boolean') settings.motionBlur = obj.motionBlur;
    if (typeof obj.vignette   === 'boolean') settings.vignette   = obj.vignette;
    if (typeof obj.noteTrails === 'boolean') settings.noteTrails = obj.noteTrails;
    if (typeof obj.bloom      === 'boolean') settings.bloom      = obj.bloom;
  } catch { /* ignore */ }
}

export function saveSettings() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      volume: settings.volume,
      fxQuality: settings.fxQuality,
      hpssMode: settings.hpssMode,
      bgSpectrum: settings.bgSpectrum,
      bgReactive: settings.bgReactive,
      motionBlur: settings.motionBlur,
      vignette:   settings.vignette,
      noteTrails: settings.noteTrails,
      bloom:      settings.bloom,
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
