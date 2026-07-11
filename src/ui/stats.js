// Etap 10: Stats screen + import/export map wiring.

import { recentPlays, totalStats, clearStats } from '../game/stats.js';
import { clearCache } from '../audio/cache.js';
import { exportMap, importMap, downloadMapFile, readMapFile } from '../audio/mapIO.js';
import { state } from '../game/state.js';

const DIFF_COLORS = {
  easy:   { bg: '#0e2b1c', fg: '#7aff99' },
  normal: { bg: '#0e2440', fg: '#7dfffa' },
  hard:   { bg: '#3a1e10', fg: '#ffb066' },
  expert: { bg: '#3a0e2a', fg: '#ff7adf' },
};

export function bindStats() {
  const openBtn = document.getElementById('openStatsBtn');
  const closeBtn = document.getElementById('statsCloseBtn');
  const clearHistoryBtn = document.getElementById('statsClearBtn');
  const clearCacheBtn = document.getElementById('cacheClearBtn');

  openBtn?.addEventListener('click', () => {
    renderStats();
    document.getElementById('statsScreen').style.display = 'flex';
    document.getElementById('menu').style.display = 'none';
  });
  closeBtn?.addEventListener('click', () => {
    document.getElementById('statsScreen').style.display = 'none';
    document.getElementById('menu').style.display = 'flex';
  });
  clearHistoryBtn?.addEventListener('click', () => {
    if (confirm('\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u0432\u0441\u044e \u0438\u0441\u0442\u043e\u0440\u0438\u044e \u0438\u0433\u0440?')) {
      clearStats();
      renderStats();
    }
  });
  clearCacheBtn?.addEventListener('click', async () => {
    if (confirm('\u041e\u0447\u0438\u0441\u0442\u0438\u0442\u044c \u043a\u044d\u0448 \u0430\u043d\u0430\u043b\u0438\u0437\u0430 (\u0442\u0440\u0435\u043a\u0438 \u0431\u0443\u0434\u0443\u0442 \u0430\u043d\u0430\u043b\u0438\u0437\u0438\u0440\u043e\u0432\u0430\u0442\u044c\u0441\u044f \u0437\u0430\u043d\u043e\u0432\u043e)?')) {
      await clearCache();
      alert('\u041a\u044d\u0448 \u043e\u0447\u0438\u0449\u0435\u043d');
    }
  });

  // Import map
  const importBtn = document.getElementById('importMapBtn');
  const mapFileInput = document.getElementById('mapFileInput');
  importBtn?.addEventListener('click', () => mapFileInput?.click());
  mapFileInput?.addEventListener('change', async e => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await readMapFile(f);
      const map = importMap(text);
      // Stash on state so play sequence can consume it instead of running analyzer
      state.pendingImportedMap = map;
      alert(
        '\u041a\u0430\u0440\u0442\u0430 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043d\u0430: ' + map.notes.length + ' \u043d\u043e\u0442, ' +
        Math.round(map.bpm) + ' BPM\n\n' +
        '\u0422\u0435\u043f\u0435\u0440\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438 \u0430\u0443\u0434\u0438\u043e\u0444\u0430\u0439\u043b: "' +
        (map._importMeta?.fileName || '?') + '" \u2014 \u0438 \u043d\u0430\u0436\u043c\u0438 \u0418\u0433\u0440\u0430\u0442\u044c'
      );
    } catch (err) {
      alert('\u041e\u0448\u0438\u0431\u043a\u0430 \u0438\u043c\u043f\u043e\u0440\u0442\u0430: ' + err.message);
    }
    // Reset so same file can be re-imported
    mapFileInput.value = '';
  });

  // Export map (on results screen)
  const exportBtn = document.getElementById('exportMapBtn');
  exportBtn?.addEventListener('click', () => {
    if (!state.lastAnalysis) {
      alert('\u041d\u0435\u0442 \u043a\u0430\u0440\u0442\u044b \u0434\u043b\u044f \u044d\u043a\u0441\u043f\u043e\u0440\u0442\u0430');
      return;
    }
    const json = exportMap(state.lastAnalysis, {
      fileName:    state.fileName,
      fileHash:    state.fileHash,
      durationSec: state.audioBuffer?.duration || 0,
      mode:        state.mode,
      difficulty:  state.currentDifficulty,
      sens:        state.currentSens,
      hpssMode:    state.lastAnalysis?.hpssMode || 'hard',
      holdMode:    1,
    });
    const safeName = (state.fileName || 'track').replace(/[^\w.-]+/g, '_').replace(/\.[a-z0-9]+$/i, '');
    downloadMapFile(json, safeName + '.' + (state.currentDifficulty || 'normal') + '.wtmap.json');
  });
}

function renderStats() {
  const t = totalStats();
  document.getElementById('statsTotalPlays').textContent = t.plays.toLocaleString('ru-RU');
  document.getElementById('statsNotesHit').textContent = t.notesHit.toLocaleString('ru-RU');
  document.getElementById('statsPlaytime').textContent = (t.playtimeSec / 3600).toFixed(1);

  const list = document.getElementById('statsList');
  const plays = recentPlays(50);
  if (!plays.length) {
    list.innerHTML = '<div class="stats-empty">\u041f\u043e\u043a\u0430 \u043d\u0435\u0442 \u0438\u0433\u0440. \u0421\u044b\u0433\u0440\u0430\u0439 \u0447\u0442\u043e-\u043d\u0438\u0431\u0443\u0434\u044c!</div>';
    return;
  }
  let html = '<div class="stats-row header">' +
    '<span>\u0422\u0440\u0435\u043a</span>' +
    '<span>\u0421\u043b\u043e\u0436\u043d.</span>' +
    '<span class="num">Score</span>' +
    '<span class="num">Acc</span>' +
    '<span class="num">Combo</span>' +
    '<span class="num">\u0414\u0430\u0442\u0430</span>' +
    '</div>';
  for (const p of plays) {
    const c = DIFF_COLORS[p.difficulty] || DIFF_COLORS.normal;
    const d = new Date(p.date);
    const dateStr = d.getDate().toString().padStart(2, '0') + '.' +
                    (d.getMonth() + 1).toString().padStart(2, '0');
    html += '<div class="stats-row">' +
      '<span class="name" title="' + escapeHtml(p.fileName) + '">' + escapeHtml(p.fileName || '?') + '</span>' +
      '<span class="diff" style="background:' + c.bg + ';color:' + c.fg + '">' + p.difficulty.toUpperCase() + '</span>' +
      '<span class="num">' + p.score.toLocaleString('ru-RU') + '</span>' +
      '<span class="num">' + p.accuracy + '%</span>' +
      '<span class="num">' + p.maxCombo + '</span>' +
      '<span class="num">' + dateStr + '</span>' +
      '</div>';
  }
  list.innerHTML = html;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch])
  );
}
