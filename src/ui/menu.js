// Menu wiring: mode buttons, sliders, file input, play button.

import { state } from '../game/state.js';
import { analyzeTrack } from '../audio/analyzer.js';
import { startPlay } from '../game/loop.js';
import { APP_VERSION } from '../config.js';
import { settings } from '../game/settings.js';

export function bindMenu() {
  const subtitleEl = document.getElementById('menuSubtitle');
  if (subtitleEl) {
    subtitleEl.innerHTML = 'neon tiles \u2022 shoot the beat \u2022 <b>v' + APP_VERSION + '</b>';
  }
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.mode = btn.dataset.mode;
      updatePlayButton();
    });
  });

  document.getElementById('sens').addEventListener('input', e => {
    document.getElementById('sensVal').textContent = parseFloat(e.target.value).toFixed(2) + '\u03c3';
  });

  const fallSpeedEl = document.getElementById('fallSpeed');
  fallSpeedEl.addEventListener('input', e => {
    state.fallTime = parseFloat(e.target.value);
    document.getElementById('fallVal').textContent = state.fallTime.toFixed(2) + 's';
    document.getElementById('fallHint').textContent = '\u0420\u0443\u0447\u043d\u043e\u0439 \u0440\u0435\u0436\u0438\u043c';
  });

  const bpmAutoEl = document.getElementById('bpmAuto');
  bpmAutoEl.addEventListener('change', () => {
    const on = bpmAutoEl.checked;
    fallSpeedEl.disabled = on;
    document.getElementById('fallVal').textContent = on ? '\u0410\u0432\u0442\u043e BPM' : state.fallTime.toFixed(2) + 's';
    document.getElementById('fallHint').textContent = on
      ? '\u0410\u0432\u0442\u043e \u043f\u043e\u0434 BPM, \u043c\u043e\u0436\u043d\u043e \u043e\u0442\u043a\u043b\u044e\u0447\u0438\u0442\u044c'
      : '\u0420\u0443\u0447\u043d\u043e\u0439 \u0440\u0435\u0436\u0438\u043c';
  });

  const holdAmtEl = document.getElementById('holdAmt');
  holdAmtEl.addEventListener('input', e => {
    const v = +e.target.value;
    document.getElementById('holdVal').textContent = v === 0 ? '\u0412\u044b\u043a\u043b' : v === 1 ? '\u0410\u0432\u0442\u043e' : '\u041c\u043d\u043e\u0433\u043e';
  });

  const difficultyEl = document.getElementById('difficultySelect');
  if (difficultyEl) {
    difficultyEl.addEventListener('change', () => {
      const labels = { easy: 'EASY', normal: 'NORMAL', hard: 'HARD', expert: 'EXPERT' };
      document.getElementById('difficultyVal').textContent = labels[difficultyEl.value] || 'NORMAL';
    });
  }

  const fileInput = document.getElementById('fileInput');
  const dropzone = document.getElementById('dropzone');
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });

  document.getElementById('playBtn').addEventListener('click', startGameSequence);
  document.getElementById('againBtn').addEventListener('click', async () => {
    // Fully unwind current playback state before returning to menu.
    // Without this, an old sourceNode could still be playing and the
    // results screen might reappear after the user changes mode.
    const { exitToMenu } = await import('../game/loop.js');
    await exitToMenu();
    updatePlayButton();
  });
}

async function handleFile(file) {
  state.fileName = file.name;
  document.getElementById('trackName').textContent =
    file.name + ' \u2014 ' + (file.size / 1024 / 1024).toFixed(1) + ' MB, \u0434\u0435\u043a\u043e\u0434\u0438\u0440\u0443\u044e\u2026';
  updatePlayButton();
  if (!state.audioCtx) state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const ab = await file.arrayBuffer();
  // Keep raw bytes for cache hashing. arrayBuffer is transferred by decode,
  // so we duplicate. Cost: file.size bytes in memory during play (few MB).
  state.fileBytes = new Uint8Array(ab.slice(0));
  // Compute SHA-1 once now so stats/cache lookups don't repeat it.
  try {
    const { sha1 } = await import('../audio/cache.js');
    state.fileHash = await sha1(state.fileBytes);
  } catch { state.fileHash = ''; }
  try {
    state.audioBuffer = await state.audioCtx.decodeAudioData(ab.slice(0));
    document.getElementById('trackName').textContent =
      '\u2713 ' + file.name + ' \u2022 ' + state.audioBuffer.duration.toFixed(1) + 's \u2022 ' +
      (state.audioBuffer.sampleRate / 1000).toFixed(0) + 'kHz';
    document.getElementById('detectedBpmTag').style.display = 'none';
    updatePlayButton();
  } catch (err) {
    document.getElementById('trackName').textContent = '\u041e\u0448\u0438\u0431\u043a\u0430 \u0434\u0435\u043a\u043e\u0434\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u044f: ' + err;
    state.audioBuffer = null;
    updatePlayButton();
  }
}

export function updatePlayButton() {
  const btn = document.getElementById('playBtn');
  if (!state.audioBuffer) {
    btn.disabled = true;
    btn.textContent = '\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u0438 \u0442\u0440\u0435\u043a';
    return;
  }
  btn.disabled = false;
  btn.textContent = `\u0410\u043d\u0430\u043b\u0438\u0437\u0438\u0440\u043e\u0432\u0430\u0442\u044c [${state.mode.toUpperCase()}] \u0438 \u0438\u0433\u0440\u0430\u0442\u044c`;
}

let analyzing = false;

async function startGameSequence() {
  if (!state.audioBuffer) return;
  if (analyzing) return; // guard against double-click
  analyzing = true;
  const btn = document.getElementById('playBtn');
  btn.disabled = true;
  btn.textContent = '\u0410\u043d\u0430\u043b\u0438\u0437\u2026';
  const topNote = document.getElementById('topNote');
  topNote.style.display = 'block';
  topNote.textContent = '\u0410\u043d\u0430\u043b\u0438\u0437\u0438\u0440\u0443\u044e ' + state.mode.toUpperCase() + ' \u2026 STFT + multiband flux \u2026';
  await new Promise(r => setTimeout(r, 60));
  try {
    const sens = parseFloat(document.getElementById('sens').value);
    const holdMode = +document.getElementById('holdAmt').value;
    const holdEnable = document.getElementById('holdEnable').checked;
    const dual = document.getElementById('dualEnable').checked;
    const smartLane = document.getElementById('autoLane').checked;
    const difficulty = document.getElementById('difficultySelect')?.value || 'normal';
    const stageNames = {
      stft: 'STFT',
      hpss: 'HPSS (' + settings.hpssMode + ')',
      'hpss-lite': 'Percussive isolation',
      flux: 'Multiband flux',
      novelty: 'Novelty',
      onsets: 'Onset picking',
      bpm: 'BPM autocorr + tempogram',
      'beat-track': 'Beat tracking (Ellis DP)',
      'beat-snap': 'Beat snap',
      done: 'Finalize',
    };
    let analysis;
    if (state.pendingImportedMap) {
      // Etap 10: user loaded a .wtmap.json — skip the whole analyzer pipeline
      analysis = state.pendingImportedMap;
      state.pendingImportedMap = null;
      topNote.innerHTML = '\u0417\u0430\u0433\u0440\u0443\u0436\u0435\u043d\u043e \u0438\u0437 \u0444\u0430\u0439\u043b\u0430 \u2014 <b style="color:#7dfffa">imported</b>';
      await new Promise(r => setTimeout(r, 200));
    } else {
      analysis = await analyzeTrack(state.audioBuffer, state.mode, sens, {
        holdEnable, holdMode, dual, smartLane, difficulty,
        hpssMode: settings.hpssMode,
        fileBytes: state.fileBytes,
        fileName: state.fileName,
        onProgress: (p, stage) => {
          const pct = Math.round(p * 100);
          topNote.innerHTML = `\u0410\u043d\u0430\u043b\u0438\u0437\u2026 <b>${pct}%</b> \u2014 ${stageNames[stage] || stage}`;
        },
      });
    }
    state.notes = analysis.notes;
    state.currentBpm = analysis.bpm;
    state.currentBpmConf = analysis.bpmConfidence;
    state.bpmStable = analysis.bpmStable !== false;
    state.bpmDrift = analysis.bpmDrift || 0;
    state.beatTimes = analysis.beatTimes || [];
    state.currentDifficulty = difficulty;
    state.currentSens = sens;
    state.lastAnalysis = analysis;
    state.holdsTotal = state.notes.filter(n => n.isHold).length;

    const bpmAuto = document.getElementById('bpmAuto').checked;
    const fallSpeedEl = document.getElementById('fallSpeed');
    if (bpmAuto && state.currentBpm > 40) {
      const beatsLead = parseFloat(document.getElementById('beatsLead').value);
      let autoFall = (beatsLead * 60.0) / state.currentBpm;
      autoFall = Math.max(0.88, Math.min(2.25, autoFall));
      state.fallTime = autoFall;
      fallSpeedEl.value = state.fallTime.toFixed(2);
      document.getElementById('fallVal').textContent = state.fallTime.toFixed(2) + 's';
    } else {
      state.fallTime = parseFloat(fallSpeedEl.value);
    }

    const bpmTag = document.getElementById('detectedBpmTag');
    const stableMark = state.bpmStable ? '' : ' ~';
    const confPct = Math.round((state.currentBpmConf || 0) * 100);
    bpmTag.textContent = Math.round(state.currentBpm) + ' BPM' + stableMark;
    bpmTag.title = `Confidence: ${confPct}% \u2022 ${state.bpmStable ? 'Stable tempo' : 'Tempo drift \u00b1' + state.bpmDrift.toFixed(1) + ' BPM'} \u2022 ${state.beatTimes.length} tracked beats`;
    bpmTag.style.display = 'inline-block';
    if (!state.bpmStable) {
      bpmTag.style.borderColor = '#a08800';
      bpmTag.style.color = '#ffd86a';
    } else {
      bpmTag.style.borderColor = '';
      bpmTag.style.color = '';
    }

    const msTag = analysis.fromCache
      ? ' \u2022 <b style="color:#7dfffa">cached</b>'
      : (analysis.analysisMs ? ` \u2022 ${Math.round(analysis.analysisMs)}ms` : '');
    const density = state.audioBuffer.duration > 0 ? (state.notes.length / state.audioBuffer.duration).toFixed(1) : '?';
    const droppedTag = analysis.droppedByDensity > 0 ? ` \u2022 -${analysis.droppedByDensity} \u043b\u0438\u0448\u043d\u0438\u0445` : '';
    topNote.innerHTML =
      `${state.notes.length} \u043d\u043e\u0442 (${density}/\u0441\u0435\u043a) \u2022 ${state.holdsTotal} HOLD \u2022 <b>${Math.round(state.currentBpm)} BPM</b>${droppedTag} \u2022 ${state.fallTime.toFixed(2)}s${msTag} \u2022 \u0441\u0442\u0430\u0440\u0442\u2026`;
    document.getElementById('holdCountEl').textContent = 'HOLD ' + state.holdsTotal;
    document.getElementById('bpmEl').textContent = Math.round(state.currentBpm) + ' BPM';
    setTimeout(() => {
      topNote.style.display = 'none';
      startPlay();
      analyzing = false;
    }, 620);
  } catch (e) {
    console.error(e);
    alert('\u041e\u0448\u0438\u0431\u043a\u0430 \u0430\u043d\u0430\u043b\u0438\u0437\u0430: ' + e);
    btn.disabled = false;
    updatePlayButton();
    document.getElementById('topNote').style.display = 'none';
    analyzing = false;
  }
}
