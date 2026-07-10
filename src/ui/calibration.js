// Calibration screen: user taps to a metronome, we compute median offset.
// Also exposes a manual slider + judge-strictness selector.

import { calibration, saveCalibration, resetCalibration, suggestAudioOffsetMs } from '../game/calibration.js';
import { state } from '../game/state.js';

const METRONOME_BPM = 120;
const BEAT_INTERVAL = 60 / METRONOME_BPM; // 0.5s
const TAPS_TARGET = 12;

let calCtx = null;
let calStartTime = 0;
let calRunning = false;
let calBeatCount = 0;
let calTapOffsets = []; // signed ms, positive = late
let stopTimer = null;

export function bindCalibration() {
  document.getElementById('openCalibrationBtn')?.addEventListener('click', openCalibration);
  document.getElementById('calibrationCloseBtn')?.addEventListener('click', closeCalibration);
  document.getElementById('calibrationStartBtn')?.addEventListener('click', startCalibrationRun);
  document.getElementById('calibrationApplyBtn')?.addEventListener('click', applyCalibrationResult);
  document.getElementById('calibrationResetBtn')?.addEventListener('click', () => {
    resetCalibration();
    refreshCalibrationUI();
  });

  const audioSlider = document.getElementById('audioOffsetSlider');
  const visualSlider = document.getElementById('visualOffsetSlider');
  const judgeSelect = document.getElementById('judgeModeSelect');
  audioSlider?.addEventListener('input', e => {
    calibration.audioOffset = parseInt(e.target.value, 10);
    document.getElementById('audioOffsetVal').textContent = calibration.audioOffset + ' ms';
    saveCalibration();
  });
  visualSlider?.addEventListener('input', e => {
    calibration.visualOffset = parseInt(e.target.value, 10);
    document.getElementById('visualOffsetVal').textContent = calibration.visualOffset + ' ms';
    saveCalibration();
  });
  judgeSelect?.addEventListener('change', e => {
    calibration.judgeMode = e.target.value;
    saveCalibration();
  });

  // Global key handler for calibration mode (space = tap)
  window.addEventListener('keydown', e => {
    if (!calRunning) return;
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      recordCalTap();
    }
  });
  document.getElementById('calTapZone')?.addEventListener('pointerdown', () => {
    if (calRunning) recordCalTap();
  });

  refreshCalibrationUI();
}

export function refreshCalibrationUI() {
  const audioSlider = document.getElementById('audioOffsetSlider');
  const visualSlider = document.getElementById('visualOffsetSlider');
  const judgeSelect = document.getElementById('judgeModeSelect');
  if (audioSlider) {
    audioSlider.value = calibration.audioOffset;
    document.getElementById('audioOffsetVal').textContent = calibration.audioOffset + ' ms';
  }
  if (visualSlider) {
    visualSlider.value = calibration.visualOffset;
    document.getElementById('visualOffsetVal').textContent = calibration.visualOffset + ' ms';
  }
  if (judgeSelect) judgeSelect.value = calibration.judgeMode;
}

function openCalibration() {
  document.getElementById('calibrationScreen').style.display = 'flex';
  document.getElementById('menu').style.display = 'none';
  refreshCalibrationUI();
  const hint = document.getElementById('calSuggestedOffset');
  if (hint && state.audioCtx) {
    const suggested = suggestAudioOffsetMs(state.audioCtx);
    hint.textContent = suggested
      ? 'HW hint: ~' + suggested + ' ms (Web Audio outputLatency)'
      : 'HW hint: недоступен';
  }
}

function closeCalibration() {
  stopCalibrationRun();
  document.getElementById('calibrationScreen').style.display = 'none';
  document.getElementById('menu').style.display = 'flex';
}

function startCalibrationRun() {
  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (state.audioCtx.state === 'suspended') state.audioCtx.resume();
  calCtx = state.audioCtx;
  calTapOffsets = [];
  calBeatCount = 0;
  calRunning = true;
  calStartTime = calCtx.currentTime + 0.5;

  document.getElementById('calStatus').textContent = 'Тапай Space / клик на каждый бип. Осталось: ' + TAPS_TARGET;
  document.getElementById('calResult').textContent = '';
  document.getElementById('calibrationStartBtn').disabled = true;
  document.getElementById('calibrationApplyBtn').disabled = true;

  // Pre-schedule all beeps
  const totalBeats = TAPS_TARGET + 2; // 2 lead-in beats not counted
  for (let i = 0; i < totalBeats; i++) {
    scheduleBeep(calStartTime + i * BEAT_INTERVAL, i < 2);
  }

  const runDuration = (totalBeats + 1) * BEAT_INTERVAL * 1000;
  clearTimeout(stopTimer);
  stopTimer = setTimeout(finishCalibrationRun, runDuration);

  // Visual pulse loop
  requestAnimationFrame(pulseLoop);
}

function stopCalibrationRun() {
  calRunning = false;
  clearTimeout(stopTimer);
  document.getElementById('calibrationStartBtn').disabled = false;
}

function scheduleBeep(when, isLeadIn) {
  if (!calCtx) return;
  const osc = calCtx.createOscillator();
  const gain = calCtx.createGain();
  osc.frequency.value = isLeadIn ? 660 : 880;
  gain.gain.value = 0;
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(isLeadIn ? 0.12 : 0.22, when + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.08);
  osc.connect(gain).connect(calCtx.destination);
  osc.start(when);
  osc.stop(when + 0.1);
}

function recordCalTap() {
  if (!calCtx) return;
  const now = calCtx.currentTime;
  // Find nearest scheduled beat (skip 2 lead-in beats)
  const elapsed = now - calStartTime;
  const nearestBeat = Math.round(elapsed / BEAT_INTERVAL);
  if (nearestBeat < 2) return; // lead-in, don't record
  const beatIdx = nearestBeat - 2;
  if (beatIdx >= TAPS_TARGET) return;
  const idealTime = calStartTime + nearestBeat * BEAT_INTERVAL;
  const offsetMs = (now - idealTime) * 1000;
  // Reject wild taps (>250 ms off = not actually on this beat)
  if (Math.abs(offsetMs) > 250) return;
  calTapOffsets.push(offsetMs);
  const remaining = TAPS_TARGET - calTapOffsets.length;
  document.getElementById('calStatus').textContent = remaining > 0
    ? 'Осталось: ' + remaining
    : 'Готово! Обрабатываю…';
  pulseTap();
  if (calTapOffsets.length >= TAPS_TARGET) {
    setTimeout(finishCalibrationRun, 100);
  }
}

function finishCalibrationRun() {
  stopCalibrationRun();
  if (calTapOffsets.length < 4) {
    document.getElementById('calStatus').textContent = 'Слишком мало тапов. Попробуй ещё раз.';
    return;
  }
  const sorted = [...calTapOffsets].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const mean = calTapOffsets.reduce((a, b) => a + b, 0) / calTapOffsets.length;
  const variance = calTapOffsets.reduce((s, v) => s + (v - mean) ** 2, 0) / calTapOffsets.length;
  const std = Math.sqrt(variance);

  // The offset we WANT to apply is the median: shift the judge clock so that
  // the user's typical tap becomes "on time". Positive median = user tapped
  // late → add positive audioOffset so game treats late taps as on-time.
  const suggested = Math.round(median);

  document.getElementById('calStatus').textContent = 'Готово! Тапов: ' + calTapOffsets.length;
  document.getElementById('calResult').innerHTML =
    'Медианный оффсет: <b>' + suggested + ' ms</b> · разброс σ = ' + std.toFixed(1) + ' ms<br>' +
    (std < 25 ? '✓ Стабильные тапы' : std < 55 ? '~ Средняя стабильность' : '⚠ Разброс большой — попробуй снова');

  document.getElementById('calibrationApplyBtn').disabled = false;
  document.getElementById('calibrationApplyBtn').dataset.suggested = suggested;
}

function applyCalibrationResult() {
  const suggested = parseInt(document.getElementById('calibrationApplyBtn').dataset.suggested || '0', 10);
  calibration.audioOffset = suggested;
  saveCalibration();
  refreshCalibrationUI();
  document.getElementById('calResult').innerHTML += '<br><span style="color:#7dfffa">✓ Применено: audioOffset = ' + suggested + ' ms</span>';
}

// --- Visual pulse (metronome ring) ---
let lastPulseBeat = -1;
let tapPulse = 0;

function pulseLoop() {
  if (!calRunning) return;
  const ring = document.getElementById('calMetroRing');
  if (ring && calCtx) {
    const elapsed = calCtx.currentTime - calStartTime;
    const beatPhase = elapsed / BEAT_INTERVAL;
    const beatIdx = Math.floor(beatPhase);
    if (beatIdx !== lastPulseBeat && beatIdx >= 0) {
      lastPulseBeat = beatIdx;
      ring.style.transform = 'translate(-50%,-50%) scale(1.35)';
      ring.style.opacity = '1';
      setTimeout(() => {
        if (ring) {
          ring.style.transform = 'translate(-50%,-50%) scale(1.0)';
          ring.style.opacity = '0.5';
        }
      }, 90);
    }
    // Tap pulse decay
    if (tapPulse > 0) {
      tapPulse = Math.max(0, tapPulse - 0.06);
      const tapEl = document.getElementById('calTapPulse');
      if (tapEl) tapEl.style.opacity = tapPulse.toFixed(2);
    }
  }
  requestAnimationFrame(pulseLoop);
}

function pulseTap() {
  tapPulse = 1;
}
