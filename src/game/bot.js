// Etap E (v1.24): Autopilot bot.
//
// The bot doesn't read the DOM or fake keyboard events — it directly
// schedules pressDown/pressUp at note.time / note.endTime relative to the
// song clock. Compensates for user calibration so it always gets PERFECT.
//
// The bot runs its own timer that ticks every ~10 ms and dispatches any
// notes whose scheduled time has arrived.

import { pressDown, pressUp } from './judge.js';
import { calibration } from './calibration.js';

let intervalId = null;
let pendingDowns = [];   // [{ at, lane }]
let pendingUps = [];     // [{ at, lane }]
let ctxRef = null;

/**
 * Start the bot. Requires state.notes to be populated and audioCtx started.
 *
 * @param {object} state
 * @param {number} songStartAtCtx  audioCtx.currentTime when audio begins
 */
export function startBot(state, songStartAtCtx) {
  stopBot();
  ctxRef = state.audioCtx;
  pendingDowns = [];
  pendingUps = [];

  // v1.24.4: judgeTime = songTime - audioOffset/1000. So a press at
  // ctxTime = songStartAtCtx + note.time lands at judgeTime = note.time -
  // audioOffset/1000, giving a systematic offset of -audioOffset. To land
  // exactly at note.time in judge-space, we ADD audioOffset to the press
  // time. Then bot hits PERFECT regardless of user calibration.
  const calibShift = (calibration.audioOffset || 0) / 1000;

  for (const n of state.notes) {
    if (n.judged) continue;
    const at = songStartAtCtx + n.time + calibShift;
    pendingDowns.push({ at, lane: n.lane });
    if (n.isHold) {
      // Release just before endTime (in judge-space) so we clear the hold window.
      pendingUps.push({ at: songStartAtCtx + n.endTime + calibShift - 0.005, lane: n.lane });
    } else {
      // Ghost release ~40ms after tap to free the key
      pendingUps.push({ at: at + 0.04, lane: n.lane });
    }
  }
  pendingDowns.sort((a, b) => a.at - b.at);
  pendingUps.sort((a, b) => a.at - b.at);

  intervalId = setInterval(tick, 8);
}

function tick() {
  if (!ctxRef) return stopBot();
  const now = ctxRef.currentTime;
  while (pendingDowns.length && pendingDowns[0].at <= now) {
    const { lane } = pendingDowns.shift();
    try { pressDown(lane); } catch (e) { /* ignore */ }
  }
  while (pendingUps.length && pendingUps[0].at <= now) {
    const { lane } = pendingUps.shift();
    try { pressUp(lane); } catch (e) { /* ignore */ }
  }
  if (pendingDowns.length === 0 && pendingUps.length === 0) {
    stopBot();
  }
}

export function stopBot() {
  if (intervalId != null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  pendingDowns = [];
  pendingUps = [];
  ctxRef = null;
}

export function isBotActive() {
  return intervalId != null;
}
