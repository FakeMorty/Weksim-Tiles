// Keyboard + pointer input. Delegates to judge.js.

import { LANES } from '../config.js';
import { state } from './state.js';
import { pressDown, pressUp } from './judge.js';
import { view, laneMetrics } from '../utils/canvas.js';
import { pauseGame, resumeGame, restartCurrent } from './loop.js';
import { laneFromCode } from './keys.js';

export function bindInput() {
  window.addEventListener('keydown', e => {
    if (!state.gameRunning) return;
    if (e.code === 'Escape') {
      if (state.paused) resumeGame(); else pauseGame();
      e.preventDefault();
      return;
    }
    if (state.paused) {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        resumeGame();
      } else if (e.code === 'KeyR') {
        e.preventDefault();
        restartCurrent();
      }
      return;
    }
    const lane = laneFromCode(e.code);
    if (lane === undefined) return;
    e.preventDefault();
    if (e.repeat) return;
    pressDown(lane);
  });
  window.addEventListener('keyup', e => {
    const lane = laneFromCode(e.code);
    if (lane === undefined) return;
    e.preventDefault();
    if (state.paused) {
      // Clear physical key state without judging — audio clock is frozen,
      // so finishing a HOLD here would score against paused time.
      state.keysDown[lane] = false;
      const el = document.getElementById('lk' + lane);
      if (el) {
        el.classList.remove('active');
        el.classList.remove('holding');
      }
      return;
    }
    pressUp(lane);
  });

  const canvas = view.canvas;
  const pointerMap = new Map();
  canvas.addEventListener('pointerdown', e => {
    if (state.paused) return;
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
    if (lane == null) return;
    if (state.paused) {
      state.keysDown[lane] = false;
      return;
    }
    if (state.gameRunning) pressUp(lane);
  });
  canvas.addEventListener('pointercancel', e => {
    const lane = pointerMap.get(e.pointerId);
    pointerMap.delete(e.pointerId);
    if (lane == null) return;
    if (state.paused) {
      state.keysDown[lane] = false;
      return;
    }
    if (state.gameRunning) pressUp(lane);
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
