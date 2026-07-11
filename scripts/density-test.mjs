import { limitDensity } from '../src/audio/density.js';

// 100 events over 10 seconds = 10 nps average. Cap at 4 nps.
const events = [];
for (let i = 0; i < 100; i++) {
  events.push({ time: i * 0.1, strength: Math.random(), isHold: false });
}
const filtered = limitDensity(events, 4);
console.log(`Input: ${events.length} events over 10s (10 nps)`);
console.log(`Output: ${filtered.length} events (target ≤40)`);
console.log(`Actual density: ${(filtered.length / 10).toFixed(1)} nps`);

// Verify no 1s window has more than 4
let maxInWindow = 0;
for (let i = 0; i < filtered.length; i++) {
  let cnt = 0;
  for (let j = i; j < filtered.length; j++) {
    if (filtered[j].time - filtered[i].time > 1.0) break;
    cnt++;
  }
  if (cnt > maxInWindow) maxInWindow = cnt;
}
console.log(`Max notes in any 1s window: ${maxInWindow}  ${maxInWindow <= 4 ? '✓' : '✗ FAIL'}`);
