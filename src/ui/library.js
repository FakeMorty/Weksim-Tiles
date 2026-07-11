// Etap E (v1.24): Track library UI.
//
// Renders card list (matches the Piano Tiles reference the user shared).
// Each card: [#] [title / sub-info / stars] [Play] [Bot] [×]
//
// Selecting a card sets it as the current track. Play analyses + starts.
// Bot analyses + starts in autopilot mode.

import { listTracks, removeTrack, onLibraryChange, difficultyStars, guessGenreFromBpm } from '../game/library.js';
import { state } from '../game/state.js';
import { t } from '../i18n/i18n.js';

let onPlayCb = null;
let onBotCb = null;

export function bindLibrary(handlers) {
  onPlayCb = handlers.onPlay;
  onBotCb = handlers.onBot;
  const clearBtn = document.getElementById('libClearBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const tracks = listTracks();
      for (const t of tracks) removeTrack(t.id);
    });
  }
  onLibraryChange(render);
  render();
}

export function render() {
  const panel = document.getElementById('libraryPanel');
  const list = document.getElementById('libraryList');
  if (!panel || !list) return;
  const tracks = listTracks();
  if (tracks.length === 0) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';
  list.innerHTML = '';
  tracks.forEach((track, idx) => {
    list.appendChild(makeCard(track, idx + 1));
  });
}

function makeCard(track, num) {
  const card = document.createElement('div');
  card.className = 'lib-card';
  if (state.currentTrackId === track.id) card.classList.add('selected');

  const stars = track.difficulty || 0;
  const starRow = renderStars(stars);
  const genre = track.genre || (track.bpm > 0 ? guessGenreFromBpm(track.bpm) : t('menu.libraryNotAnalysed'));
  const bpm = track.bpm > 0 ? Math.round(track.bpm) + ' BPM' : '—';
  const dur = track.duration ? formatTime(track.duration) : '';

  card.innerHTML = `
    <div class="lib-num">${num}</div>
    <div class="lib-info">
      <div class="lib-title">${escapeHtml(stripExt(track.name))}</div>
      <div class="lib-sub">${escapeHtml(genre)} · ${bpm} · ${dur}</div>
      <div class="lib-stars">${starRow}</div>
    </div>
    <div class="lib-actions">
      <button class="lib-btn play" data-i18n="menu.libraryPlay">Play</button>
      <button class="lib-btn bot" data-i18n="menu.libraryBot" title="Watch bot play">Bot</button>
      <button class="lib-btn del" title="Remove">×</button>
    </div>
  `;

  card.querySelector('.lib-btn.play').addEventListener('click', (e) => {
    e.stopPropagation();
    if (onPlayCb) onPlayCb(track);
  });
  card.querySelector('.lib-btn.bot').addEventListener('click', (e) => {
    e.stopPropagation();
    if (onBotCb) onBotCb(track);
  });
  card.querySelector('.lib-btn.del').addEventListener('click', (e) => {
    e.stopPropagation();
    removeTrack(track.id);
  });
  card.addEventListener('click', () => {
    state.currentTrackId = track.id;
    render();
  });
  return card;
}

function renderStars(n) {
  const filled = Math.max(0, Math.min(5, n));
  let out = '';
  for (let i = 0; i < 5; i++) {
    out += i < filled ? '★' : '<span class="off">★</span>';
  }
  return out;
}

function stripExt(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
