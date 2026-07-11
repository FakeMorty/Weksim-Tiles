// Etap E (v1.24): Hit sounds.
//
// Two sources: synthetic (osc + gain envelope) and sample-based (decoded
// AudioBuffer). User picks preset ('off' | 'click' | 'kick' | 'snare' |
// 'custom'). Custom slot loads any user-provided mp3/wav from disk and
// keeps it in memory + base64 in settings for persistence.
//
// Two independent tracks: main player + bot. Both routed to `gainNode` so
// master volume affects them.

import { settings, saveSettings } from './settings.js';

let audioCtx = null;
let destination = null;
let customBuffer = null;

export function bindHitSoundOutput(ctx, dest) {
  audioCtx = ctx;
  destination = dest;
  // Re-decode custom sample if we have one from a previous session
  if (settings.hitSoundCustomB64 && !customBuffer) {
    decodeCustomFromB64(settings.hitSoundCustomB64).catch(() => {});
  }
  // v1.24.1: warm up the audio graph — play a silent click so the browser
  // pre-compiles the oscillator/gain pathway. Otherwise the first real hit
  // has a noticeable delay on some setups.
  if (audioCtx && destination) {
    try {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      g.gain.value = 0.0001;
      osc.connect(g); g.connect(destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.01);
    } catch { /* ignore */ }
  }
}

/**
 * Play a hit sound of the given preset. Fire-and-forget. `who` is
 * 'player' | 'bot'; the preset used depends on who.
 *
 * @param {'player'|'bot'} who
 * @param {'perfect'|'good'|'miss'|'hold'} [judgement]
 */
export function playHitSound(who, judgement) {
  if (!audioCtx || !destination) return;
  const preset = who === 'bot' ? settings.botHitSound : settings.hitSound;
  if (!preset || preset === 'off') return;
  // Slight de-emphasis for weaker judgements
  const gain = settings.hitSoundVolume * (judgement === 'good' ? 0.75 : judgement === 'miss' ? 0 : 1);
  if (gain <= 0) return;

  const now = audioCtx.currentTime;
  switch (preset) {
    case 'click': playClick(now, gain); break;
    case 'kick':  playKick(now, gain);  break;
    case 'snare': playSnare(now, gain); break;
    case 'custom':
      if (customBuffer) playBuffer(customBuffer, now, gain);
      else playClick(now, gain); // fallback
      break;
    default: playClick(now, gain);
  }
}

function playClick(at, amp) {
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(2400, at);
  osc.frequency.exponentialRampToValueAtTime(900, at + 0.04);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(amp * 0.8, at + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
  osc.connect(g); g.connect(destination);
  osc.start(at); osc.stop(at + 0.08);
}

function playKick(at, amp) {
  // Sine sweep from 120→45 Hz with fast decay
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(120, at);
  osc.frequency.exponentialRampToValueAtTime(45, at + 0.10);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(amp, at + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
  osc.connect(g); g.connect(destination);
  osc.start(at); osc.stop(at + 0.22);
}

function playSnare(at, amp) {
  // Noise burst + short tonal ping
  const bufLen = Math.floor(audioCtx.sampleRate * 0.15);
  const buf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufLen * 0.25));
  }
  const noise = audioCtx.createBufferSource();
  noise.buffer = buf;
  const hp = audioCtx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 1500;
  const ng = audioCtx.createGain();
  ng.gain.value = amp * 0.9;
  noise.connect(hp); hp.connect(ng); ng.connect(destination);
  noise.start(at);

  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'triangle'; osc.frequency.value = 220;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(amp * 0.4, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
  osc.connect(g); g.connect(destination);
  osc.start(at); osc.stop(at + 0.08);
}

function playBuffer(buf, at, amp) {
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const g = audioCtx.createGain();
  g.gain.value = amp;
  src.connect(g); g.connect(destination);
  src.start(at);
}

/** Load a File as the "custom" hit sound, persist it as base64. */
export async function loadCustomHitSoundFromFile(file) {
  if (!audioCtx) return { ok: false, error: 'no audio context' };
  if (file.size > 400 * 1024) {
    // Keep localStorage from bloating — reject large files
    return { ok: false, error: 'file too large (max 400 KB)' };
  }
  const ab = await file.arrayBuffer();
  try {
    customBuffer = await audioCtx.decodeAudioData(ab.slice(0));
  } catch (e) {
    return { ok: false, error: 'decode failed' };
  }
  // Persist as base64 for next session
  const b64 = arrayBufferToB64(ab);
  settings.hitSoundCustomB64 = b64;
  saveSettings();
  return { ok: true, duration: customBuffer.duration };
}

async function decodeCustomFromB64(b64) {
  if (!audioCtx) return;
  try {
    const ab = b64ToArrayBuffer(b64);
    customBuffer = await audioCtx.decodeAudioData(ab);
  } catch (e) {
    console.warn('failed to restore custom hit sound:', e);
    settings.hitSoundCustomB64 = '';
    saveSettings();
  }
}

function arrayBufferToB64(ab) {
  const bytes = new Uint8Array(ab);
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}
function b64ToArrayBuffer(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

export function hasCustomHitSound() { return customBuffer !== null; }
