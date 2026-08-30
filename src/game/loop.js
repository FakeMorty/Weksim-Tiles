// Game start/stop + main RAF loop.

import { state, resetPlayState } from './state.js';
import { render } from '../render/renderer.js';
import { fireBullet, finishHold, songTime, judgeTime, renderTime, getHoldBars, resetHitStats } from './judge.js';
import { spawnTickParticle, spawnMissParticles, resetParticles } from '../fx/particles.js';
import { showJudge } from '../fx/toasts.js';
import { updateHUD, updateSongProgress, setSongProgressVisible } from '../ui/hud.js';
import { LANES, JUDGE, JUDGE_COLORS, HEALTH } from '../config.js';
import { judgeMultiplier } from './calibration.js';
import { recordPlay } from './stats.js';
import { resetCamera, shake } from '../render/camera.js';
import { resetFlashes, flashScreen } from '../fx/flash.js';
import { settings } from './settings.js';
import { resetPerf, summarisePerf } from '../utils/perf.js';
import { attachAnalyser, detachAnalyser } from '../fx/musicReactive.js';
import { t } from '../i18n/i18n.js';
import { scheduleCountIn } from './warmup.js';
import { bindHitSoundOutput, stopAllHoldSounds } from './hitsound.js';
import { startReplayRecording, stopReplayRecording } from './replay.js';
import { startBot, stopBot } from './bot.js';
import { applyHealth, setFailHandler } from './health.js';
import { computeAccuracy, judgedCount } from './accuracy.js';
import { showResults } from '../ui/results.js';
import { resetErrorBar, setErrorBarVisible } from '../ui/errorBar.js';
import { setDocTitle, setPlayCursorMode } from '../ui/chrome.js';

let lastFrame = performance.now();

export function startPlay() {
  // Always kill any lingering source before starting a new one — protects
  // against the "old track keeps playing over new one" bug when the user
  // spam-clicks Play or exits mid-song and comes back.
  if (state.sourceNode) {
    try { state.sourceNode.onended = null; } catch {}
    try { state.sourceNode.disconnect(); } catch {}
    try { state.sourceNode.stop(); } catch {}
    state.sourceNode = null;
  }
  resetPlayState();
  resetHitStats();
  resetParticles();
  resetCamera();
  resetFlashes();
  resetPerf();
  state.gameRunning = true;
  state.paused = false;

  document.getElementById('menu').style.display = 'none';
  document.getElementById('result').style.display = 'none';
  document.getElementById('pauseScreen').style.display = 'none';
  document.getElementById('previewOverlay')?.classList.remove('active');
  const settingsEl = document.getElementById('settingsScreen');
  if (settingsEl) settingsEl.style.display = 'none';
  document.getElementById('hud').style.display = 'flex';
  document.getElementById('bottomBar').style.display = 'flex';
  setSongProgressVisible(true);
  setErrorBarVisible(true);
  resetErrorBar();
  setPlayCursorMode(true);
  setDocTitle(state.fileName);
  const hudTrack = document.getElementById('hudTrack');
  if (hudTrack) hudTrack.textContent = state.fileName || '—';
  const modeKey = 'menu.mode' + state.mode.charAt(0).toUpperCase() + state.mode.slice(1);
  document.getElementById('modeEl').textContent = t(modeKey);
  document.getElementById('bpmEl').textContent = state.currentBpm ? t('hud.bpmValue', { bpm: Math.round(state.currentBpm) }) : '--';
  const bpmBadge = document.getElementById('bpmBadge');
  bpmBadge.textContent = (state.currentBpm ? t('hud.bpmValue', { bpm: Math.round(state.currentBpm) }) + ' \u2022 ' : '') + state.fallTime.toFixed(2) + 's';
  bpmBadge.style.display = 'block';
  updateHUD();

  if (state.audioCtx.state === 'suspended') state.audioCtx.resume();

  // Gain node so we can control master volume live
  if (!state.gainNode) {
    state.gainNode = state.audioCtx.createGain();
    state.gainNode.connect(state.audioCtx.destination);
  }
  state.gainNode.gain.value = settings.volume;

  // Etap E (v1.24): route hit sounds through the same gainNode so master
  // volume affects them too.
  bindHitSoundOutput(state.audioCtx, state.gainNode);

  state.sourceNode = state.audioCtx.createBufferSource();
  state.sourceNode.buffer = state.audioBuffer;
  state.sourceNode.connect(state.gainNode);
  // Etap 9: live spectrum tap for reactive visuals
  attachAnalyser(state.audioCtx, state.gainNode);

  // Etap E (v1.24): warmup / count-in
  let firstTickAt = state.audioCtx.currentTime + 0.18;
  let startAt = firstTickAt;
  if (settings.warmup && state.currentBpm > 40 && !state.replayPlayback) {
    const beats = settings.warmupBeats || 4;
    startAt = scheduleCountIn(state.audioCtx, state.gainNode, state.currentBpm, firstTickAt, 0.35, beats);
  }
  state.sourceNode.start(startAt);
  state.startTime = startAt;

  // Etap E (v1.24): start replay recorder (records all judgements + inputs)
  startReplayRecording(state);
  // If bot mode requested, launch the autopilot after the count-in
  if (state.botMode && !state.replayPlayback) {
    startBot(state, startAt);
  }
  // Capture reference so onended only fires endGame for THIS source, not
  // any stale one that was still winding down.
  const thisSource = state.sourceNode;
  state.sourceNode.onended = () => {
    if (state.sourceNode === thisSource && state.gameRunning && !state.paused) endGame();
  };

  lastFrame = performance.now();
  requestAnimationFrame(loop);
}

// Pause / resume are best-effort. Web Audio does not support "pause" on a
// BufferSourceNode — we suspend the whole context, which halts currentTime.
export async function pauseGame() {
  if (!state.gameRunning || state.paused) return;
  state.paused = true;
  try { await state.audioCtx.suspend(); } catch {}
  document.getElementById('pauseScreen').style.display = 'flex';
  // Etap E: show bot hit-sound switcher only when bot is playing this run
  const botRow = document.getElementById('pauseBotHitRow');
  if (botRow) botRow.style.display = state.botMode ? 'flex' : 'none';
  setPlayCursorMode(false);
}

export async function resumeGame() {
  if (!state.gameRunning || !state.paused) return;
  try { await state.audioCtx.resume(); } catch {}
  state.paused = false;
  document.getElementById('pauseScreen').style.display = 'none';
  setPlayCursorMode(true);
  // If the player released a HOLD during pause, break it now that time unfreezes.
  for (let i = 0; i < LANES; i++) {
    if (state.activeHold[i] && !state.keysDown[i]) finishHold(i, false);
  }
  lastFrame = performance.now();
  requestAnimationFrame(loop);
}

// Fully stop the current playback. Safe to call from any state.
async function stopAudio() {
  stopBot();
  stopReplayRecording();
  stopAllHoldSounds();
  detachAnalyser();
  if (state.sourceNode) {
    try { state.sourceNode.onended = null; } catch {}
    try { state.sourceNode.disconnect(); } catch {}
    try { state.sourceNode.stop(); } catch {}
    state.sourceNode = null;
  }
  // If we were paused, the ctx is suspended — resume so future starts work
  if (state.audioCtx && state.audioCtx.state === 'suspended') {
    try { await state.audioCtx.resume(); } catch {}
  }
}

export async function restartCurrent() {
  if (!state.audioBuffer) return;
  await stopAudio();
  state.paused = false;
  // Un-judge all notes so they replay
  for (const n of state.notes) {
    n.judged = false;
    n.holding = false;
    n.holdProgress = 0;
  }
  state._notesCursor = 0;
  state._missCursor = 0;
  startPlay();
}

export async function exitToMenu() {
  await stopAudio();
  state.gameRunning = false;
  state.paused = false;
  document.getElementById('hud').style.display = 'none';
  document.getElementById('bottomBar').style.display = 'none';
  document.getElementById('bpmBadge').style.display = 'none';
  document.getElementById('pauseScreen').style.display = 'none';
  document.getElementById('result').style.display = 'none';
  setSongProgressVisible(false);
  setErrorBarVisible(false);
  setPlayCursorMode(false);
  setDocTitle(null);
  document.getElementById('menu').style.display = 'flex';
}

export function setVolume(v) {
  settings.volume = Math.max(0, Math.min(1, v));
  if (state.gainNode) state.gainNode.gain.value = settings.volume;
}

export function endGame() {
  if (!state.gameRunning) return; // don't fire twice
  state.gameRunning = false;
  state.paused = false;
  stopBot();
  stopAllHoldSounds();
  const replayJson = stopReplayRecording();
  if (replayJson) state.lastReplay = replayJson;
  detachAnalyser();
  if (state.sourceNode) {
    try { state.sourceNode.onended = null; } catch {}
    try { state.sourceNode.disconnect(); } catch {}
    try { state.sourceNode.stop(); } catch {}
    state.sourceNode = null;
  }
  document.getElementById('hud').style.display = 'none';
  document.getElementById('bottomBar').style.display = 'none';
  document.getElementById('bpmBadge').style.display = 'none';
  document.getElementById('pauseScreen').style.display = 'none';
  setSongProgressVisible(false);
  setPlayCursorMode(false);
  const totalJudged = judgedCount(state);
  const acc = computeAccuracy(state);
  const fpsSummary = summarisePerf();
  if (totalJudged > 0) {
    recordPlay({
      songHash: state.fileHash,
      fileName: state.fileName,
      mode: state.mode,
      difficulty: state.currentDifficulty || 'normal',
      bpm: state.currentBpm,
      score: state.score,
      accuracy: acc,
      maxCombo: state.maxCombo,
      marvelous: state.marvelous,
      perfects: state.perfects,
      greats: state.greats,
      goods: state.goods,
      oks: state.oks,
      misses: state.misses,
      failed: !!state.failed,
      holdsOk: state.holdsOk,
      holdsTotal: state.holdsTotal,
      notes: state.notes.length,
      durationSec: state.audioBuffer?.duration || 0,
      fpsAvg: fpsSummary.avg,
    });
  }
  showResults({ acc, fpsSummary });
}


function loop(now) {
  if (!state.gameRunning) return;
  if (state.paused) {
    // Keep RAF idle so we can render the frozen frame beneath the pause UI.
    render(renderTime(), 0);
    lastFrame = now;
    requestAnimationFrame(loop);
    return;
  }
  // Cap dt at ~33ms so that a hitched frame doesn't teleport bullets / particles.
  const dt = Math.min(0.033, (now - lastFrame) / 1000); lastFrame = now;
  const tJudge = judgeTime();    // for hit-timing checks
  const tRender = renderTime();  // for note positions
  const holdBars = getHoldBars();

  for (let lane = 0; lane < LANES; lane++) {
    if (state.keysDown[lane]) {
      state.beams[lane] = Math.min(1, state.beams[lane] + dt * 8);
      if (songTime() - state.lastShotTime[lane] > 0.075) {
        fireBullet(lane, true);
        state.lastShotTime[lane] = songTime();
      }
      const hn = state.activeHold[lane];
      if (hn) {
        const dur = Math.max(0.01, hn.endTime - hn.time);
        const prog = Math.max(0, Math.min(1, (tJudge - hn.time) / dur));
        const prevProg = Math.max(0, prog - dt / dur);
        hn.holdProgress = prog;
        if (holdBars?.[lane]) holdBars[lane].style.width = (prog * 100).toFixed(1) + '%';
        if (Math.floor(prog * 40) !== Math.floor(prevProg * 40)) {
          state.score += 4;
          if (Math.random() < 0.35) spawnTickParticle(lane);
        }
        if (tJudge >= hn.endTime - 0.035) {
          finishHold(lane, true);
        }
      }
    } else {
      state.beams[lane] = Math.max(0, state.beams[lane] - dt * 6);
      if (holdBars?.[lane]) holdBars[lane].style.width = '0%';
    }
  }

  render(tRender, dt);
  updateSongProgress(songTime(), state.audioBuffer?.duration || 1);

  // v1.24.5: cursor-based miss scan instead of iterating all notes every frame.
  // Notes are sorted by time; once a note is past miss window we can advance.
  // Old code = O(N) per frame → 60 000 ops/sec on 1000-note track.
  const missWindow = JUDGE.MISS * judgeMultiplier();
  const notes = state.notes;
  const missCursor = state._missCursor || 0;
  let newCursor = missCursor;
  for (let i = missCursor; i < notes.length; i++) {
    const n = notes[i];
    // If this note is still in the future beyond miss window, stop scanning.
    if (n.time > tJudge - missWindow && (!n.isHold || n.endTime > tJudge + JUDGE.HOLD_LATE_FORCE)) {
      break;
    }
    if (n.judged) {
      if (i === newCursor) newCursor++;
      continue;
    }
    if (!n.isHold) {
      if (tJudge - n.time > missWindow) {
        n.judged = true; state.combo = 0; state.misses++;
        applyHealth(HEALTH.MISS);
        showJudge(t('judge.miss'), JUDGE_COLORS.MISS);
        spawnMissParticles(n.lane);
        shake(2.5, 0.2);
        flashScreen(JUDGE_COLORS.MISS, 0.10);
        updateHUD();
      }
    } else {
      if (!n.holding && tJudge - n.time > missWindow) {
        n.judged = true; state.combo = 0; state.misses++;
        applyHealth(HEALTH.MISS);
        showJudge(t('judge.miss'), JUDGE_COLORS.MISS);
        spawnMissParticles(n.lane);
        shake(2.5, 0.2);
        flashScreen(JUDGE_COLORS.MISS, 0.10);
        updateHUD();
      }
      if (n.holding && tJudge > n.endTime + JUDGE.HOLD_LATE_FORCE) {
        const lane = n.lane;
        if (state.activeHold[lane] === n) finishHold(lane, true);
      }
    }
    if (i === newCursor) newCursor++;
    if (state.failed) break;
  }
  state._missCursor = newCursor;

  if (state.failed) {
    endGame();
    return;
  }

  if (state.audioBuffer && songTime() > state.audioBuffer.duration + 0.85) {
    endGame();
    return;
  }
  requestAnimationFrame(loop);
}

export function idleRender() {
  if (!state.gameRunning) render(0, 0.016);
  requestAnimationFrame(idleRender);
}

setFailHandler(() => {
  // Defer so the tap/miss that drained HP still records combo/HUD first.
  queueMicrotask(() => {
    if (state.gameRunning && state.failed) endGame();
  });
});
