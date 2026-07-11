// Particle system v2 — object pool + batched rendering per colour.
// Etap 7: no more push/splice churn, capped at MAX_PARTICLES.

import { state } from '../game/state.js';
import { laneMetrics, hitY } from '../utils/canvas.js';
import { fxLow, fxHigh } from '../game/settings.js';

const MAX_PARTICLES = 500;

// Pre-allocated pool. Each particle: {x,y,vx,vy,size,color,life,maxLife,alpha,gravity,shrink,active}
const pool = new Array(MAX_PARTICLES);
for (let i = 0; i < MAX_PARTICLES; i++) {
  pool[i] = { x:0, y:0, vx:0, vy:0, size:0, color:'#fff', life:0, maxLife:0, alpha:1, gravity:440, shrink:0, active:false };
}

// Expose active list to renderer (renderer already reads state.particles — we
// keep the same reference for compatibility, but now it's a stable pool slice).
let cursor = 0;

function acquire() {
  // Round-robin — oldest gets evicted if pool is full.
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const idx = (cursor + i) % MAX_PARTICLES;
    const p = pool[idx];
    if (!p.active) {
      cursor = (idx + 1) % MAX_PARTICLES;
      return p;
    }
  }
  // All active → evict oldest (cursor)
  const p = pool[cursor];
  cursor = (cursor + 1) % MAX_PARTICLES;
  return p;
}

export function spawnHitParticles(lane, isHold, tier = 'PERFECT') {
  const { left, lw } = laneMetrics();
  const cx = left + lane * lw + lw / 2;
  const cy = hitY();
  const bigTier = tier === 'MARVELOUS' || tier === 'PERFECT';
  const colors = isHold
    ? ['#ffc8ff', '#ffc8ff', '#ffd8ff', '#ffbaff']
    : bigTier
      ? ['#ffffff', '#7dfffa', '#c8fff8', '#eaffff']
      : ['#6ef6ff', '#8affc4', '#ffe17a', '#ff7adf'];
  // Cut particle counts on low FX so weak GPUs breathe.
  const scale = fxLow() ? 0.35 : (fxHigh() ? 1 : 0.65);
  const count = Math.max(4, Math.floor((isHold ? 22 : bigTier ? 22 : 14) * scale));
  const baseSpeed = isHold ? 190 : bigTier ? 220 : 160;
  for (let i = 0; i < count; i++) {
    const p = acquire();
    const ang = (Math.PI * 2 * i / count) + Math.random() * 0.4;
    const sp = baseSpeed + Math.random() * 220;
    p.active = true;
    p.x = cx; p.y = cy;
    p.vx = Math.cos(ang) * sp;
    p.vy = Math.sin(ang) * sp - 70;
    p.size = 2 + Math.random() * (isHold ? 3.2 : bigTier ? 3 : 2.4);
    p.color = colors[i % colors.length];
    p.life = 0.5 + Math.random() * 0.38;
    p.maxLife = 0.88;
    p.gravity = 440;
    p.shrink = 0;
    p.alpha = 1;
  }
}

export function spawnTickParticle(lane) {
  const { left, lw } = laneMetrics();
  const p = acquire();
  p.active = true;
  p.x = left + lane * lw + lw / 2 + (Math.random() - 0.5) * 18;
  p.y = hitY() - Math.random() * 22;
  p.vx = (Math.random() - 0.5) * 40;
  p.vy = -80 - Math.random() * 60;
  p.size = 1.8 + Math.random() * 1.5;
  p.color = '#ffdfff';
  p.life = 0.33; p.maxLife = 0.33;
  p.gravity = 440; p.shrink = 0; p.alpha = 1;
}

export function spawnMissParticles(lane) {
  const { left, lw } = laneMetrics();
  const cx = left + lane * lw + lw / 2;
  const cy = hitY() + 6;
  for (let i = 0; i < 9; i++) {
    const p = acquire();
    p.active = true;
    p.x = cx + (Math.random() - 0.5) * 20; p.y = cy;
    p.vx = (Math.random() - 0.5) * 100;
    p.vy = -25 - Math.random() * 55;
    p.size = 2.2;
    p.color = '#ff5a6a';
    p.life = 0.44; p.maxLife = 0.44;
    p.gravity = 440; p.shrink = 0; p.alpha = 1;
  }
}

// Ring shockwave for MARVELOUS taps.
export function spawnShockwave(lane, color = '#fff4a3') {
  const { left, lw } = laneMetrics();
  const cx = left + lane * lw + lw / 2;
  const cy = hitY();
  const count = 32;
  for (let i = 0; i < count; i++) {
    const p = acquire();
    p.active = true;
    const ang = (Math.PI * 2 * i / count);
    const sp = 340 + Math.random() * 60;
    p.x = cx; p.y = cy;
    p.vx = Math.cos(ang) * sp;
    p.vy = Math.sin(ang) * sp;
    p.size = 3.5;
    p.color = color;
    p.life = 0.35; p.maxLife = 0.35;
    p.gravity = 0;        // ring stays flat
    p.shrink = 6;         // shrink over lifetime
    p.alpha = 1;
  }
}

// Update + batched render. Renderer calls renderParticles(ctx, dt) instead of
// iterating state.particles directly.
//
// v1.24.5: recycle the bucket Map + arrays instead of allocating per frame.
// GC churn was the biggest hidden cost on dense trails (500 particles × 60fps
// = 30 000 Map/array allocations per second → periodic ~5-8ms hitches).
const _bucketMap = new Map();
const _bucketArrays = new Map(); // color → reusable array

export function updateAndRenderParticles(ctx, dt) {
  // Update
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const p = pool[i];
    if (!p.active) continue;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += p.gravity * dt;
    p.life -= dt;
    if (p.shrink) p.size = Math.max(0.3, p.size - p.shrink * dt);
    p.alpha = Math.max(0, p.life / p.maxLife);
    if (p.life <= 0) p.active = false;
  }

  // Reset bucket lengths (keep arrays, avoid GC)
  for (const arr of _bucketArrays.values()) arr.length = 0;
  _bucketMap.clear();

  for (let i = 0; i < MAX_PARTICLES; i++) {
    const p = pool[i];
    if (!p.active) continue;
    let arr = _bucketMap.get(p.color);
    if (!arr) {
      arr = _bucketArrays.get(p.color);
      if (!arr) { arr = []; _bucketArrays.set(p.color, arr); }
      _bucketMap.set(p.color, arr);
    }
    arr.push(p);
  }

  // v1.24.5: particle glow only on high FX (was on medium too — expensive).
  const useGlow = fxHigh();
  for (const [color, arr] of _bucketMap) {
    if (arr.length === 0) continue;
    ctx.save();
    ctx.fillStyle = color;
    if (useGlow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
    }
    for (let k = 0; k < arr.length; k++) {
      const p = arr[k];
      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

export function activeParticleCount() {
  let n = 0;
  for (let i = 0; i < MAX_PARTICLES; i++) if (pool[i].active) n++;
  return n;
}

export function resetParticles() {
  for (let i = 0; i < MAX_PARTICLES; i++) pool[i].active = false;
  cursor = 0;
  // Legacy: also clear state.particles if anything still touches it
  state.particles.length = 0;
}
