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
import { APP_VERSION } from './config.js';

loadCalibration();
loadSettings();
initCanvas(document.getElementById('game'));
refreshDPR();       // apply DPR override based on loaded FX quality
bindLaneEls();
bindMenu();
bindInput();
bindCalibration();
bindPause();
idleRender();
console.log('%cWeksim-Tiles v' + APP_VERSION, 'color:#7efaff;font-weight:bold');
