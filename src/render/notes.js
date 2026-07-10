// Note head + hold cap drawing primitives.

import { LANE_COLORS } from '../config.js';

export function drawHead(ctx, x, y, size, lane, isHold, holding) {
  ctx.save(); ctx.translate(x, y);
  // Etap 7: brighter neon glow, slightly stronger when holding
  ctx.shadowColor = isHold ? '#ff77ff' : (lane % 2 === 0 ? '#00f0ff' : '#b14bff');
  ctx.shadowBlur = holding ? 34 : 24;
  const col = isHold
    ? (holding ? '#ffb3ff' : '#d68fff')
    : LANE_COLORS[lane];
  ctx.fillStyle = col;
  ctx.beginPath();
  const r = size * 0.56;
  const sides = isHold ? 4 : 6;
  const rot = isHold ? Math.PI / 4 : -Math.PI / 2;
  for (let k = 0; k < sides; k++) {
    const ang = (Math.PI * 2 / sides) * k + rot;
    const px = Math.cos(ang) * r, py = Math.sin(ang) * r;
    if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.30)';
  ctx.beginPath(); ctx.arc(0, 0, r * 0.40, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#00131a';
  ctx.font = 'bold 12px "JetBrains Mono", monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const labels = ['D', 'F', 'J', 'K'];
  ctx.fillText(isHold ? 'H' : labels[lane], 0, 1);
  ctx.restore();
}

export function drawHoldCap(ctx, x, y, lane, isTail, holding) {
  ctx.save(); ctx.translate(x, y);
  ctx.shadowColor = holding ? '#ff9dff' : '#6efaff';
  ctx.shadowBlur = 16;
  ctx.fillStyle = holding ? '#ffc8ff' : '#9efbff';
  ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#041626';
  ctx.font = 'bold 9px "JetBrains Mono",monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(isTail ? '\u25c6' : '', 0, 1);
  ctx.restore();
}
