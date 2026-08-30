// Map preview overlay shown after analysis, before play.

import { state } from '../game/state.js';
import { LANE_COLORS } from '../config.js';
import { t } from '../i18n/i18n.js';
import { startPlay } from '../game/loop.js';

let pendingBot = false;

export function bindPreview() {
  document.getElementById('previewPlayBtn')?.addEventListener('click', () => {
    hidePreview();
    state.botMode = pendingBot;
    startPlay();
  });
  document.getElementById('previewBotBtn')?.addEventListener('click', () => {
    hidePreview();
    state.botMode = true;
    startPlay();
  });
  document.getElementById('previewBackBtn')?.addEventListener('click', () => {
    hidePreview();
    document.getElementById('menu').style.display = 'flex';
  });
  document.getElementById('previewCanvas')?.addEventListener('click', () => {
    if (!document.getElementById('previewOverlay')?.classList.contains('active')) return;
    document.getElementById('previewPlayBtn')?.click();
  });
  window.addEventListener('keydown', e => {
    if (!document.getElementById('previewOverlay')?.classList.contains('active')) return;
    if (e.repeat) return;
    if (e.code === 'Space' || e.code === 'Enter') {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      document.getElementById('previewPlayBtn')?.click();
    }
  });
  window.addEventListener('resize', () => {
    if (!document.getElementById('previewOverlay')?.classList.contains('active')) return;
    const canvas = document.getElementById('previewCanvas');
    if (canvas) {
      drawPreview(canvas, state.notes, state.audioBuffer?.duration || 1, state.currentBpm);
    }
  });
}

export function showPreview({ bot = false } = {}) {
  pendingBot = !!bot;
  const overlay = document.getElementById('previewOverlay');
  if (!overlay) {
    state.botMode = pendingBot;
    startPlay();
    return;
  }
  document.getElementById('menu').style.display = 'none';
  overlay.classList.add('active');

  const nameEl = document.getElementById('previewTrackName');
  if (nameEl) nameEl.textContent = state.fileName || '—';

  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  const n = state.notes.length;
  const holds = state.holdsTotal || state.notes.filter(x => x.isHold).length;
  const dur = state.audioBuffer?.duration || 1;
  const density = (n / dur).toFixed(1);
  set('previewNotes', t('menu.previewNotes', { n }));
  set('previewHolds', t('menu.previewHolds', { n: holds }));
  set('previewDensity', t('menu.previewDensity', { n: density }));
  set('previewBpm', state.currentBpm ? t('hud.bpmValue', { bpm: Math.round(state.currentBpm) }) : '—');

  const playBtn = document.getElementById('previewPlayBtn');
  if (playBtn) playBtn.textContent = t(pendingBot ? 'menu.libraryBot' : 'menu.previewPlay');

  const canvas = document.getElementById('previewCanvas');
  if (canvas) drawPreview(canvas, state.notes, dur, state.currentBpm);
}

export function hidePreview() {
  document.getElementById('previewOverlay')?.classList.remove('active');
}

function drawPreview(canvas, notes, duration, bpm) {
  canvas.style.width = 'min(640px, 90vw)';
  canvas.style.height = '176px';
  const cssW = Math.max(280, canvas.clientWidth || 640);
  const cssH = 176;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cssW, H = cssH;
  ctx.fillStyle = '#050b1a';
  ctx.fillRect(0, 0, W, H);

  const dur = Math.max(duration || 1, 1);
  const axisH = 16;
  const playH = H - axisH;
  const laneH = playH / 4;

  drawWaveform(ctx, state.audioBuffer, W, playH);

  if (bpm > 40) {
    const bar = 60 / bpm * 4;
    ctx.strokeStyle = 'rgba(126,250,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let t = 0; t < dur; t += bar) {
      const x = (t / dur) * W;
      ctx.moveTo(x, 0); ctx.lineTo(x, playH);
    }
    ctx.stroke();
  }

  for (let i = 1; i < 4; i++) {
    ctx.fillStyle = 'rgba(20,52,89,0.5)';
    ctx.fillRect(0, i * laneH, W, 1);
  }

  for (const n of notes) {
    const x = (n.time / dur) * W;
    const y = n.lane * laneH + laneH * 0.22;
    const h = laneH * 0.56;
    const col = LANE_COLORS[n.lane] || '#7efaff';
    if (n.isHold) {
      const w = Math.max(3, ((n.endTime - n.time) / dur) * W);
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = col;
      ctx.fillRect(x, y + 1, Math.max(2, 2.2), h - 2);
    }
  }

  ctx.fillStyle = '#06101e';
  ctx.fillRect(0, playH, W, axisH);
  ctx.fillStyle = '#5a89a6';
  ctx.font = '10px ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  const step = dur > 90 ? 15 : dur > 40 ? 10 : 5;
  for (let t = 0; t <= dur + 0.01; t += step) {
    const x = (t / dur) * W;
    ctx.fillStyle = '#1a3458';
    ctx.fillRect(x, playH, 1, 4);
    ctx.fillStyle = '#5a89a6';
    const label = Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
    ctx.fillText(label, Math.min(W - 28, x + 2), playH + axisH / 2);
  }
}

function drawWaveform(ctx, buffer, W, H) {
  if (!buffer || !buffer.length) return;
  const ch = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(ch.length / W));
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < W; x++) {
    let min = 1, max = -1;
    const start = x * step;
    for (let i = 0; i < step && start + i < ch.length; i++) {
      const v = ch[start + i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const y0 = H / 2 + min * H * 0.42;
    const y1 = H / 2 + max * H * 0.42;
    ctx.moveTo(x + 0.5, y0);
    ctx.lineTo(x + 0.5, y1);
  }
  ctx.stroke();
}
