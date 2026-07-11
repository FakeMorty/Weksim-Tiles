// Persistent user settings (volume, FX quality). Separate from calibration.js
// so that things which change per-play don't touch calibration data.

const LS_KEY = 'wt.settings.v1';
const MIGRATION_FLAG = 'wt.settings.migrated.v124'; // one-shot Etap E migration

const DEFAULTS = {
  volume: 0.55,          // 0..1, master output volume
  fxQuality: 'high',     // 'high' | 'medium' | 'low'
  hpssMode: 'hard',      // Etap 2: 'off' | 'hard' | 'soft' | 'iterative'
  nmfMode: 'auto',       // Etap D (v1.23): 'off' | 'fast' | 'auto' | 'quality'
  bgSpectrum: false,     // Etap 9: show live equaliser bars at bottom
  bgReactive: true,      // Etap 9: bass-pulsed background glow
  motionBlur: false,     // Etap 8: frame accumulation trail
  vignette: true,        // Etap 8: dark corners for depth
  noteTrails: true,      // Etap 8: ghost copies behind moving notes
  bloom: false,          // Etap 8: additive-blend blurred pass over bright bits
  // Etap E (v1.24)
  warmup: true,          // 4-beat count-in metronome before track starts
  warmupBeats: 4,        // number of count-in beats (2..8)
  hitSound: 'click',     // 'off' | 'click' | 'kick' | 'snare' | 'custom' — on by default (Etap E v1.24.1)
  hitSoundVolume: 0.5,   // 0..1
  hitSoundCustomB64: '', // base64-encoded custom sample (data-URL body)
  botHitSound: 'click',  // separate hit sound for bot playback ('off' | 'click' | 'kick' | 'snare' | 'custom')
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
    if (typeof obj.nmfMode    === 'string')  settings.nmfMode    = obj.nmfMode;
    if (typeof obj.bgSpectrum === 'boolean') settings.bgSpectrum = obj.bgSpectrum;
    if (typeof obj.bgReactive === 'boolean') settings.bgReactive = obj.bgReactive;
    if (typeof obj.motionBlur === 'boolean') settings.motionBlur = obj.motionBlur;
    if (typeof obj.vignette   === 'boolean') settings.vignette   = obj.vignette;
    if (typeof obj.noteTrails === 'boolean') settings.noteTrails = obj.noteTrails;
    if (typeof obj.bloom      === 'boolean') settings.bloom      = obj.bloom;
    if (typeof obj.warmup     === 'boolean') settings.warmup     = obj.warmup;
    if (typeof obj.warmupBeats === 'number') settings.warmupBeats = Math.max(2, Math.min(8, obj.warmupBeats|0));
    if (typeof obj.hitSound   === 'string')  settings.hitSound   = obj.hitSound;
    if (typeof obj.hitSoundVolume === 'number') settings.hitSoundVolume = Math.max(0, Math.min(1, obj.hitSoundVolume));
    if (typeof obj.hitSoundCustomB64 === 'string') settings.hitSoundCustomB64 = obj.hitSoundCustomB64;
    if (typeof obj.botHitSound === 'string') settings.botHitSound = obj.botHitSound;

    // v1.24.1: one-shot migration — users of v1.24.0 got hitSound='off' by
    // default; nobody would think to turn it on. Force it back to 'click'
    // ONCE, then set a flag so we never override the user's choice again.
    try {
      if (!localStorage.getItem(MIGRATION_FLAG)) {
        if (settings.hitSound === 'off') settings.hitSound = 'click';
        if (!settings.botHitSound || settings.botHitSound === 'off') settings.botHitSound = 'click';
        localStorage.setItem(MIGRATION_FLAG, '1');
        saveSettings();
      }
    } catch { /* ignore */ }
  } catch { /* ignore */ }
}

export function saveSettings() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      volume: settings.volume,
      fxQuality: settings.fxQuality,
      hpssMode: settings.hpssMode,
      nmfMode: settings.nmfMode,
      bgSpectrum: settings.bgSpectrum,
      bgReactive: settings.bgReactive,
      motionBlur: settings.motionBlur,
      vignette:   settings.vignette,
      noteTrails: settings.noteTrails,
      bloom:      settings.bloom,
      warmup:     settings.warmup,
      warmupBeats: settings.warmupBeats,
      hitSound:   settings.hitSound,
      hitSoundVolume: settings.hitSoundVolume,
      hitSoundCustomB64: settings.hitSoundCustomB64,
      botHitSound: settings.botHitSound,
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
