// Game start/stop + main RAF loop.

import { state, resetPlayState } from './state.js';
import { render } from '../render/renderer.js';
import { fireBullet, finishHold, songTime, judgeTime, renderTime, getHoldBars, resetHitStats } from './judge.js';
import { spawnTickParticle, spawnMissParticles, resetParticles } from '../fx/particles.js';
import { showJudge } from '../fx/toasts.js';
import { updateHUD } from '../ui/hud.js';
import { LANES, JUDGE, JUDGE_COLORS } from '../config.js';
import { judgeMultiplier } from './calibration.js';
import { drawHitChart } from '../ui/hitChart.js';
import { recordPlay, bestScoreFor } from './stats.js';
import { resetCamera, shake } from '../render/camera.js';
import { resetFlashes, flashScreen } from '../fx/flash.js';
import { settings } from './settings.js';
import { resetPerf, summarisePerf } from '../utils/perf.js';
import { attachAnalyser, detachAnalyser } from '../fx/musicReactive.js';
import { t, getLocale } from '../i18n/i18n.js';
import { scheduleCountIn } from './warmup.js';
import { bindHitSoundOutput, stopAllHoldSounds } from './hitsound.js';
import { startReplayRecording, stopReplayRecording } from './replay.js';
import { startBot, stopBot } from './bot.js';

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
  state.pauseOffset = 0;

  document.getElementById('menu').style.display = 'none';
  document.getElementById('result').style.display = 'none';
  document.getElementById('pauseScreen').style.display = 'none';
  document.getElementById('hud').style.display = 'flex';
  document.getElementById('bottomBar').style.display = 'flex';
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
  state.pauseStart = state.audioCtx.currentTime;
  try { await state.audioCtx.suspend(); } catch {}
  document.getElementById('pauseScreen').style.display = 'flex';
  // Etap E: show bot hit-sound switcher only when bot is playing this run
  const botRow = document.getElementById('pauseBotHitRow');
  if (botRow) botRow.style.display = state.botMode ? 'flex' : 'none';
}

export async function resumeGame() {
  if (!state.gameRunning || !state.paused) return;
  try { await state.audioCtx.resume(); } catch {}
  state.pauseOffset += state.audioCtx.currentTime - state.pauseStart;
  state.paused = false;
  document.getElementById('pauseScreen').style.display = 'none';
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
  // Stop audio so onended can't fire again for a stale source
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
  const totalJudged = state.perfects + state.goods + state.misses;
  const acc = totalJudged ? Math.round((state.perfects * 1 + state.goods * 0.58) / totalJudged * 100) : 100;
  const nfLocale = getLocale() === 'ru' ? 'ru-RU' : getLocale();
  document.getElementById('finalScore').textContent = state.score.toLocaleString(nfLocale);
  document.getElementById('finalScore2').textContent = state.score.toLocaleString(nfLocale);
  document.getElementById('finalAcc').textContent = acc + '%';
  document.getElementById('finalCombo').textContent = state.maxCombo;
  document.getElementById('finalPerfect').textContent = state.perfects;
  document.getElementById('finalGood').textContent = state.goods;
  document.getElementById('finalHolds').textContent = state.holdsOk + ' / ' + state.holdsTotal;
  document.getElementById('finalMiss').textContent = state.misses;
  document.getElementById('finalBpm').textContent = state.currentBpm ? Math.round(state.currentBpm) : '--';
  document.getElementById('finalSpeed').textContent = state.fallTime.toFixed(2) + 's';
  const fpsSummary = summarisePerf();
  const fpsEl = document.getElementById('finalFps');
  if (fpsEl) {
    fpsEl.textContent = fpsSummary.avg + ' / ' + fpsSummary.p1 + ' / ' + fpsSummary.min;
    fpsEl.title = 'average / 1% low / minimum FPS during play';
    // Colour code
    fpsEl.style.color = fpsSummary.avg >= 55 ? '#7dfffa'
                     : fpsSummary.avg >= 40 ? '#ffd86a'
                     : '#ff6a7a';
  }
  // Etap 10: record play into localStorage stats. Only if there was actual
  // play activity (avoid recording an accidental exit-immediately click).
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
      perfects: state.perfects,
      goods: state.goods,
      misses: state.misses,
      holdsOk: state.holdsOk,
      holdsTotal: state.holdsTotal,
      notes: state.notes.length,
      durationSec: state.audioBuffer?.duration || 0,
      fpsAvg: fpsSummary.avg,
    });
  }

  // Etap 10: show previous best score for this song+difficulty, if any
  const bestEl = document.getElementById('finalBest');
  if (bestEl) {
    const best = state.fileHash && bestScoreFor(state.fileHash, state.currentDifficulty || 'normal');
    if (best && best.date !== Date.now()) {
      const isNew = state.score >= best.score;
      bestEl.innerHTML = isNew
        ? '<span style="color:#fff4a3">' + t('results.newBest') + '</span>'
        : best.score.toLocaleString(nfLocale) + ' <small style="color:#5a89a6">(' + best.accuracy + '%)</small>';
    } else {
      bestEl.textContent = '\u2014';
    }
  }

  document.getElementById('result').style.display = 'flex';
  // Etap 5: draw hit-offset histogram
  setTimeout(() => drawHitChart(document.getElementById('hitChart')), 30);
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
        holdBars[lane].style.width = (prog * 100).toFixed(1) + '%';
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
      holdBars[lane].style.width = '0%';
    }
  }

  render(tRender, dt);

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
        showJudge(t('judge.miss'), JUDGE_COLORS.MISS);
        spawnMissParticles(n.lane);
        shake(2.5, 0.2);
        flashScreen(JUDGE_COLORS.MISS, 0.10);
        updateHUD();
      }
    } else {
      if (!n.holding && tJudge - n.time > missWindow) {
        n.judged = true; state.combo = 0; state.misses++;
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
  }
  state._missCursor = newCursor;

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
