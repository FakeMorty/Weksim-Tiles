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
