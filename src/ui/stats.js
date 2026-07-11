// Etap 10: Stats screen + import/export map wiring.

import { recentPlays, totalStats, clearStats } from '../game/stats.js';
import { clearCache } from '../audio/cache.js';
import { exportMap, importMap, downloadMapFile, readMapFile } from '../audio/mapIO.js';
import { state } from '../game/state.js';
import { t, getLocale } from '../i18n/i18n.js';

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
    if (confirm(t('stats.confirmClearHistory'))) {
      clearStats();
      renderStats();
    }
  });
  clearCacheBtn?.addEventListener('click', async () => {
    if (confirm(t('stats.confirmClearCache'))) {
      await clearCache();
      alert(t('stats.cacheCleared'));
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
      alert(t('menu.importedAlert', {
        notes: map.notes.length,
        bpm: Math.round(map.bpm),
        filename: map._importMeta?.fileName || '?',
      }));
    } catch (err) {
      alert(t('menu.importError', { err: err.message }));
    }
    // Reset so same file can be re-imported
    mapFileInput.value = '';
  });

  // Export map (on results screen)
  const exportBtn = document.getElementById('exportMapBtn');
  exportBtn?.addEventListener('click', () => {
    if (!state.lastAnalysis) {
      alert(t('menu.noMapToExport'));
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

  // Etap E (v1.24): Export replay + video
  const exportReplayBtn = document.getElementById('exportReplayBtn');
  exportReplayBtn?.addEventListener('click', async () => {
    if (!state.lastReplay) {
      alert(t('menu.noReplayToExport'));
      return;
    }
    const { downloadReplay } = await import('../game/replay.js');
    const safeName = (state.fileName || 'track').replace(/[^\w.-]+/g, '_').replace(/\.[a-z0-9]+$/i, '');
    downloadReplay(state.lastReplay,
      safeName + '.' + (state.currentDifficulty || 'normal') + '.wtreplay.json');
  });

  const exportVideoBtn = document.getElementById('exportVideoBtn');
  exportVideoBtn?.addEventListener('click', async () => {
    if (!state.lastReplay) {
      alert(t('menu.noReplayToExport'));
      return;
    }
    const { startVideoExport } = await import('./videoExport.js');
    try {
      exportVideoBtn.disabled = true;
      exportVideoBtn.textContent = t('menu.videoExporting');
      await startVideoExport(state.lastReplay, (pct) => {
        exportVideoBtn.textContent = t('menu.videoExportingPct', { pct });
      });
      exportVideoBtn.textContent = '✓ ' + t('menu.videoExported');
    } catch (e) {
      console.error(e);
      alert(t('common.error') + ': ' + (e.message || e));
      exportVideoBtn.textContent = '🎬 ' + t('results.exportVideo');
    } finally {
      setTimeout(() => {
        exportVideoBtn.disabled = false;
        exportVideoBtn.textContent = '🎬 ' + t('results.exportVideo');
      }, 3500);
    }
  });
}

function renderStats() {
  const tot = totalStats();
  // Use the current locale for number formatting; falls back to 'en' on odd codes
  const nfLocale = getLocale() === 'ru' ? 'ru-RU' : getLocale();
  document.getElementById('statsTotalPlays').textContent = tot.plays.toLocaleString(nfLocale);
  document.getElementById('statsNotesHit').textContent = tot.notesHit.toLocaleString(nfLocale);
  document.getElementById('statsPlaytime').textContent = (tot.playtimeSec / 3600).toFixed(1);

  const list = document.getElementById('statsList');
  const plays = recentPlays(50);
  if (!plays.length) {
    list.innerHTML = '<div class="stats-empty">' + escapeHtml(t('stats.empty')) + '</div>';
    return;
  }
  let html = '<div class="stats-row header">' +
    '<span>' + escapeHtml(t('stats.colTrack'))  + '</span>' +
    '<span>' + escapeHtml(t('stats.colDiff'))   + '</span>' +
    '<span class="num">' + escapeHtml(t('stats.colScore')) + '</span>' +
    '<span class="num">' + escapeHtml(t('stats.colAcc'))   + '</span>' +
    '<span class="num">' + escapeHtml(t('stats.colCombo')) + '</span>' +
    '<span class="num">' + escapeHtml(t('stats.colDate'))  + '</span>' +
    '</div>';
  for (const p of plays) {
    const c = DIFF_COLORS[p.difficulty] || DIFF_COLORS.normal;
    const d = new Date(p.date);
    const dateStr = d.getDate().toString().padStart(2, '0') + '.' +
                    (d.getMonth() + 1).toString().padStart(2, '0');
    html += '<div class="stats-row">' +
      '<span class="name" title="' + escapeHtml(p.fileName) + '">' + escapeHtml(p.fileName || '?') + '</span>' +
      '<span class="diff" style="background:' + c.bg + ';color:' + c.fg + '">' + p.difficulty.toUpperCase() + '</span>' +
      '<span class="num">' + p.score.toLocaleString(nfLocale) + '</span>' +
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
