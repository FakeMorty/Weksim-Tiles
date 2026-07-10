// Full-screen and per-lane flash effects, driven by decay timers.

import { LANES } from '../config.js';

const state = {
  laneFlash:      new Array(LANES).fill(0), // 0..1, decays
  laneFlashColor: new Array(LANES).fill('#7dfffa'),
  hitLine: 0,           // 0..1, whole hit line flash
  hitLineColor: '#7dfffa',
  screen: 0,            // 0..1, brief full-screen tint (MISS/MARVELOUS)
  screenColor: '#ffffff',
  // Chromatic aberration intensity (0..1), grows on high combos
  aberration: 0,
};

export function flashLane(lane, color = '#7dfffa', intensity = 1) {
  state.laneFlash[lane] = Math.max(state.laneFlash[lane], intensity);
  state.laneFlashColor[lane] = color;
}

export function flashHitLine(color = '#7dfffa', intensity = 1) {
  state.hitLine = Math.max(state.hitLine, intensity);
  state.hitLineColor = color;
}

export function flashScreen(color = '#ffffff', intensity = 0.35) {
  state.screen = Math.max(state.screen, intensity);
  state.screenColor = color;
}

export function bumpAberration(amount = 0.35) {
  state.aberration = Math.min(1, state.aberration + amount);
}

export function updateFlashes(dt) {
  for (let i = 0; i < LANES; i++) {
    state.laneFlash[i] = Math.max(0, state.laneFlash[i] - dt * 4.5);
  }
  state.hitLine = Math.max(0, state.hitLine - dt * 3.8);
  state.screen  = Math.max(0, state.screen  - dt * 5.5);
  state.aberration = Math.max(0, state.aberration - dt * 0.6);
}

export function getFlashState() { return state; }

export function resetFlashes() {
  for (let i = 0; i < LANES; i++) state.laneFlash[i] = 0;
  state.hitLine = 0; state.screen = 0; state.aberration = 0;
}
