// Entry point: wire up modules to the existing DOM.

import { initCanvas } from './utils/canvas.js';
import { bindMenu } from './ui/menu.js';
import { bindLaneEls } from './game/judge.js';
import { bindInput } from './game/input.js';
import { idleRender } from './game/loop.js';
import { loadCalibration } from './game/calibration.js';
import { loadSettings } from './game/settings.js';
import { bindCalibration } from './ui/calibration.js';
import { bindPause } from './ui/pause.js';

loadCalibration();
loadSettings();
initCanvas(document.getElementById('game'));
bindLaneEls();
bindMenu();
bindInput();
bindCalibration();
bindPause();
idleRender();
