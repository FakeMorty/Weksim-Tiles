// Autopilot bot.
//
// The bot doesn't read the DOM or fake keyboard events — it directly
// schedules pressDown/pressUp at note.time / note.endTime relative to the
// song clock. Compensates for user calibration so it always gets PERFECT.
//
// Driven by requestAnimationFrame so it stays in lockstep with the game
// loop (setInterval(8) drifted under load / in background tabs).

import { pressDown, pressUp } from './judge.js';
import { calibration } from './calibration.js';
import { state } from './state.js';

let rafId = null;
let pendingDowns = [];   // [{ at, lane }]
let pendingUps = [];     // [{ at, lane }]
let ctxRef = null;

/**
 * Start the bot. Requires state.notes to be populated and audioCtx started.
 *
 * @param {object} gameState
 * @param {number} songStartAtCtx  audioCtx.currentTime when audio begins
 */
export function startBot(gameState, songStartAtCtx) {
  stopBot();
  ctxRef = gameState.audioCtx;
  pendingDowns = [];
  pendingUps = [];

  // judgeTime = songTime - audioOffset/1000. Press at
  // ctxTime = songStartAtCtx + note.time + audioOffset so judge-space
  // lands exactly on note.time.
  const calibShift = (calibration.audioOffset || 0) / 1000;

  for (const n of gameState.notes) {
    if (n.judged) continue;
    const at = songStartAtCtx + n.time + calibShift;
    pendingDowns.push({ at, lane: n.lane });
    if (n.isHold) {
      pendingUps.push({ at: songStartAtCtx + n.endTime + calibShift - 0.005, lane: n.lane });
    } else {
      pendingUps.push({ at: at + 0.04, lane: n.lane });
    }
  }
  pendingDowns.sort((a, b) => a.at - b.at);
  pendingUps.sort((a, b) => a.at - b.at);

  rafId = requestAnimationFrame(tick);
}

function tick() {
  rafId = requestAnimationFrame(tick);
  if (!ctxRef) return;
  if (state.paused) return;
  const now = ctxRef.currentTime;
  while (pendingDowns.length && pendingDowns[0].at <= now) {
    const { lane } = pendingDowns.shift();
    try { pressDown(lane); } catch { /* ignore */ }
  }
  while (pendingUps.length && pendingUps[0].at <= now) {
    const { lane } = pendingUps.shift();
    try { pressUp(lane); } catch { /* ignore */ }
  }
  if (pendingDowns.length === 0 && pendingUps.length === 0) {
    stopBot();
  }
}

export function stopBot() {
  if (rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  pendingDowns = [];
  pendingUps = [];
  ctxRef = null;
}

export function isBotActive() {
  return rafId != null;
}
