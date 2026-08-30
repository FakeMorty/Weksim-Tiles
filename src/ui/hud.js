// HUD numeric updates.

import { state } from '../game/state.js';
import { getLocale } from '../i18n/i18n.js';
import { computeAccuracy, hitCount } from '../game/accuracy.js';
import { settings } from '../game/settings.js';

export function updateHUD() {
  const nfLocale = getLocale() === 'ru' ? 'ru-RU' : getLocale();
  const scoreEl = document.getElementById('scoreEl');
  if (scoreEl) scoreEl.textContent = state.score.toLocaleString(nfLocale);
  const comboEl = document.getElementById('comboEl');
  if (comboEl) comboEl.textContent = state.combo;
  const accEl = document.getElementById('accEl');
  if (accEl) accEl.textContent = computeAccuracy(state) + '%';
  const hitsEl = document.getElementById('hitsEl');
  if (hitsEl) hitsEl.textContent = hitCount(state) + ' / ' + state.notes.length;

  const hpRow = document.getElementById('hpRow');
  const hpFill = document.getElementById('hpFill');
  if (hpRow && hpFill) {
    const hide = settings.noFail || state.botMode;
    hpRow.style.display = hide ? 'none' : 'flex';
    const pct = Math.max(0, Math.min(100, state.health));
    hpFill.style.width = pct.toFixed(1) + '%';
    hpFill.style.background = pct > 50
      ? 'linear-gradient(90deg,#7aff99,#7dfffa)'
      : pct > 25
        ? 'linear-gradient(90deg,#ffb066,#ffd86a)'
        : 'linear-gradient(90deg,#ff5566,#ff9db0)';
  }
}

export function updateSongProgress(tSong, duration) {
  const bar = document.getElementById('songProgressFill');
  if (!bar) return;
  const dur = duration || 1;
  const pct = Math.max(0, Math.min(1, tSong / dur));
  bar.style.width = (pct * 100).toFixed(2) + '%';
}

export function setSongProgressVisible(on) {
  const el = document.getElementById('songProgress');
  if (el) el.style.display = on ? 'block' : 'none';
}

