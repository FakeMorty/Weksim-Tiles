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
import { resetCamera, shake } from '../render/camera.js';
import { resetFlashes, flashScreen } from '../fx/flash.js';
import { settings } from './settings.js';

let lastFrame = performance.now();

export function startPlay() {
  resetPlayState();
  resetHitStats();
  resetParticles();
  resetCamera();
  resetFlashes();
  state.gameRunning = true;
  state.paused = false;
  state.pauseOffset = 0;

  document.getElementById('menu').style.display = 'none';
  document.getElementById('result').style.display = 'none';
  document.getElementById('pauseScreen').style.display = 'none';
  document.getElementById('hud').style.display = 'flex';
  document.getElementById('bottomBar').style.display = 'flex';
  document.getElementById('modeEl').textContent = state.mode.toUpperCase();
  document.getElementById('bpmEl').textContent = state.currentBpm ? Math.round(state.currentBpm) + ' BPM' : '--';
  const bpmBadge = document.getElementById('bpmBadge');
  bpmBadge.textContent = (state.currentBpm ? Math.round(state.currentBpm) + ' BPM \u2022 ' : '') + state.fallTime.toFixed(2) + 's';
  bpmBadge.style.display = 'block';
  updateHUD();

  if (state.audioCtx.state === 'suspended') state.audioCtx.resume();
  if (state.sourceNode) { try { state.sourceNode.stop(); } catch {} }

  // Gain node so we can control master volume live
  if (!state.gainNode) {
    state.gainNode = state.audioCtx.createGain();
    state.gainNode.connect(state.audioCtx.destination);
  }
  state.gainNode.gain.value = settings.volume;

  state.sourceNode = state.audioCtx.createBufferSource();
  state.sourceNode.buffer = state.audioBuffer;
  state.sourceNode.connect(state.gainNode);
  const startAt = state.audioCtx.currentTime + 0.18;
  state.sourceNode.start(startAt);
  state.startTime = startAt;
  state.sourceNode.onended = () => { if (state.gameRunning && !state.paused) endGame(); };

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
}

export async function resumeGame() {
  if (!state.gameRunning || !state.paused) return;
  try { await state.audioCtx.resume(); } catch {}
  // Any time spent paused shouldn't shift the song clock — because currentTime
  // freezes while suspended, songTime() naturally stays consistent. But if the
  // browser drifted slightly, we track the offset for logging.
  state.pauseOffset += state.audioCtx.currentTime - state.pauseStart;
  state.paused = false;
  document.getElementById('pauseScreen').style.display = 'none';
  lastFrame = performance.now();
  requestAnimationFrame(loop);
}

export function restartCurrent() {
  if (!state.audioBuffer) return;
  // Stop current source cleanly
  try { state.sourceNode?.stop(); } catch {}
  state.sourceNode = null;
  state.paused = false;
  // Un-judge all notes so they replay
  for (const n of state.notes) {
    n.judged = false;
    n.holding = false;
    n.holdProgress = 0;
  }
  if (state.audioCtx.state === 'suspended') state.audioCtx.resume();
  startPlay();
}

export function exitToMenu() {
  if (state.sourceNode) { try { state.sourceNode.stop(); } catch {} }
  state.sourceNode = null;
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
  state.gameRunning = false;
  document.getElementById('hud').style.display = 'none';
  document.getElementById('bottomBar').style.display = 'none';
  document.getElementById('bpmBadge').style.display = 'none';
  const totalJudged = state.perfects + state.goods + state.misses;
  const acc = totalJudged ? Math.round((state.perfects * 1 + state.goods * 0.58) / totalJudged * 100) : 100;
  document.getElementById('finalScore').textContent = state.score.toLocaleString('ru-RU');
  document.getElementById('finalScore2').textContent = state.score.toLocaleString('ru-RU');
  document.getElementById('finalAcc').textContent = acc + '%';
  document.getElementById('finalCombo').textContent = state.maxCombo;
  document.getElementById('finalPerfect').textContent = state.perfects;
  document.getElementById('finalGood').textContent = state.goods;
  document.getElementById('finalHolds').textContent = state.holdsOk + ' / ' + state.holdsTotal;
  document.getElementById('finalMiss').textContent = state.misses;
  document.getElementById('finalBpm').textContent = state.currentBpm ? Math.round(state.currentBpm) : '--';
  document.getElementById('finalSpeed').textContent = state.fallTime.toFixed(2) + 's';
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

  const missWindow = JUDGE.MISS * judgeMultiplier();
  state.notes.forEach(n => {
    if (n.judged) return;
    if (!n.isHold) {
      if (tJudge - n.time > missWindow) {
        n.judged = true; state.combo = 0; state.misses++;
        showJudge('MISS', JUDGE_COLORS.MISS);
        spawnMissParticles(n.lane);
        shake(2.5, 0.2);
        flashScreen(JUDGE_COLORS.MISS, 0.10);
        updateHUD();
      }
    } else {
      if (!n.holding && tJudge - n.time > missWindow) {
        n.judged = true; state.combo = 0; state.misses++;
        showJudge('MISS', JUDGE_COLORS.MISS);
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
  });

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
