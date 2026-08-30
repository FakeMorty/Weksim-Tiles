// Desktop chrome: auto-pause, cursor hide, menu shortcuts, help overlay.

import { state } from '../game/state.js';
import { t } from '../i18n/i18n.js';

const BASE_TITLE = (typeof document !== 'undefined' && document.title) || 'Rhythm Shooter';

export function bindChrome() {
  document.addEventListener?.('visibilitychange', () => {
    if (!document.hidden) return;
    if (!state.gameRunning || state.paused) return;
    import('../game/loop.js').then(m => m.pauseGame()).catch(() => {});
  });

  window.addEventListener('mousemove', bumpCursor);
  window.addEventListener('keydown', onGlobalKey);

  document.getElementById('helpCloseBtn')?.addEventListener('click', hideHelp);
  document.getElementById('helpOverlay')?.addEventListener('click', e => {
    if (e.target.id === 'helpOverlay') hideHelp();
  });
}

export function setDocTitle(name) {
  if (typeof document === 'undefined') return;
  document.title = name ? (stripExt(name) + ' — Rhythm Shooter') : BASE_TITLE;
}

export function setPlayCursorMode(on) {
  if (!document.body) return;
  if (on) document.body.classList.add('hide-cursor');
  else document.body.classList.remove('hide-cursor');
}

function bumpCursor() {
  if (!document.body) return;
  document.body.classList.remove('hide-cursor');
  clearTimeout(bumpCursor._t);
  if (state.gameRunning && !state.paused) {
    bumpCursor._t = setTimeout(() => document.body.classList.add('hide-cursor'), 1600);
  }
}

function onGlobalKey(e) {
  if (e.repeat) return;
  const tag = (e.target && e.target.tagName) || '';
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

  if ((e.key === '?' || e.code === 'F1') && !typing && !state.gameRunning) {
    if (isHelpOpen()) hideHelp();
    else if (isMenuTop()) {
      e.preventDefault();
      showHelp();
    }
    return;
  }

  if (isHelpOpen() && (e.code === 'Enter' || e.code === 'Space')) {
    e.preventDefault();
    hideHelp();
    return;
  }

  if (e.code === 'Enter' && !typing && isMenuTop()) {
    const btn = document.getElementById('playBtn');
    if (btn && !btn.disabled) {
      e.preventDefault();
      btn.click();
    }
  }
}

function isHelpOpen() {
  return document.getElementById('helpOverlay')?.classList.contains('active');
}

function isMenuTop() {
  const menu = document.getElementById('menu');
  if (!menu || menu.style.display === 'none') return false;
  if (isHelpOpen()) return false;
  if (document.getElementById('previewOverlay')?.classList.contains('active')) return false;
  for (const id of ['settingsScreen', 'statsScreen', 'calibrationScreen', 'result', 'pauseScreen']) {
    const el = document.getElementById(id);
    if (el && el.style.display === 'flex') return false;
  }
  return true;
}

function showHelp() {
  const el = document.getElementById('helpOverlay');
  if (!el) return;
  const body = document.getElementById('helpBody');
  if (body) body.textContent = t('menu.shortcutsBody');
  const title = el.querySelector('[data-i18n="menu.shortcutsTitle"]');
  if (title) title.textContent = t('menu.shortcutsTitle');
  el.classList.add('active');
}

function hideHelp() {
  document.getElementById('helpOverlay')?.classList.remove('active');
}

function stripExt(name) {
  const s = String(name);
  const dot = s.lastIndexOf('.');
  return dot > 0 ? s.slice(0, dot) : s;
}
