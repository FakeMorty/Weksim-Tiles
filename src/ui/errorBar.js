// Live early/late tick strip shown above the hit line during play.

import { JUDGE } from '../config.js';
import { judgeMultiplier } from '../game/calibration.js';

const ticks = [];
const RANGE = 200; // ±ms

export function resetErrorBar() {
  ticks.length = 0;
  drawErrorBar();
}

export function pushErrorTick(ms) {
  ticks.push(ms);
  if (ticks.length > 48) ticks.shift();
  drawErrorBar();
}

export function setErrorBarVisible(on) {
  const wrap = document.getElementById('errorBarWrap');
  if (wrap) wrap.style.display = on ? 'block' : 'none';
  if (on) drawErrorBar();
}

export function drawErrorBar() {
  const canvas = document.getElementById('errorBarCanvas');
  if (!canvas) return;
  const cssW = Math.max(220, canvas.clientWidth || 320);
  const cssH = 36;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cssW, H = cssH;
  ctx.clearRect(0, 0, W, H);

  const mid = W / 2;
  const mult = judgeMultiplier();
  const bands = [
    { w: JUDGE.OK * mult,        color: 'rgba(255,216,106,0.12)' },
    { w: JUDGE.GOOD * mult,      color: 'rgba(255,176,102,0.14)' },
    { w: JUDGE.GREAT * mult,     color: 'rgba(122,255,153,0.16)' },
    { w: JUDGE.PERFECT * mult,   color: 'rgba(125,255,250,0.20)' },
    { w: JUDGE.MARVELOUS * mult, color: 'rgba(255,244,163,0.28)' },
  ];
  for (const b of bands) {
    const px = (b.w * 1000 / RANGE) * (W / 2);
    ctx.fillStyle = b.color;
    ctx.fillRect(mid - px, 8, px * 2, H - 16);
  }

  ctx.strokeStyle = 'rgba(126,250,255,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(mid, 6);
  ctx.lineTo(mid, H - 6);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(90,137,166,0.5)';
  ctx.beginPath();
  ctx.moveTo(10, H / 2);
  ctx.lineTo(W - 10, H / 2);
  ctx.stroke();

  for (let i = 0; i < ticks.length; i++) {
    const ms = ticks[i];
    const x = mid + (ms / RANGE) * (W / 2 - 10);
    const alpha = 0.25 + 0.75 * (i / Math.max(1, ticks.length - 1));
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#eaffff';
    ctx.fillRect(x - 1, 7, 2, H - 14);
  }
  ctx.globalAlpha = 1;
}
