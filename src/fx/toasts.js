// Judgement text, combo counter, HOLD toast — DOM overlays.

import { t } from '../i18n/i18n.js';

let judgeTimer = null;
let holdToastTimer = null;

export function showJudge(text, color, scale = 1) {
  const el = document.getElementById('judgeText');
  if (!el) return;
  el.textContent = text;
  el.style.color = color;
  el.style.opacity = '1';
  el.style.transform = `translate(-50%,-50%) scale(${scale})`;
  clearTimeout(judgeTimer);
  judgeTimer = setTimeout(() => { el.style.opacity = '0'; }, 260);
}

let timingTimer = null;
export function showTiming(signedSec) {
  const el = document.getElementById('timingText');
  if (!el) return;
  if (signedSec == null || Math.abs(signedSec) < 0.004) {
    el.style.opacity = '0';
    return;
  }
  const early = signedSec < 0;
  const ms = Math.abs(signedSec * 1000).toFixed(0);
  el.textContent = (early ? t('judge.early') : t('judge.late')) + ' ' + ms;
  el.style.color = early ? '#7dfffa' : '#ffb066';
  el.style.opacity = '1';
  clearTimeout(timingTimer);
  timingTimer = setTimeout(() => { el.style.opacity = '0'; }, 420);
}

export function showHoldToast() {
  const el = document.getElementById('holdToast');
  if (!el) return;
  el.style.opacity = '1';
  clearTimeout(holdToastTimer);
  holdToastTimer = setTimeout(() => el.style.opacity = '0', 320);
}

export function showCombo(c) {
  const el = document.getElementById('comboText');
  if (!el) return;
  if (c < 3) { el.style.opacity = '0'; return; }
  el.textContent = t('judge.combo', { n: c });
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => el.style.opacity = '0', 460);
}
