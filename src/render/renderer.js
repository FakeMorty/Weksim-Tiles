// Main renderer with camera transform, lane/hit-line flashes, chromatic
// aberration on high combos, batched particle rendering.

import { state } from '../game/state.js';
import { view, laneMetrics, hitY, roundRect } from '../utils/canvas.js';
import { drawHead, drawHoldCap } from './notes.js';
import { LANES } from '../config.js';
import { camera, updateCamera, applyCameraTransform } from './camera.js';
import { getFlashState, updateFlashes } from '../fx/flash.js';
import { updateAndRenderParticles } from '../fx/particles.js';
import { fxHigh, fxLow } from '../game/settings.js';

export function render(t, dt) {
  const { ctx, W, H } = view;
  const flash = getFlashState();
  updateCamera(dt);
  updateFlashes(dt);

  ctx.clearRect(0, 0, W, H);

  // Draw background grid (outside camera transform so it stays fixed = subtle parallax feel)
  ctx.save(); ctx.globalAlpha = 0.07;
  for (let y = 0; y < H; y += 46) { ctx.fillStyle = '#0c1c3a'; ctx.fillRect(0, y, W, 1); }
  ctx.restore();

  // Chromatic aberration only on 'high' quality — it triples render cost.
  const ab = flash.aberration;
  if (ab > 0.02 && fxHigh()) {
    renderScene(ctx, t, dt, -ab * 4, 0, 'rgba(255,60,120,0.7)');
    renderScene(ctx, t, dt,  ab * 4, 0, 'rgba(60,220,255,0.7)');
    renderScene(ctx, t, dt, 0, 0, null); // main pass on top
  } else {
    renderScene(ctx, t, dt, 0, 0, null);
  }

  // Screen flash (post overlay)
  if (flash.screen > 0.01) {
    ctx.save();
    ctx.globalAlpha = flash.screen;
    ctx.fillStyle = flash.screenColor;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

function renderScene(ctx, t, dt, shiftX, shiftY, tint) {
  const { W, H } = view;
  const flash = getFlashState();

  ctx.save();
  applyCameraTransform(ctx, W, H);
  if (shiftX || shiftY) ctx.translate(shiftX, shiftY);
  if (tint) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.4;
  }

  const { playW, left, lw } = laneMetrics();
  const hy = hitY();

  // Lanes
  for (let i = 0; i < LANES; i++) {
    const x = left + i * lw;
    const grad = ctx.createLinearGradient(x, 0, x, H);
    grad.addColorStop(0, 'rgba(8,18,42,0.22)');
    grad.addColorStop(1, 'rgba(10,24,54,0.52)');
    ctx.fillStyle = grad;
    ctx.fillRect(x + 1, 0, lw - 2, H);

    // Auto-fire beam
    if (state.beams[i] > 0.05) {
      ctx.save();
      ctx.globalAlpha = 0.13 + state.beams[i] * 0.26;
      const bx = x + lw / 2;
      const beamGrad = ctx.createLinearGradient(bx, hy, bx, 0);
      beamGrad.addColorStop(0, '#c9ffff');
      beamGrad.addColorStop(1, 'rgba(120,80,255,0)');
      ctx.fillStyle = beamGrad;
      ctx.fillRect(bx - lw * 0.18, 0, lw * 0.36, hy);
      ctx.restore();
    }

    // Lane border + hit flash tint
    const laneFlashV = flash.laneFlash[i];
    const laneFlashC = flash.laneFlashColor[i];
    if (laneFlashV > 0.02) {
      ctx.save();
      ctx.globalAlpha = laneFlashV * 0.28;
      ctx.fillStyle = laneFlashC;
      ctx.fillRect(x + 2, 0, lw - 4, hy);
      ctx.restore();
    }

    ctx.strokeStyle = laneFlashV > 0.15 ? laneFlashC
      : (state.flashes[i] > 0 ? '#eaffff' : (state.keysDown[i] ? '#7ad8ff' : '#143459'));
    ctx.lineWidth = laneFlashV > 0.15 ? 2.4 + laneFlashV * 1.5
      : (state.flashes[i] > 0 ? 2.4 : (state.keysDown[i] ? 1.8 : 1.2));
    ctx.globalAlpha = 0.95;
    ctx.beginPath(); ctx.moveTo(x, 0);      ctx.lineTo(x, H);      ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + lw, 0); ctx.lineTo(x + lw, H); ctx.stroke();
    ctx.globalAlpha = 1;
    if (state.flashes[i] > 0) state.flashes[i] -= dt * 4;
  }

  ctx.strokeStyle = '#2a5d88'; ctx.lineWidth = 1.4; ctx.strokeRect(left, 0, playW, H);

  // Hit line (with flash-driven glow)
  const hitFlash = flash.hitLine;
  ctx.save();
  ctx.shadowColor = hitFlash > 0.05 ? flash.hitLineColor : '#00f0ff';
  ctx.shadowBlur = 20 + hitFlash * 40;
  ctx.strokeStyle = hitFlash > 0.05 ? flash.hitLineColor : '#9ffaff';
  ctx.lineWidth = 2.6 + hitFlash * 2.5;
  ctx.beginPath(); ctx.moveTo(left, hy); ctx.lineTo(left + playW, hy); ctx.stroke();
  ctx.shadowBlur = 0;
  const bandAlpha = 0.045 + hitFlash * 0.22;
  ctx.fillStyle = hitFlash > 0.05
    ? hexToRgba(flash.hitLineColor, bandAlpha)
    : 'rgba(0,240,255,0.045)';
  ctx.fillRect(left, hy - 36, playW, 56);
  ctx.restore();

  // Notes: because state.notes is sorted by time (analyzer guarantees), we
  // scan a narrow window instead of filtering the entire list every frame.
  // This turns O(N) per frame into O(k) where k = notes on screen (~20).
  const winStart = t - 0.4;
  const winEnd   = t + state.fallTime + 0.25;
  const notes = state.notes;
  let i0 = state._notesCursor || 0;
  while (i0 < notes.length && (notes[i0].endTime ?? notes[i0].time) < winStart) i0++;
  state._notesCursor = i0;

  for (let ni = i0; ni < notes.length; ni++) {
    const n = notes[ni];
    if (n.time > winEnd) break;
    if (n.judged && !n.holding) continue;
    const timeToHead = n.time - t;
    const timeToTail = n.isHold ? (n.endTime - t) : timeToHead;
    if (timeToTail < -0.4 || timeToHead > state.fallTime + 0.25) continue;

    const progressHead = 1 - (timeToHead / state.fallTime);
    const yHead = 44 + progressHead * (hy - 74);
    const x = left + n.lane * lw + lw / 2;

    if (n.isHold) {
      const progressTail = 1 - (timeToTail / state.fallTime);
      const yTail = 44 + progressTail * (hy - 74);
      const barW = Math.max(22, lw * 0.52);
      const topY = Math.min(yHead, yTail);
      const botY = Math.max(yHead, yTail);
      ctx.save();
      ctx.shadowColor = n.holding ? '#ff9dff' : '#5eefff';
      ctx.shadowBlur = n.holding ? 24 : 14;
      // Tail gradient (Etap 7)
      const tailGrad = ctx.createLinearGradient(x, topY, x, botY);
      if (n.holding) {
        tailGrad.addColorStop(0, 'rgba(210,120,255,0.55)');
        tailGrad.addColorStop(1, 'rgba(255,180,255,0.15)');
      } else {
        tailGrad.addColorStop(0, 'rgba(60,220,255,0.35)');
        tailGrad.addColorStop(1, 'rgba(60,220,255,0.10)');
      }
      ctx.fillStyle = tailGrad;
      roundRect(ctx, x - barW / 2, topY, barW, Math.max(28, botY - topY), 10);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = n.holding ? '#f0c8ff' : '#9efbff';
      ctx.globalAlpha = 0.9;
      roundRect(ctx, x - 3, topY, 6, Math.max(18, botY - topY), 3);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();

      if (n.holding) {
        const prog = n.holdProgress || 0;
        const fillH = (botY - topY) * prog;
        ctx.save();
        ctx.globalAlpha = 0.48;
        ctx.fillStyle = '#ffffff';
        roundRect(ctx, x - barW / 2 + 2, botY - fillH, barW - 4, fillH, 8);
        ctx.fill();
        ctx.restore();
      }
      drawHoldCap(ctx, x, yTail, n.lane, true, n.holding);
    }

    const size = n.isHold ? 34 : 30 + Math.min(9, progressHead * 6);
    // Approach ring
    if (timeToHead > 0 && timeToHead < 0.48) {
      const approach = timeToHead / 0.48;
      ctx.save();
      ctx.globalAlpha = 0.16 + (1 - approach) * 0.22;
      ctx.strokeStyle = n.isHold ? '#ff9dff' : '#66f7ff';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(x, yHead, size * 0.95 + (1 - approach) * 20, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    drawHead(ctx, x, yHead, size, n.lane, n.isHold, n.holding);
  }

  // Bullets
  for (let i = state.bullets.length - 1; i >= 0; i--) {
    const b = state.bullets[i];
    b.y += b.vy * dt;
    b.life -= dt;
    ctx.save();
    ctx.shadowColor = b.hold ? '#ffb5ff' : '#aefaff';
    ctx.shadowBlur  = b.hold ? 18 : 13;
    ctx.fillStyle   = b.hold ? '#ffe9ff' : '#eaffff';
    ctx.beginPath(); ctx.arc(left + b.lane * lw + lw / 2, b.y, b.hold ? 5.2 : 4.3, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.3;
    ctx.fillRect(left + b.lane * lw + lw / 2 - 1, b.y, 2, b.hold ? 34 : 22);
    ctx.restore();
    if (b.life <= 0 || b.y < -30) state.bullets.splice(i, 1);
  }

  // Particles (batched pool, Etap 7)
  updateAndRenderParticles(ctx, dt);

  // Lane bases / turrets
  for (let i = 0; i < LANES; i++) {
    const cx = left + i * lw + lw / 2;
    const cy = hy + 35;
    ctx.save();
    const isBeam = state.beams[i] > 0.15;
    const laneF = flash.laneFlash[i];
    ctx.shadowColor = laneF > 0.2 ? flash.laneFlashColor[i]
      : (isBeam ? '#ff9dff' : (state.flashes[i] > 0 ? '#ffffff' : '#00c8ff'));
    ctx.shadowBlur = laneF > 0.2 ? 24 + laneF * 20
      : (isBeam ? 26 : (state.flashes[i] > 0 ? 22 : 10));
    ctx.fillStyle   = isBeam ? '#2a0f3a' : '#081d34';
    ctx.strokeStyle = laneF > 0.2 ? flash.laneFlashColor[i] : (isBeam ? '#ffb8ff' : '#4fd8ff');
    ctx.lineWidth = 2 + laneF * 1.5;
    roundRect(ctx, cx - 30, cy - 16, 60, 20, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = isBeam ? '#4a1a66' : '#0f2d52';
    ctx.fillRect(cx - 6, hy + 2, 12, 34);
    if (isBeam) {
      ctx.shadowColor = '#ff9dff'; ctx.shadowBlur = 18;
      ctx.fillStyle = '#ffeaff';
      ctx.beginPath(); ctx.arc(cx, hy + 1, 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  ctx.restore(); // camera transform
}

function hexToRgba(hex, alpha) {
  // Accept #rrggbb, #rgb, or already-formatted rgba
  if (hex.startsWith('rgba') || hex.startsWith('rgb')) return hex;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
