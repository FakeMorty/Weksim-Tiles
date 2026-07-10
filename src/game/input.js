// Keyboard + pointer input. Delegates to judge.js.

import { KEY_MAP, LANES } from '../config.js';
import { state } from './state.js';
import { pressDown, pressUp } from './judge.js';
import { view, laneMetrics } from '../utils/canvas.js';
import { endGame } from './loop.js';

export function bindInput() {
  window.addEventListener('keydown', e => {
    if (!state.gameRunning) return;
    if (e.code === 'Escape') { endGame(); return; }
    const lane = KEY_MAP[e.code];
    if (lane === undefined) return;
    e.preventDefault();
    if (e.repeat) return;
    pressDown(lane);
  });
  window.addEventListener('keyup', e => {
    const lane = KEY_MAP[e.code];
    if (lane === undefined) return;
    e.preventDefault();
    pressUp(lane);
  });

  const canvas = view.canvas;
  const pointerMap = new Map();
  canvas.addEventListener('pointerdown', e => {
    const lane = getLaneFromX(e.clientX);
    if (lane == null) return;
    canvas.setPointerCapture(e.pointerId);
    pointerMap.set(e.pointerId, lane);
    if (state.gameRunning) pressDown(lane);
    e.preventDefault();
  });
  canvas.addEventListener('pointerup', e => {
    const lane = pointerMap.get(e.pointerId);
    pointerMap.delete(e.pointerId);
    if (lane != null && state.gameRunning) pressUp(lane);
  });
  canvas.addEventListener('pointercancel', e => {
    const lane = pointerMap.get(e.pointerId);
    pointerMap.delete(e.pointerId);
    if (lane != null && state.gameRunning) pressUp(lane);
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
}

function getLaneFromX(clientX) {
  const rect = view.canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const { left, lw } = laneMetrics();
  const lane = Math.floor((x - left) / lw);
  return (lane >= 0 && lane < LANES) ? lane : null;
}
