// Customisable lane keys + fallback number keys.

import { settings, saveSettings } from './settings.js';
import { t, onLocaleChange } from '../i18n/i18n.js';

export const DEFAULT_LANE_KEYS = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];

const DIGIT_FALLBACK = {
  Digit1: 0, Numpad1: 0,
  Digit2: 1, Numpad2: 1,
  Digit3: 2, Numpad3: 2,
  Digit4: 3, Numpad4: 3,
};

const FORBIDDEN = new Set([
  'Escape', 'Tab', 'Enter', 'NumpadEnter',
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight',
  'CapsLock', 'ContextMenu', 'Backspace', 'Delete',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
]);

export function laneFromCode(code) {
  const keys = settings.laneKeys || DEFAULT_LANE_KEYS;
  const i = keys.indexOf(code);
  if (i >= 0) return i;
  if (code in DIGIT_FALLBACK) return DIGIT_FALLBACK[code];
  return undefined;
}

export function codeToLabel(code) {
  if (!code) return '?';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'N' + code.slice(6);
  const special = {
    Semicolon: ';', Quote: "'", Backquote: '`', Minus: '-', Equal: '=',
    Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
    BracketLeft: '[', BracketRight: ']', Space: 'Space',
  };
  return special[code] || code;
}

export function laneKeyLabels() {
  const keys = settings.laneKeys || DEFAULT_LANE_KEYS;
  return keys.map(codeToLabel);
}

export function isForbiddenBind(code) {
  return !code || FORBIDDEN.has(code) || code.startsWith('F') && /^F\d{1,2}$/.test(code);
}

/** Bind `code` to `lane`. If another lane already has it, swap. */
export function bindLaneKey(lane, code) {
  if (lane < 0 || lane > 3) return false;
  if (isForbiddenBind(code)) return false;
  if (code in DIGIT_FALLBACK) return false; // digits are global fallbacks
  const keys = [...(settings.laneKeys || DEFAULT_LANE_KEYS)];
  const other = keys.indexOf(code);
  if (other === lane) return true;
  if (other >= 0) keys[other] = keys[lane];
  keys[lane] = code;
  settings.laneKeys = keys;
  saveSettings();
  applyKeyLabels();
  return true;
}

export function applyKeyLabels() {
  const labels = laneKeyLabels();
  for (let i = 0; i < 4; i++) {
    const el = document.getElementById('lk' + i);
    if (!el) continue;
    // Keep the holdbar child
    const hold = el.querySelector('.holdbar');
    el.textContent = labels[i];
    if (hold) el.appendChild(hold);
    const btn = document.getElementById('keybind' + i);
    if (btn && !btn.classList.contains('listening')) btn.textContent = labels[i];
  }
  const keys = labels.join(' ');
  const tag = document.getElementById('tagTapHold');
  if (tag) tag.textContent = t('menu.tagTapHold', { keys });
  const hint = document.getElementById('controlsHint');
  if (hint) hint.textContent = t('menu.controlsHint', { keys });
}

let labelled = false;
export function initKeyLabels() {
  if (labelled) return;
  labelled = true;
  applyKeyLabels();
  onLocaleChange(() => applyKeyLabels());
}
