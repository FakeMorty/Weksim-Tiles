// Pause screen wiring: continue / restart / exit, plus master volume slider.

import { resumeGame, restartCurrent, exitToMenu, setVolume } from '../game/loop.js';
import { settings, saveSettings, fxLevel } from '../game/settings.js';
import { state } from '../game/state.js';

export function bindPause() {
  document.getElementById('pauseContinueBtn')?.addEventListener('click', () => resumeGame());
  document.getElementById('pauseRestartBtn')?.addEventListener('click', () => restartCurrent());
  document.getElementById('pauseExitBtn')?.addEventListener('click', () => exitToMenu());

  // Volume slider (works in both pause and menu contexts)
  bindVolumeSlider('pauseVolume', 'pauseVolumeVal');
  bindVolumeSlider('menuVolume',  'menuVolumeVal');

  // FX quality selector (in menu)
  const fxSel = document.getElementById('fxQualitySelect');
  if (fxSel) {
    fxSel.value = settings.fxQuality;
    fxSel.addEventListener('change', async () => {
      settings.fxQuality = fxSel.value;
      saveSettings();
      // Adjust canvas resolution — low FX drops to DPR=1
      const { refreshDPR } = await import('../utils/canvas.js');
      const { invalidateGradCache } = await import('../render/renderer.js');
      refreshDPR();
      invalidateGradCache();
    });
  }

  // Etap 2: HPSS mode selector (in menu)
  const hpssSel = document.getElementById('hpssModeSelect');
  if (hpssSel) {
    hpssSel.value = settings.hpssMode;
    hpssSel.addEventListener('change', () => {
      settings.hpssMode = hpssSel.value;
      saveSettings();
    });
  }

  // Etap D (v1.23): NMF mode selector
  const nmfSel = document.getElementById('nmfModeSelect');
  if (nmfSel) {
    nmfSel.value = settings.nmfMode || 'auto';
    nmfSel.addEventListener('change', () => {
      settings.nmfMode = nmfSel.value;
      saveSettings();
    });
  }

  // Etap E (v1.24): Hit sound selectors (menu-side)
  bindHitSoundSelect('hitSoundSelect', 'hitSound');
  bindWarmup();

  // Etap E (v1.24): Custom hit sound file loader
  const hitFile = document.getElementById('hitSoundFile');
  const hitStatusEl = document.getElementById('hitSoundStatus');
  const hitSel = document.getElementById('hitSoundSelect');
  if (hitSel && hitFile) {
    hitSel.addEventListener('change', () => {
      if (hitSel.value === 'custom') hitFile.click();
    });
    hitFile.addEventListener('change', async () => {
      const f = hitFile.files?.[0];
      if (!f) return;
      const { loadCustomHitSoundFromFile } = await import('../game/hitsound.js');
      // Ensure an audio context exists so hit sound has a target
      if (!state.audioCtx) state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const { bindHitSoundOutput } = await import('../game/hitsound.js');
      bindHitSoundOutput(state.audioCtx, state.audioCtx.destination);
      const res = await loadCustomHitSoundFromFile(f);
      if (res.ok) {
        if (hitStatusEl) hitStatusEl.textContent = '✓ ' + f.name + ' (' + res.duration.toFixed(2) + 's)';
      } else {
        if (hitStatusEl) hitStatusEl.textContent = '⚠ ' + res.error;
      }
    });
  }

  // Etap E (v1.24): pause-screen hit sound switchers (both player + bot)
  bindHitSoundSelect('pauseHitSound', 'hitSound');
  bindHitSoundSelect('pauseBotHitSound', 'botHitSound');

  // Etap 9: reactive background + spectrum toggles
  bindCheckbox('bgReactiveCheck', 'bgReactive');
  bindCheckbox('bgSpectrumCheck', 'bgSpectrum');

  // Etap 8: postprocess effect toggles
  bindCheckbox('vignetteCheck',   'vignette');
  bindCheckbox('noteTrailsCheck', 'noteTrails');
  bindCheckbox('motionBlurCheck', 'motionBlur');
  bindCheckbox('bloomCheck',      'bloom');
}

function bindCheckbox(elId, settingKey) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.checked = settings[settingKey];
  el.addEventListener('change', () => {
    settings[settingKey] = el.checked;
    saveSettings();
  });

  refreshVolumeUI();
}

function bindHitSoundSelect(elId, settingKey) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.value = settings[settingKey] || 'off';
  el.addEventListener('change', () => {
    settings[settingKey] = el.value;
    saveSettings();
    // Mirror across menu + pause selectors when they share the key
    const mirrorId = elId === 'hitSoundSelect' ? 'pauseHitSound'
                   : elId === 'pauseHitSound' ? 'hitSoundSelect' : null;
    if (mirrorId) {
      const other = document.getElementById(mirrorId);
      if (other) other.value = el.value;
    }
  });
}

function bindWarmup() {
  const s = document.getElementById('warmupBeats');
  const v = document.getElementById('warmupBeatsVal');
  if (!s) return;
  const initial = settings.warmup ? (settings.warmupBeats || 4) : 0;
  s.value = String(initial);
  if (v) v.textContent = String(initial);
  s.addEventListener('input', () => {
    const n = parseInt(s.value, 10);
    if (n <= 0) { settings.warmup = false; settings.warmupBeats = 4; }
    else { settings.warmup = true; settings.warmupBeats = Math.max(2, Math.min(8, n)); }
    if (v) v.textContent = n === 0 ? 'off' : String(n);
    saveSettings();
  });
}

function bindVolumeSlider(sliderId, valueId) {
  const s = document.getElementById(sliderId);
  const v = document.getElementById(valueId);
  if (!s) return;
  s.value = Math.round(settings.volume * 100);
  if (v) v.textContent = s.value + '%';
  s.addEventListener('input', () => {
    const val = parseInt(s.value, 10) / 100;
    setVolume(val);
    saveSettings();
    if (v) v.textContent = s.value + '%';
    // Mirror across both sliders
    const other = sliderId === 'pauseVolume' ? 'menuVolume' : 'pauseVolume';
    const otherVal = sliderId === 'pauseVolume' ? 'menuVolumeVal' : 'pauseVolumeVal';
    const o = document.getElementById(other);
    const ov = document.getElementById(otherVal);
    if (o) o.value = s.value;
    if (ov) ov.textContent = s.value + '%';
  });
}

export function refreshVolumeUI() {
  const pct = Math.round(settings.volume * 100);
  for (const id of ['pauseVolume', 'menuVolume']) {
    const s = document.getElementById(id);
    if (s) s.value = pct;
  }
  for (const id of ['pauseVolumeVal', 'menuVolumeVal']) {
    const v = document.getElementById(id);
    if (v) v.textContent = pct + '%';
  }
}
