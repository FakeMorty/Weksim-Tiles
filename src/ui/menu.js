// Menu wiring: mode buttons, sliders, file input, play button.

import { state } from '../game/state.js';
import { analyzeTrack } from '../audio/analyzer.js';
import { startPlay } from '../game/loop.js';

export function bindMenu() {
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
  document.getElementById('againBtn').addEventListener('click', () => {
    document.getElementById('result').style.display = 'none';
    document.getElementById('menu').style.display = 'flex';
    document.getElementById('bpmBadge').style.display = 'none';
  });
}

async function handleFile(file) {
  state.fileName = file.name;
  document.getElementById('trackName').textContent =
    file.name + ' \u2014 ' + (file.size / 1024 / 1024).toFixed(1) + ' MB, \u0434\u0435\u043a\u043e\u0434\u0438\u0440\u0443\u044e\u2026';
  updatePlayButton();
  if (!state.audioCtx) state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const ab = await file.arrayBuffer();
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

async function startGameSequence() {
  if (!state.audioBuffer) return;
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
    const stageNames = {
      stft: 'STFT',
      flux: 'Multiband flux',
      novelty: 'Novelty',
      onsets: 'Onset picking',
      bpm: 'BPM autocorr',
      done: 'Finalize',
    };
    const analysis = await analyzeTrack(state.audioBuffer, state.mode, sens, {
      holdEnable, holdMode, dual, smartLane,
      onProgress: (p, stage) => {
        const pct = Math.round(p * 100);
        topNote.innerHTML = `\u0410\u043d\u0430\u043b\u0438\u0437\u2026 <b>${pct}%</b> \u2014 ${stageNames[stage] || stage}`;
      },
    });
    state.notes = analysis.notes;
    state.currentBpm = analysis.bpm;
    state.currentBpmConf = analysis.bpmConfidence;
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
    bpmTag.textContent = Math.round(state.currentBpm) + ' BPM';
    bpmTag.style.display = 'inline-block';

    const msTag = analysis.analysisMs ? ` \u2022 ${Math.round(analysis.analysisMs)}ms` : '';
    topNote.innerHTML =
      `${state.notes.length} \u043d\u043e\u0442 \u2022 ${state.holdsTotal} HOLD \u2022 <b>${Math.round(state.currentBpm)} BPM</b> \u2022 ${state.fallTime.toFixed(2)}s \u043f\u043e\u043b\u0451\u0442${msTag} \u2022 \u0441\u0442\u0430\u0440\u0442\u2026`;
    document.getElementById('holdCountEl').textContent = 'HOLD ' + state.holdsTotal;
    document.getElementById('bpmEl').textContent = Math.round(state.currentBpm) + ' BPM';
    setTimeout(() => { topNote.style.display = 'none'; startPlay(); }, 620);
  } catch (e) {
    console.error(e);
    alert('\u041e\u0448\u0438\u0431\u043a\u0430 \u0430\u043d\u0430\u043b\u0438\u0437\u0430: ' + e);
    btn.disabled = false;
    updatePlayButton();
    document.getElementById('topNote').style.display = 'none';
  }
}
