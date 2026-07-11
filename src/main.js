// Entry point: wire up modules to the existing DOM.

import { initCanvas, refreshDPR } from './utils/canvas.js';
import { bindMenu } from './ui/menu.js';
import { bindLaneEls } from './game/judge.js';
import { bindInput } from './game/input.js';
import { idleRender } from './game/loop.js';
import { loadCalibration } from './game/calibration.js';
import { loadSettings } from './game/settings.js';
import { bindCalibration } from './ui/calibration.js';
import { bindPause } from './ui/pause.js';
import { bindStats } from './ui/stats.js';
import { bindLanguagePicker } from './ui/language.js';
import { loadLocale, applyTranslations, setLocale, getLocale, getLocaleDir } from './i18n/i18n.js';
import { APP_VERSION } from './config.js';

// i18n has to load BEFORE bindMenu — otherwise the menu would render in
// English and then flash to the user's language on first re-translate.
loadLocale();
document.documentElement.lang = getLocale();
document.documentElement.dir = getLocaleDir();
applyTranslations();

loadCalibration();
loadSettings();
initCanvas(document.getElementById('game'));
refreshDPR();
bindLaneEls();
bindMenu();
bindInput();
bindCalibration();
bindPause();
bindStats();
bindLanguagePicker();
idleRender();
console.log('%cWeksim-Tiles v' + APP_VERSION + ' (' + getLocale() + ')', 'color:#7efaff;font-weight:bold');
