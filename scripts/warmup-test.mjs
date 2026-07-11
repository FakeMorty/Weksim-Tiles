// Test Etap E warmup / count-in scheduling.
//
// Uses an OfflineAudioContext to render a few seconds and inspect that
// clicks land at the right sample positions.

import { scheduleCountIn } from '../src/game/warmup.js';

let pass = 0, fail = 0;
function check(name, cond, msg) {
  if (cond) { console.log('PASS ' + name); pass++; }
  else { console.log('FAIL ' + name + (msg ? ' — ' + msg : '')); fail++; }
}

// OfflineAudioContext isn't in bare Node — we mock the parts scheduleCountIn touches.
function mockCtx() {
  const scheduled = [];
  return {
    scheduled,
    createOscillator() {
      const o = { frequency: { value: 0 }, type: 'sine',
        connect() {}, start(at) { scheduled.push({ kind: 'osc', at, freq: this.frequency.value }); },
        stop() {} };
      return o;
    },
    createGain() {
      return { gain: {
        setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {},
      }, connect() {} };
    },
  };
}

// --- Test 1: 4-beat count-in at 120 BPM ---
{
  const ctx = mockCtx();
  const start = 5.0;
  const bpm = 120; // 0.5s per beat
  const songStart = scheduleCountIn(ctx, {}, bpm, start, 0.3, 4);
  check('song start is 4 beats after count-in start',
        Math.abs(songStart - (start + 4 * 0.5)) < 0.001,
        `got ${songStart}`);
  check('4 clicks scheduled', ctx.scheduled.filter(s => s.kind === 'osc').length === 4);

  const times = ctx.scheduled.filter(s => s.kind === 'osc').map(s => s.at);
  check('clicks evenly spaced at 0.5s', times.every((t, i) => i === 0 || Math.abs((t - times[i-1]) - 0.5) < 0.001));

  const freqs = ctx.scheduled.filter(s => s.kind === 'osc').map(s => s.freq);
  check('downbeats higher pitch (1000Hz)', freqs[0] === 1000 && freqs[2] === 1000);
  check('offbeats lower pitch (700Hz)',    freqs[1] === 700  && freqs[3] === 700);
}

// --- Test 2: bpm safety fallback ---
{
  const ctx = mockCtx();
  const songStart = scheduleCountIn(ctx, {}, 0, 0, 0.3, 4);
  // 0 BPM should be clamped to 120 → 4 * 0.5 = 2s
  check('bpm=0 falls back to 120', Math.abs(songStart - 2.0) < 0.001);
}

// --- Test 3: custom beat count ---
{
  const ctx = mockCtx();
  scheduleCountIn(ctx, {}, 100, 0, 0.3, 8);
  const clicks = ctx.scheduled.filter(s => s.kind === 'osc');
  check('8 beats produce 8 clicks', clicks.length === 8);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
