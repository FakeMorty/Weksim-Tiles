// Tap / hold judgement logic + bullet spawn.
// Etap 5: 6-tier judgement, per-user offset compensation, judge strictness modes.

import { state } from '../game/state.js';
import { JUDGE, SCORE, JUDGE_COLORS, LANES } from '../config.js';
import { calibration, judgeMultiplier } from './calibration.js';
import { laneMetrics, hitY } from '../utils/canvas.js';
import { spawnHitParticles, spawnMissParticles, spawnShockwave } from '../fx/particles.js';
import { showJudge, showCombo, showHoldToast } from '../fx/toasts.js';
import { updateHUD } from '../ui/hud.js';
import { shake, zoomPulse, tiltPulse } from '../render/camera.js';
import { flashLane, flashHitLine, flashScreen, bumpAberration } from '../fx/flash.js';

let laneKeysEls = null;
let holdBars = null;

// Per-song hit-offset histogram (ms), for post-game stats.
// Positive value = tapped late relative to true onset.
export const hitOffsets = [];

export function bindLaneEls() {
  laneKeysEls = [0, 1, 2, 3].map(i => document.getElementById('lk' + i));
  holdBars = laneKeysEls.map(el => el.querySelector('.holdbar i'));
}

export function getHoldBars() { return holdBars; }

// Raw audio-clock elapsed since song start.
export function songTime() {
  if (!state.gameRunning) return 0;
  return Math.max(0, state.audioCtx.currentTime - state.startTime);
}

// Time used for JUDGING taps. Adds user audio offset so that a physically
// on-time tap (with sub-user hardware latency) scores as PERFECT.
// audioOffset in ms; positive = user hears audio late → subtract from t so
// "when the user tapped" aligns with "when the beat truly is".
export function judgeTime() {
  return songTime() - calibration.audioOffset / 1000;
}

// Time used for RENDERING notes. visualOffset is independent (some monitors
// have their own display lag). Positive value = notes look late → we render
// them slightly earlier to compensate.
export function renderTime() {
  return songTime() + calibration.visualOffset / 1000;
}

export function fireBullet(lane, isAuto) {
  state.bullets.push({
    lane,
    y: hitY() - 6,
    vy: -window.innerHeight * (isAuto ? 1.9 : 1.65),
    life: 0.5,
    hold: state.keysDown[lane] && state.activeHold[lane],
  });
  state.flashes[lane] = Math.max(state.flashes[lane], 0.9);
}

// Classify a tap by |t_note - t_tap|. Returns tier name + score + colour.
function classifyTap(absDiff, mult) {
  if (absDiff <= JUDGE.MARVELOUS * mult) return { tier: 'MARVELOUS', add: SCORE.MARVELOUS, color: JUDGE_COLORS.MARVELOUS };
  if (absDiff <= JUDGE.PERFECT   * mult) return { tier: 'PERFECT',   add: SCORE.PERFECT,   color: JUDGE_COLORS.PERFECT   };
  if (absDiff <= JUDGE.GREAT     * mult) return { tier: 'GREAT',     add: SCORE.GREAT,     color: JUDGE_COLORS.GREAT     };
  if (absDiff <= JUDGE.GOOD      * mult) return { tier: 'GOOD',      add: SCORE.GOOD,      color: JUDGE_COLORS.GOOD      };
  if (absDiff <= JUDGE.OK        * mult) return { tier: 'OK',        add: SCORE.OK,        color: JUDGE_COLORS.OK        };
  return null;
}

function classifyHoldStart(absDiff, mult) {
  if (absDiff <= JUDGE.HOLD_MARVELOUS * mult) return { tier: 'HOLD!',  add: SCORE.HOLD_START_MARVELOUS, color: JUDGE_COLORS.HOLD_PERF,  perfect: true };
  if (absDiff <= JUDGE.HOLD_PERFECT   * mult) return { tier: 'HOLD!',  add: SCORE.HOLD_START_PERFECT,   color: JUDGE_COLORS.HOLD_PERF,  perfect: true };
  if (absDiff <= JUDGE.HOLD_START     * mult) return { tier: 'HOLD',   add: SCORE.HOLD_START_GOOD,      color: JUDGE_COLORS.HOLD_START, perfect: false };
  return null;
}

export function pressDown(lane) {
  if (state.keysDown[lane]) return;
  state.keysDown[lane] = true;
  laneKeysEls[lane].classList.add('active');
  laneKeysEls[lane].classList.add('holding');
  fireBullet(lane, false);
  state.lastShotTime[lane] = songTime();
  state.flashes[lane] = 1;

  const t = judgeTime();
  const mult = judgeMultiplier();

  // hold start match
  let best = null, bestDiff = 999, bestSigned = 0;
  state.notes.forEach(n => {
    if (n.judged || n.lane !== lane || !n.isHold || n.holding) return;
    const signed = t - n.time;
    const diff = Math.abs(signed);
    if (diff < bestDiff) { bestDiff = diff; best = n; bestSigned = signed; }
  });
  const holdResult = best ? classifyHoldStart(bestDiff, mult) : null;
  if (holdResult) {
    best.holding = true;
    best.holdProgress = 0;
    state.activeHold[lane] = best;
    if (holdResult.perfect) state.perfects++; else state.goods++;
    state.combo++; if (state.combo > state.maxCombo) state.maxCombo = state.combo;
    state.score += holdResult.add + Math.min(SCORE.COMBO_BONUS_MAX_HOLD, state.combo * 5);
    hitOffsets.push(bestSigned * 1000);
    showJudge(holdResult.tier, holdResult.color);
    showCombo(state.combo);
    showHoldToast();
    spawnHitParticles(lane, true, holdResult.perfect ? 'PERFECT' : 'GOOD');
    // Game feel: subtle shake + lane flash on hold start
    shake(holdResult.perfect ? 3 : 1.5, 0.18);
    flashLane(lane, holdResult.color, 1);
    flashHitLine(holdResult.color, 0.6);
    if (holdResult.perfect) zoomPulse(1.018);
    updateHUD();
    return;
  }

  // tap match
  let tapBest = null, tapDiff = 999, tapSigned = 0;
  state.notes.forEach(n => {
    if (n.judged || n.lane !== lane || n.isHold) return;
    const signed = t - n.time;
    const diff = Math.abs(signed);
    if (diff < tapDiff) { tapDiff = diff; tapBest = n; tapSigned = signed; }
  });
  const tapResult = tapBest ? classifyTap(tapDiff, mult) : null;
  if (tapResult) {
    tapBest.judged = true;
    if (tapResult.tier === 'MARVELOUS' || tapResult.tier === 'PERFECT') state.perfects++;
    else state.goods++;
    state.combo++; if (state.combo > state.maxCombo) state.maxCombo = state.combo;
    state.score += tapResult.add + Math.min(SCORE.COMBO_BONUS_MAX_TAP, state.combo * 7);
    hitOffsets.push(tapSigned * 1000);
    showJudge(tapResult.tier, tapResult.color);
    showCombo(state.combo);
    spawnHitParticles(lane, false, tapResult.tier);
    // Game feel per tier
    flashLane(lane, tapResult.color, 1);
    if (tapResult.tier === 'MARVELOUS') {
      shake(6, 0.32);
      zoomPulse(1.035);
      tiltPulse((lane < 2 ? 1 : -1) * 0.008);
      flashHitLine(tapResult.color, 1);
      flashScreen(tapResult.color, 0.18);
      spawnShockwave(lane, tapResult.color);
      bumpAberration(0.45);
    } else if (tapResult.tier === 'PERFECT') {
      shake(3.5, 0.22);
      zoomPulse(1.022);
      flashHitLine(tapResult.color, 0.75);
      if (state.combo % 25 === 0 && state.combo > 0) bumpAberration(0.3);
    } else if (tapResult.tier === 'GREAT') {
      shake(2, 0.18);
      flashHitLine(tapResult.color, 0.45);
    } else if (tapResult.tier === 'GOOD') {
      shake(1.2, 0.14);
    } else {
      shake(0.6, 0.10);
    }
    updateHUD();
  } else {
    if (state.combo > 5) { state.combo = Math.max(0, state.combo - 1); updateHUD(); }
    showJudge('\u2014', '#6a8aa0', 0.6);
  }
}

export function pressUp(lane) {
  state.keysDown[lane] = false;
  laneKeysEls[lane].classList.remove('active');
  laneKeysEls[lane].classList.remove('holding');
  const hn = state.activeHold[lane];
  if (hn) {
    const t = judgeTime();
    const remain = hn.endTime - t;
    finishHold(lane, remain <= JUDGE.HOLD_END_TOL * judgeMultiplier());
  }
}

export function finishHold(lane, success) {
  const n = state.activeHold[lane];
  if (!n) return;
  state.activeHold[lane] = null;
  n.holding = false;
  n.judged = true;
  holdBars[lane].style.width = '0%';
  if (success) {
    state.holdsOk++;
    const bonus = SCORE.HOLD_COMPLETE_BASE + Math.floor((n.endTime - n.time) * SCORE.HOLD_COMPLETE_PER_SEC);
    state.score += bonus;
    state.combo++; if (state.combo > state.maxCombo) state.maxCombo = state.combo;
    showJudge('HOLD OK', JUDGE_COLORS.HOLD_OK);
    spawnHitParticles(lane, true, 'PERFECT');
    shake(2.5, 0.22);
    flashHitLine(JUDGE_COLORS.HOLD_OK, 0.65);
    flashLane(lane, JUDGE_COLORS.HOLD_OK, 1);
  } else {
    state.combo = 0; state.misses++;
    showJudge('BREAK', JUDGE_COLORS.BREAK);
    spawnMissParticles(lane);
    shake(5, 0.35);
    flashScreen(JUDGE_COLORS.BREAK, 0.15);
    flashHitLine(JUDGE_COLORS.BREAK, 0.8);
  }
  updateHUD();
}

export function resetHitStats() {
  hitOffsets.length = 0;
}
