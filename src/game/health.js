// HP / fail state. Isolated so judge.js doesn't import loop.js (cycle).

import { HEALTH } from '../config.js';
import { settings } from './settings.js';
import { state } from './state.js';

let failCb = null;
export function setFailHandler(fn) { failCb = fn; }

export function resetHealth() {
  state.health = HEALTH.START;
  state.failed = false;
}

export function isFailEnabled() {
  return !settings.noFail && !state.botMode;
}

export function applyHealth(delta) {
  if (!isFailEnabled() || state.failed) return;
  state.health = Math.max(0, Math.min(HEALTH.START, state.health + delta));
  if (state.health <= 0) {
    state.failed = true;
    try { failCb?.(); } catch { /* ignore */ }
  }
}

export function healthDeltaForTap(tier) {
  return HEALTH[tier] ?? 0;
}
