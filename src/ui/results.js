// Results overlay: rank, badges, count-up score, hit chart.

import { state } from '../game/state.js';
import { settings } from '../game/settings.js';
import { t, getLocale } from '../i18n/i18n.js';
import { letterGrade, GRADE_COLORS, isFullCombo, isAllPerfect } from '../game/grade.js';
import { drawHitChart } from './hitChart.js';
import { setErrorBarVisible } from './errorBar.js';
import { bestScoreFor } from '../game/stats.js';

export function showResults({ acc, fpsSummary }) {
  const nfLocale = getLocale() === 'ru' ? 'ru-RU' : getLocale();
  const titleEl = document.getElementById('resultTitle');
  if (titleEl) {
    titleEl.textContent = t(state.failed ? 'results.missionFailed' : 'results.missionComplete');
    titleEl.style.color = state.failed ? '#ff6a7a' : '';
  }

  const grade = letterGrade({ failed: state.failed, acc });
  const gradeEl = document.getElementById('resultGrade');
  if (gradeEl) {
    gradeEl.textContent = grade;
    gradeEl.style.color = GRADE_COLORS[grade] || '#eaffff';
    gradeEl.classList.remove('pop');
    void gradeEl.offsetWidth;
    gradeEl.classList.add('pop');
  }

  const badges = document.getElementById('resultBadges');
  if (badges) {
    const bits = [];
    if (state.failed) bits.push(badge(t('results.missionFailed'), '#ff6a7a'));
    else if (isAllPerfect(state)) bits.push(badge(t('results.allPerfect'), '#fff4a3'));
    else if (isFullCombo(state)) bits.push(badge(t('results.fullCombo'), '#7dfffa'));
    if (state.botMode) bits.push(badge(t('results.botRun'), '#c9a0ff'));
    if (settings.noFail) bits.push(badge(t('results.noFailRun'), '#7aff99'));
    badges.innerHTML = bits.join('');
  }

  const trackEl = document.getElementById('resultTrackName');
  if (trackEl) {
    const diff = (state.currentDifficulty || 'normal').toUpperCase();
    const mode = (state.mode || '').toUpperCase();
    const name = state.fileName || '—';
    trackEl.textContent = t('results.trackLine', { name, diff, mode });
  }

  animateNumber(document.getElementById('finalScore'), state.score, nfLocale);
  const score2 = document.getElementById('finalScore2');
  if (score2) score2.textContent = state.score.toLocaleString(nfLocale);

  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setTxt('finalAcc', acc + '%');
  setTxt('finalCombo', state.maxCombo);
  setTxt('finalMarvelous', state.marvelous);
  setTxt('finalPerfect', state.perfects);
  setTxt('finalGreat', state.greats);
  setTxt('finalGood', state.goods);
  setTxt('finalOk', state.oks);
  setTxt('finalHolds', state.holdsOk + ' / ' + state.holdsTotal);
  setTxt('finalMiss', state.misses);
  setTxt('finalBpm', state.currentBpm ? Math.round(state.currentBpm) : '--');
  setTxt('finalSpeed', state.fallTime.toFixed(2) + 's');

  const fpsEl = document.getElementById('finalFps');
  if (fpsEl && fpsSummary) {
    fpsEl.textContent = fpsSummary.avg + ' / ' + fpsSummary.p1 + ' / ' + fpsSummary.min;
    fpsEl.title = t('results.fpsTitle');
    fpsEl.style.color = fpsSummary.avg >= 55 ? '#7dfffa'
                     : fpsSummary.avg >= 40 ? '#ffd86a'
                     : '#ff6a7a';
  }

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

  setErrorBarVisible(false);
  document.getElementById('result').style.display = 'flex';
  setTimeout(() => drawHitChart(document.getElementById('hitChart')), 30);
}

function badge(label, color) {
  return '<span class="badge" style="color:' + color + ';border-color:' + color + '44">' + escapeHtml(label) + '</span>';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function animateNumber(el, target, locale) {
  if (!el) return;
  const fmt = n => Math.round(n).toLocaleString(locale);
  el.textContent = fmt(target);
  if (!(target > 0)) return;
  const t0 = performance.now();
  const tick = now => {
    const p = Math.min(1, (now - t0) / 650);
    el.textContent = fmt(target * (1 - (1 - p) ** 3));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
