// Draws a hit-offset histogram on the results screen.
// Positive offset = late tap, negative = early. Shows early/late bias.

import { hitOffsets } from '../game/judge.js';
import { JUDGE } from '../config.js';
import { judgeMultiplier } from '../game/calibration.js';
import { t } from '../i18n/i18n.js';

export function drawHitChart(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const rangeMs = 250; // ±250 ms
  const bins = 25;     // 20 ms per bin
  const binWidth = W / bins;
  const hist = new Array(bins).fill(0);

  for (const off of hitOffsets) {
    if (off < -rangeMs || off > rangeMs) continue;
    const idx = Math.floor(((off + rangeMs) / (2 * rangeMs)) * bins);
    if (idx >= 0 && idx < bins) hist[idx]++;
  }

  const maxCount = Math.max(1, ...hist);
  const centerX = W / 2;
  const mult = judgeMultiplier();

  // Judge window bands (colour-coded)
  const bands = [
    { w: JUDGE.MARVELOUS * mult, color: '#fff4a344' },
    { w: JUDGE.PERFECT   * mult, color: '#7dfffa33' },
    { w: JUDGE.GREAT     * mult, color: '#7aff9926' },
    { w: JUDGE.GOOD      * mult, color: '#ffb06622' },
    { w: JUDGE.OK        * mult, color: '#ffd86a1c' },
  ].reverse(); // draw widest first so narrower show on top
  for (const b of bands) {
    const px = (b.w * 1000 / rangeMs) * (W / 2);
    ctx.fillStyle = b.color;
    ctx.fillRect(centerX - px, 0, px * 2, H);
  }

  // Center line
  ctx.strokeStyle = '#7efaff';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(centerX, 0); ctx.lineTo(centerX, H); ctx.stroke();
  ctx.setLineDash([]);

  // Bars
  for (let i = 0; i < bins; i++) {
    const h = (hist[i] / maxCount) * (H - 20);
    const x = i * binWidth + 1;
    const y = H - h;
    // Colour: distance from center
    const off = ((i + 0.5) / bins) * 2 * rangeMs - rangeMs;
    const abs = Math.abs(off) / 1000;
    let color = '#ff5566';
    if (abs <= JUDGE.MARVELOUS * mult) color = '#fff4a3';
    else if (abs <= JUDGE.PERFECT * mult) color = '#7dfffa';
    else if (abs <= JUDGE.GREAT * mult) color = '#7aff99';
    else if (abs <= JUDGE.GOOD * mult) color = '#ffb066';
    else if (abs <= JUDGE.OK * mult) color = '#ffd86a';
    ctx.fillStyle = color;
    ctx.fillRect(x, y, binWidth - 2, h);
  }

  // Axis labels
  ctx.fillStyle = '#5a89a6';
  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';  ctx.fillText(t('results.early', { ms: '-' + rangeMs }), 4, H - 12);
  ctx.textAlign = 'right'; ctx.fillText(t('results.late',  { ms: '+' + rangeMs }), W - 4, H - 12);
  ctx.textAlign = 'center';

  // Mean/median summary
  if (hitOffsets.length >= 3) {
    const sorted = [...hitOffsets].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const mean = hitOffsets.reduce((a, b) => a + b, 0) / hitOffsets.length;
    const std = Math.sqrt(hitOffsets.reduce((s, v) => s + (v - mean) ** 2, 0) / hitOffsets.length);
    const hint = median > 15  ? t('results.hintMedianLate',  { ms: Math.round(median) })
               : median < -15 ? t('results.hintMedianEarly', { ms: Math.round(median) })
               :                t('results.hintMedianGood');
    ctx.fillStyle = '#aee9ff';
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(t('results.medianLine', {
      median: median.toFixed(0),
      std: std.toFixed(0),
      hint,
    }), W / 2, 4);
  }
}
