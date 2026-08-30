// Built-in 16-bar demo loop (128 BPM) so the game is playable without a file.
// Deterministic PCM — same bytes every time, so analysis cache stays valid.

import { mulberry32 } from '../utils/rng.js';

export const DEMO_BPM = 128;
export const DEMO_NAME = 'Neon Pulse (demo).wav';

export function synthesizeDemoPcm(sr = 44100) {
  const rng = mulberry32(0x4E0F1A7);
  const bpm = DEMO_BPM;
  const beat = 60 / bpm;
  const nBeats = 64; // 16 bars
  const dur = nBeats * beat + 0.6;
  const n = Math.floor(dur * sr);
  const pcm = new Float32Array(n);

  const kickTs = [];
  const snareTs = [];
  const hatTs = [];
  const bassTs = [];
  const leadTs = [];

  for (let b = 0; b < nBeats; b++) {
    const t = 0.4 + b * beat;
    const bar = Math.floor(b / 4);
    const beatInBar = b % 4;
    // Kick on 1 and 3, extra kick in later bars
    if (beatInBar === 0 || beatInBar === 2) kickTs.push(t);
    if (bar >= 12 && beatInBar === 3) kickTs.push(t + beat * 0.5);
    // Snare on 2 and 4
    if (beatInBar === 1 || beatInBar === 3) snareTs.push(t);
    // Hats on 8ths, 16ths in the drop
    hatTs.push(t);
    hatTs.push(t + beat * 0.5);
    if (bar >= 8) {
      hatTs.push(t + beat * 0.25);
      hatTs.push(t + beat * 0.75);
    }
    // Bass from bar 4
    if (bar >= 4 && (beatInBar === 0 || beatInBar === 2)) bassTs.push({ t, bar, beatInBar });
    // Lead from bar 8
    if (bar >= 8) leadTs.push({ t, bar, beatInBar });
  }

  for (const t of kickTs) addKick(pcm, sr, t, 0.95);
  for (const t of snareTs) addSnare(pcm, sr, t, 0.55, rng);
  for (const t of hatTs) addHat(pcm, sr, t, 0.18, rng);
  const bassFreqs = [55, 55, 73.4, 82.4]; // A1 A1 D2 E2 cycling per bar-pair
  for (const ev of bassTs) {
    const f = bassFreqs[Math.floor(ev.bar / 2) % bassFreqs.length];
    addTone(pcm, sr, ev.t, f, 0.28, 0.22);
  }
  const leadScale = [220, 246.9, 261.6, 293.7, 329.6, 392.0]; // A minor-ish
  for (const ev of leadTs) {
    const note = leadScale[(ev.bar * 3 + ev.beatInBar * 2) % leadScale.length];
    addTone(pcm, sr, ev.t, note, 0.16, 0.12);
  }

  // Soft limiter
  let peak = 1e-6;
  for (let i = 0; i < n; i++) if (Math.abs(pcm[i]) > peak) peak = Math.abs(pcm[i]);
  const g = 0.92 / peak;
  for (let i = 0; i < n; i++) pcm[i] *= g;
  return pcm;
}

export function buildDemoTrack(audioCtx) {
  const sr = audioCtx.sampleRate || 44100;
  const pcm = synthesizeDemoPcm(sr);
  const buffer = audioCtx.createBuffer(1, pcm.length, sr);
  buffer.getChannelData(0).set(pcm);
  const fileBytes = new Uint8Array(pcm.byteLength);
  fileBytes.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  return {
    audioBuffer: buffer,
    fileBytes,
    name: DEMO_NAME,
    duration: buffer.duration,
    sampleRate: sr,
    isDemo: true,
  };
}

function addKick(pcm, sr, t, amp) {
  const start = Math.floor(t * sr);
  const len = Math.floor(0.18 * sr);
  for (let i = 0; i < len && start + i < pcm.length; i++) {
    const env = Math.exp(-i / (sr * 0.045));
    const freq = 58 + 90 * env;
    pcm[start + i] += Math.sin(2 * Math.PI * freq * i / sr) * env * amp;
  }
}

function addSnare(pcm, sr, t, amp, rng) {
  const start = Math.floor(t * sr);
  const len = Math.floor(0.12 * sr);
  for (let i = 0; i < len && start + i < pcm.length; i++) {
    const env = Math.exp(-i / (sr * 0.04));
    const noise = (rng() * 2 - 1);
    const tone = Math.sin(2 * Math.PI * 190 * i / sr);
    pcm[start + i] += (noise * 0.7 + tone * 0.3) * env * amp;
  }
}

function addHat(pcm, sr, t, amp, rng) {
  const start = Math.floor(t * sr);
  const len = Math.floor(0.035 * sr);
  let prev = 0;
  for (let i = 0; i < len && start + i < pcm.length; i++) {
    const env = Math.exp(-i / (sr * 0.012));
    const n = rng() * 2 - 1;
    const hp = n - prev; // crude high-pass
    prev = n;
    pcm[start + i] += hp * env * amp;
  }
}

function addTone(pcm, sr, t, freq, amp, dur) {
  const start = Math.floor(t * sr);
  const len = Math.floor(dur * sr);
  for (let i = 0; i < len && start + i < pcm.length; i++) {
    const att = Math.min(1, i / (sr * 0.01));
    const rel = Math.exp(-i / (sr * (dur * 0.45)));
    const s = Math.sin(2 * Math.PI * freq * i / sr)
            + 0.25 * Math.sin(2 * Math.PI * freq * 2 * i / sr);
    pcm[start + i] += s * att * rel * amp * 0.7;
  }
}
