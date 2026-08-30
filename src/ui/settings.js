// Settings screen: open/close, restore persisted gameplay prefs, keybinds.

import { settings, saveSettings } from '../game/settings.js';
import { state } from '../game/state.js';
import { t } from '../i18n/i18n.js';
import { bindLaneKey, applyKeyLabels, initKeyLabels, isForbiddenBind } from '../game/keys.js';

let listeningLane = -1;

export function bindSettings() {
  document.getElementById('openSettingsBtn')?.addEventListener('click', openSettings);
  document.getElementById('settingsCloseBtn')?.addEventListener('click', closeSettings);

  restoreGameplayForm();
  wireGameplayPersistence();
  wireKeybinds();
  initKeyLabels();
}

export function openSettings() {
  document.getElementById('settingsScreen').style.display = 'flex';
  document.getElementById('menu').style.display = 'none';
  applyKeyLabels();
}

export function closeSettings() {
  cancelListen();
  document.getElementById('settingsScreen').style.display = 'none';
  document.getElementById('menu').style.display = 'flex';
}

function restoreGameplayForm() {
  const setVal = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
  const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };

  if (settings.mode) {
    state.mode = settings.mode;
    document.querySelectorAll('.mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === settings.mode);
    });
  }
  setVal('difficultySelect', settings.difficulty);
  const diffVal = document.getElementById('difficultyVal');
  if (diffVal && settings.difficulty) {
    const key = 'menu.difficulty' + settings.difficulty.charAt(0).toUpperCase() + settings.difficulty.slice(1);
    diffVal.textContent = t(key).split(' —')[0];
  }
  setVal('sens', settings.sens);
  const sensVal = document.getElementById('sensVal');
  if (sensVal) sensVal.textContent = Number(settings.sens).toFixed(2) + '\u03c3';

  setVal('fallSpeed', settings.fallTime);
  state.fallTime = settings.fallTime;
  setChk('bpmAuto', settings.bpmAuto);
  const fallSpeedEl = document.getElementById('fallSpeed');
  if (fallSpeedEl) fallSpeedEl.disabled = !!settings.bpmAuto;
  const fallVal = document.getElementById('fallVal');
  if (fallVal) fallVal.textContent = settings.bpmAuto ? t('menu.fallSpeedAuto') : Number(settings.fallTime).toFixed(2) + 's';

  setVal('beatsLead', String(settings.beatsLead));
  setVal('holdAmt', settings.holdAmt);
  const holdVal = document.getElementById('holdVal');
  if (holdVal) {
    const v = settings.holdAmt|0;
    holdVal.textContent = v === 0 ? t('menu.holdOff') : v === 1 ? t('menu.holdAuto') : t('menu.holdLots');
  }
  setChk('holdEnable', settings.holdEnable);
  setChk('dualEnable', settings.dual);
  setChk('autoLane', settings.smartLane);
  setChk('noFailCheck', settings.noFail);
}

function wireGameplayPersistence() {
  const persistNum = (id, key, parse = parseFloat) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      settings[key] = parse(el.value);
      saveSettings();
    });
    el.addEventListener('change', () => {
      settings[key] = parse(el.value);
      saveSettings();
    });
  };
  const persistChk = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      settings[key] = el.checked;
      saveSettings();
    });
  };

  persistNum('sens', 'sens');
  persistNum('fallSpeed', 'fallTime');
  persistNum('holdAmt', 'holdAmt', v => parseInt(v, 10));
  persistChk('bpmAuto', 'bpmAuto');
  persistChk('holdEnable', 'holdEnable');
  persistChk('dualEnable', 'dual');
  persistChk('autoLane', 'smartLane');
  persistChk('noFailCheck', 'noFail');

  document.getElementById('beatsLead')?.addEventListener('change', e => {
    settings.beatsLead = parseFloat(e.target.value);
    saveSettings();
  });
  document.getElementById('difficultySelect')?.addEventListener('change', e => {
    settings.difficulty = e.target.value;
    saveSettings();
  });
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      settings.mode = btn.dataset.mode;
      saveSettings();
    });
  });
}

function wireKeybinds() {
  for (let i = 0; i < 4; i++) {
    const btn = document.getElementById('keybind' + i);
    if (!btn) continue;
    btn.addEventListener('click', e => {
      e.preventDefault();
      startListen(i);
    });
  }
  window.addEventListener('keydown', e => {
    if (listeningLane < 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') { cancelListen(); return; }
    if (isForbiddenBind(e.code)) return;
    bindLaneKey(listeningLane, e.code);
    cancelListen();
  }, true);
}

function startListen(lane) {
  cancelListen();
  listeningLane = lane;
  const btn = document.getElementById('keybind' + lane);
  if (btn) {
    btn.classList.add('listening');
    btn.textContent = t('menu.keybindListening');
  }
}

function cancelListen() {
  if (listeningLane < 0) return;
  const btn = document.getElementById('keybind' + listeningLane);
  if (btn) btn.classList.remove('listening');
  listeningLane = -1;
  applyKeyLabels();
}
