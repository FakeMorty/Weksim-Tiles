// Menu wiring: mode buttons, sliders, file input, play button.

import { state } from '../game/state.js';
import { analyzeTrack } from '../audio/analyzer.js';
import { startPlay } from '../game/loop.js';
import { APP_VERSION } from '../config.js';
import { settings } from '../game/settings.js';
import { t, onLocaleChange } from '../i18n/i18n.js';
import { addTrack, getTrack, updateTrack, difficultyStars, guessGenreFromBpm } from '../game/library.js';
import { bindLibrary, render as renderLibrary } from './library.js';

export function bindMenu() {
  const applySubtitle = () => {
    const subtitleEl = document.getElementById('menuSubtitle');
    if (subtitleEl) subtitleEl.innerHTML = t('menu.subtitle') + ' \u2022 <b>v' + APP_VERSION + '</b>';
  };
  applySubtitle();
  onLocaleChange(applySubtitle);
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
    document.getElementById('fallHint').textContent = t('menu.fallHintManual');
  });

  const bpmAutoEl = document.getElementById('bpmAuto');
  bpmAutoEl.addEventListener('change', () => {
    const on = bpmAutoEl.checked;
    fallSpeedEl.disabled = on;
    document.getElementById('fallVal').textContent = on ? t('menu.fallSpeedAuto') : state.fallTime.toFixed(2) + 's';
    document.getElementById('fallHint').textContent = on ? t('menu.fallHintAuto') : t('menu.fallHintManual');
  });

  const holdAmtEl = document.getElementById('holdAmt');
  holdAmtEl.addEventListener('input', e => {
    const v = +e.target.value;
    document.getElementById('holdVal').textContent = v === 0 ? t('menu.holdOff') : v === 1 ? t('menu.holdAuto') : t('menu.holdLots');
  });

  const difficultyEl = document.getElementById('difficultySelect');
  if (difficultyEl) {
    difficultyEl.addEventListener('change', () => {
      const key = 'menu.difficulty' + difficultyEl.value.charAt(0).toUpperCase() + difficultyEl.value.slice(1);
      // Just the short name (first word before " — ")
      document.getElementById('difficultyVal').textContent = t(key).split(' —')[0];
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
    handleFiles(Array.from(e.dataTransfer.files || []));
  });
  fileInput.addEventListener('change', e => { handleFiles(Array.from(e.target.files || [])); });

  // Library card handlers
  bindLibrary({
    onPlay: (track) => { selectAndPlay(track, { bot: false }); },
    onBot:  (track) => { selectAndPlay(track, { bot: true  }); },
  });

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

async function handleFiles(files) {
  if (!files || files.length === 0) return;
  if (!state.audioCtx) state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  const trackNameEl = document.getElementById('trackName');
  let successCount = 0;
  let firstAddedTrack = null;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    trackNameEl.textContent = t('menu.fileDecoding', {
      name: files.length > 1 ? `[${i+1}/${files.length}] ${file.name}` : file.name,
      size: (file.size / 1024 / 1024).toFixed(1),
    });
    try {
      const ab = await file.arrayBuffer();
      const fileBytes = new Uint8Array(ab.slice(0));
      let fileHash = '';
      try {
        const { sha1 } = await import('../audio/cache.js');
        fileHash = await sha1(fileBytes);
      } catch { /* non-fatal */ }
      const audioBuffer = await state.audioCtx.decodeAudioData(ab.slice(0));
      const id = addTrack({
        name: file.name,
        size: file.size,
        duration: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate,
        audioBuffer,
        fileBytes,
        fileHash,
      });
      if (!firstAddedTrack) firstAddedTrack = getTrack(id);
      successCount++;
    } catch (err) {
      console.warn('Failed to decode ' + file.name, err);
    }
  }

  if (successCount === 0) {
    trackNameEl.textContent = t('menu.fileError', { err: 'no valid audio' });
    return;
  }

  // Auto-select first newly-added track as current (matches old single-file behaviour)
  if (firstAddedTrack) {
    setCurrentTrack(firstAddedTrack);
  }
  if (successCount === 1) {
    const tr = firstAddedTrack;
    trackNameEl.textContent = t('menu.fileReady', {
      name: tr.name,
      duration: tr.duration.toFixed(1),
      sr: (tr.sampleRate / 1000).toFixed(0),
    });
  } else {
    trackNameEl.textContent = t('menu.libraryLoaded', { n: successCount });
  }
  document.getElementById('detectedBpmTag').style.display = 'none';
  updatePlayButton();
  renderLibrary();
}

function setCurrentTrack(track) {
  state.currentTrackId = track.id;
  state.fileName = track.name;
  state.audioBuffer = track.audioBuffer;
  state.fileBytes = track.fileBytes;
  state.fileHash = track.fileHash || '';
  renderLibrary();
}

// Called from library card "Play" / "Bot" buttons
async function selectAndPlay(track, opts) {
  setCurrentTrack(track);
  state.botMode = !!opts.bot;
  await startGameSequence();
}

export function updatePlayButton() {
  const btn = document.getElementById('playBtn');
  if (!state.audioBuffer) {
    btn.disabled = true;
    btn.textContent = t('menu.playButtonPickTrack');
    // Ensure it re-localises when language changes
    btn.setAttribute('data-i18n', 'menu.playButtonPickTrack');
    return;
  }
  btn.disabled = false;
  btn.removeAttribute('data-i18n');
  btn.textContent = t('menu.playButtonAnalyze', { mode: state.mode.toUpperCase() });
}

let analyzing = false;

async function startGameSequence() {
  if (!state.audioBuffer) return;
  if (analyzing) return; // guard against double-click
  analyzing = true;
  const btn = document.getElementById('playBtn');
  btn.disabled = true;
  btn.textContent = t('menu.playButtonBusy');
  // v1.24.1: use the big analysis overlay so users can actually see progress
  const overlay = document.getElementById('analysisOverlay');
  const overlayName = document.getElementById('analysisTrackName');
  const overlayBar = document.getElementById('analysisBar');
  const overlayPct = document.getElementById('analysisPct');
  const overlayStage = document.getElementById('analysisStage');
  if (overlay) {
    overlay.classList.add('active');
    if (overlayName) overlayName.textContent = state.fileName || '—';
    if (overlayBar) overlayBar.style.width = '0%';
    if (overlayPct) overlayPct.textContent = '0%';
    if (overlayStage) overlayStage.textContent = t('menu.analyzingHeader', { mode: state.mode.toUpperCase() });
  }
  const topNote = document.getElementById('topNote');
  topNote.style.display = 'block';
  topNote.textContent = t('menu.analyzingHeader', { mode: state.mode.toUpperCase() });
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
      pitch: 'Pitch tracking (YIN)',
      sources: 'Source separation',
      nmf: 'NMF refinement (' + settings.nmfMode + ')',
      flux: 'Multiband flux',
      novelty: 'Novelty',
      onsets: 'Onset picking',
      bpm: 'BPM autocorr + tempogram',
      'beat-track': 'Beat tracking (Ellis DP)',
      plp: 'PLP (local tempo)',
      downbeats: 'Downbeat detection',
      'beat-snap': 'Beat snap',
      done: 'Finalize',
    };
    let analysis;
    if (state.pendingImportedMap) {
      analysis = state.pendingImportedMap;
      state.pendingImportedMap = null;
      topNote.innerHTML = '<b style="color:#7dfffa">' + t('menu.trackImportedShort') + '</b>';
      await new Promise(r => setTimeout(r, 200));
    } else {
      analysis = await analyzeTrack(state.audioBuffer, state.mode, sens, {
        holdEnable, holdMode, dual, smartLane, difficulty,
        hpssMode: settings.hpssMode,
        nmfMode: settings.nmfMode,
        fileBytes: state.fileBytes,
        fileName: state.fileName,
        onProgress: (p, stage) => {
          const pct = Math.round(p * 100);
          topNote.innerHTML = t('menu.analyzing', { pct, stage: stageNames[stage] || stage });
          if (overlayBar) overlayBar.style.width = pct + '%';
          if (overlayPct) overlayPct.textContent = pct + '%';
          if (overlayStage) overlayStage.textContent = stageNames[stage] || stage;
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

    // Update library entry with BPM + star rating so the card shows them next time
    if (state.currentTrackId != null) {
      const nps = state.audioBuffer.duration > 0
        ? state.notes.length / state.audioBuffer.duration : 0;
      updateTrack(state.currentTrackId, {
        bpm: state.currentBpm,
        difficulty: difficultyStars(state.currentBpm, nps),
        genre: guessGenreFromBpm(state.currentBpm),
        analysis,
      });
      renderLibrary();
    }

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
      ? t('menu.trackCached')
      : (analysis.analysisMs ? ' \u2022 ' + Math.round(analysis.analysisMs) + 'ms' : '');
    const density = state.audioBuffer.duration > 0 ? (state.notes.length / state.audioBuffer.duration).toFixed(1) : '?';
    const droppedTag = analysis.droppedByDensity > 0
      ? t('menu.trackDropped', { n: analysis.droppedByDensity })
      : '';
    topNote.innerHTML = t('menu.trackSummary', {
      notes: state.notes.length,
      density,
      holds: state.holdsTotal,
      bpm: Math.round(state.currentBpm),
      dropped: droppedTag,
      fall: state.fallTime.toFixed(2),
      ms: msTag,
    });
    document.getElementById('holdCountEl').textContent = t('hud.hold', { n: state.holdsTotal });
    document.getElementById('bpmEl').textContent = t('hud.bpmValue', { bpm: Math.round(state.currentBpm) });
    // Show 100% briefly, then hide overlay + start game
    if (overlayBar) overlayBar.style.width = '100%';
    if (overlayPct) overlayPct.textContent = '100%';
    if (overlayStage) overlayStage.textContent = t('menu.analysisReady');
    setTimeout(() => {
      topNote.style.display = 'none';
      if (overlay) overlay.classList.remove('active');
      startPlay();
      analyzing = false;
    }, 620);
  } catch (e) {
    console.error(e);
    alert(t('common.error') + ': ' + e);
    btn.disabled = false;
    updatePlayButton();
    document.getElementById('topNote').style.display = 'none';
    if (overlay) overlay.classList.remove('active');
    analyzing = false;
  }
}
