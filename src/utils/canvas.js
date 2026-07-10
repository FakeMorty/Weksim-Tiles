// Canvas + viewport helpers.

import { RENDER } from '../config.js';
import { fxLow } from '../game/settings.js';

export const view = {
  canvas: null,
  ctx: null,
  W: 0,
  H: 0,
  DPR: Math.min(window.devicePixelRatio || 1, RENDER.DPR_MAX),
};

export function initCanvas(canvasEl) {
  view.canvas = canvasEl;
  view.ctx = canvasEl.getContext('2d', { alpha: true, desynchronized: true });
  resize();
  window.addEventListener('resize', resize);
}

// Recompute DPR — useful when user switches FX quality mid-menu.
export function refreshDPR() {
  // On low FX force DPR=1 — a 1920×1080 canvas at DPR=2 is 8.3 MP per frame,
  // which is >4× the fillRate an integrated GPU can push at 60fps.
  view.DPR = fxLow() ? 1 : Math.min(window.devicePixelRatio || 1, RENDER.DPR_MAX);
  resize();
}

export function resize() {
  const c = view.canvas;
  if (!c) return;
  view.W = window.innerWidth;
  view.H = window.innerHeight;
  // CSS size — sets what the browser renders at (logical px)
  c.style.width  = view.W + 'px';
  c.style.height = view.H + 'px';
  // Backing store size — actual pixel resolution (DPR-scaled)
  c.width  = view.W * view.DPR;
  c.height = view.H * view.DPR;
  view.ctx.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
}

export function laneMetrics() {
  const { W } = view;
  const playW = Math.min(W * RENDER.PLAY_W_RATIO, RENDER.PLAY_W_MAX);
  const left = (W - playW) / 2;
  const lw = playW / 4;
  return { playW, left, lw };
}

export function hitY() {
  return view.H * RENDER.HIT_Y_RATIO;
}

export function roundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
