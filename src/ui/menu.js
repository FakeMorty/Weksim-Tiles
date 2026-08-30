// Menu wiring: mode buttons, sliders, file input, play button.

import { state } from '../game/state.js';
import { analyzeTrack } from '../audio/analyzer.js';
import { APP_VERSION } from '../config.js';
import { settings } from '../game/settings.js';
import { t, onLocaleChange } from '../i18n/i18n.js';
import { addTrack, getTrack, updateTrack, listTracks, difficultyStars, guessGenreFromBpm } from '../game/library.js';
import { bindLibrary, render as renderLibrary } from './library.js';
import { showPreview } from './preview.js';
import { notice } from './notice.js';
import { buildDemoTrack } from '../audio/demoTrack.js';
import { applyKeyLabels } from '../game/keys.js';

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
    onSelect: (track) => { setCurrentTrack(track); updatePlayButton(); },
  });

  document.getElementById('playBtn').addEventListener('click', () => {
    state.botMode = false;
    startGameSequence();
  });
  document.getElementById('demoBtn')?.addEventListener('click', loadDemoAndPlay);
  document.getElementById('againBtn').addEventListener('click', async () => {
    if (!state.audioBuffer || !state.notes.length) return;
    const { restartCurrent } = await import('../game/loop.js');
    await restartCurrent();
  });
  document.getElementById('resultMenuBtn')?.addEventListener('click', async () => {
    const { exitToMenu } = await import('../game/loop.js');
    await exitToMenu();
    updatePlayButton();
  });
  window.addEventListener('keydown', e => {
    const result = document.getElementById('result');
    if (!result || result.style.display !== 'flex') return;
    if (e.repeat) return;
    if (e.code === 'KeyR' || e.code === 'Enter' || e.code === 'Space') {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      document.getElementById('againBtn')?.click();
    }
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

export function setCurrentTrack(track) {
  state.currentTrackId = track.id;
  state.fileName = track.name;
  state.audioBuffer = track.audioBuffer;
  state.fileBytes = track.fileBytes;
  state.fileHash = track.fileHash || '';
  renderLibrary();
}

export function afterLibraryRestored(tracks) {
  if (tracks && tracks.length) {
    setCurrentTrack(tracks[tracks.length - 1]);
    updatePlayButton();
  }
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
    const delay = analysis.fromCache ? 60 : 280;
    setTimeout(() => {
      topNote.style.display = 'none';
      if (overlay) overlay.classList.remove('active');
      analyzing = false;
      updatePlayButton();
      applyKeyLabels();
      showPreview({ bot: state.botMode });
    }, delay);
  } catch (e) {
    console.error(e);
    notice(t('common.error') + ': ' + e, 4200);
    btn.disabled = false;
    updatePlayButton();
    document.getElementById('topNote').style.display = 'none';
    if (overlay) overlay.classList.remove('active');
    analyzing = false;
  }
}

async function loadDemoAndPlay() {
  if (analyzing) return;
  if (!state.audioCtx) state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (state.audioCtx.state === 'suspended') await state.audioCtx.resume();
  const existing = listTracks().find(tr => tr.isDemo);
  if (existing) {
    setCurrentTrack(existing);
    document.getElementById('trackName').textContent = t('menu.fileReady', {
      name: t('menu.demoName'),
      duration: existing.duration.toFixed(1),
      sr: (existing.sampleRate / 1000).toFixed(0),
    });
    updatePlayButton();
    state.botMode = false;
    await startGameSequence();
    return;
  }
  const btn = document.getElementById('demoBtn');
  if (btn) { btn.disabled = true; btn.textContent = t('menu.demoLoading'); }
  try {
    const demo = buildDemoTrack(state.audioCtx);
    let fileHash = '';
    try {
      const { sha1 } = await import('../audio/cache.js');
      fileHash = await sha1(demo.fileBytes);
    } catch { /* ignore */ }
    const id = addTrack({
      name: t('menu.demoName'),
      size: demo.fileBytes.byteLength,
      duration: demo.duration,
      sampleRate: demo.sampleRate,
      audioBuffer: demo.audioBuffer,
      fileBytes: demo.fileBytes,
      fileHash,
      isDemo: true,
    });
    setCurrentTrack(getTrack(id));
    document.getElementById('trackName').textContent = t('menu.fileReady', {
      name: t('menu.demoName'),
      duration: demo.duration.toFixed(1),
      sr: (demo.sampleRate / 1000).toFixed(0),
    });
    updatePlayButton();
    renderLibrary();
    state.botMode = false;
    await startGameSequence();
  } catch (e) {
    console.error(e);
    notice(t('common.error') + ': ' + e, 4200);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = t('menu.demoBtn'); }
  }
}
