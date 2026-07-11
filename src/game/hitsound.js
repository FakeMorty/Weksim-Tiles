// Etap E (v1.24): Hit sounds.
//
// Two sources: synthetic (osc + gain envelope) and sample-based (decoded
// AudioBuffer). User picks preset ('off' | 'click' | 'kick' | 'snare' |
// 'custom'). Custom slot loads any user-provided mp3/wav from disk and
// keeps it in memory + base64 in settings for persistence.
//
// Two independent tracks: main player + bot. Both routed to `gainNode` so
// master volume affects them.
//
// v1.24.3: HOLD notes now play a legato SUSTAIN tone — a continuous soft
// hum for the entire duration, with quick attack + release envelope.
// No more "double tap" at start + end. Sustain voices are per-lane so
// chords work. On end, we call stopHoldSound(who, lane) which fades out.

import { settings, saveSettings } from './settings.js';

let audioCtx = null;
let destination = null;
let customBuffer = null;

// Active sustain voices: { player: [null|voice, ...4], bot: [...] }
// Each voice is { osc?, source?, gain, filter?, endTime }.
const activeSustains = { player: [null, null, null, null], bot: [null, null, null, null] };

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
  // Reset any stale sustains from previous play
  for (const who of ['player', 'bot']) {
    for (let i = 0; i < 4; i++) activeSustains[who][i] = null;
  }
}

/**
 * Play a short hit sound of the given preset. Used for TAP notes only.
 * For HOLD notes, call startHoldSound / stopHoldSound instead.
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

/**
 * Start a legato SUSTAIN tone for a HOLD note. Loud enough to be audible
 * but softer than tap so it doesn't fatigue on long notes. Fades in from
 * silence over `attackSec`, holds indefinitely, and expects stopHoldSound
 * to be called when the hold ends (either successfully or on break).
 */
export function startHoldSound(who, lane) {
  if (!audioCtx || !destination) return;
  const preset = who === 'bot' ? settings.botHitSound : settings.hitSound;
  if (!preset || preset === 'off') return;
  // Stop any existing sustain on this lane first (defensive)
  stopHoldSound(who, lane, 0.02);
  const amp = settings.hitSoundVolume * 0.55; // quieter than tap
  const now = audioCtx.currentTime;
  const attack = 0.03;
  let voice;
  switch (preset) {
    case 'kick':   voice = startSustainKick(now, amp, attack);   break;
    case 'snare':  voice = startSustainSnare(now, amp, attack);  break;
    case 'custom': voice = startSustainCustom(now, amp, attack); break;
    case 'click':
    default:       voice = startSustainClick(now, amp, attack);
  }
  activeSustains[who][lane] = voice;
}

/**
 * Stop the legato sustain on the given lane. Fades out over `releaseSec`
 * to avoid a click. Safe to call when nothing is playing.
 */
export function stopHoldSound(who, lane, releaseSec = 0.06) {
  const v = activeSustains[who][lane];
  if (!v) return;
  activeSustains[who][lane] = null;
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  try {
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setValueAtTime(v.gain.gain.value, now);
    v.gain.gain.exponentialRampToValueAtTime(0.0001, now + releaseSec);
  } catch { /* ignore */ }
  // Stop underlying source(s) shortly after fade
  const stopAt = now + releaseSec + 0.02;
  try { if (v.osc) v.osc.stop(stopAt); } catch { /* ignore */ }
  try { if (v.source) v.source.stop(stopAt); } catch { /* ignore */ }
}

/** Stop ALL sustains — used when game ends or on restart. */
export function stopAllHoldSounds() {
  for (const who of ['player', 'bot']) {
    for (let i = 0; i < 4; i++) stopHoldSound(who, i, 0.03);
  }
}

// ---------- short (tap) voices ----------

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

// ---------- sustain (hold) voices ----------

/** Soft-triangle sustain — mirrors the 'click' family but held. */
function startSustainClick(at, amp, attack) {
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = 880; // A5 — bright but not piercing
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(amp * 0.6, at + attack);
  osc.connect(g); g.connect(destination);
  osc.start(at);
  return { osc, gain: g };
}

/** Deep sine drone — mirrors 'kick' family. */
function startSustainKick(at, amp, attack) {
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 80;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(amp * 0.9, at + attack);
  osc.connect(g); g.connect(destination);
  osc.start(at);
  return { osc, gain: g };
}

/** Filtered noise hush — mirrors 'snare' family. */
function startSustainSnare(at, amp, attack) {
  const sr = audioCtx.sampleRate;
  const bufLen = sr >> 1;
  const buf = audioCtx.createBuffer(1, bufLen, sr);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
  const src = audioCtx.createBufferSource();
  src.buffer = buf; src.loop = true;
  const bp = audioCtx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 1.2;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(amp * 0.5, at + attack);
  src.connect(bp); bp.connect(g); g.connect(destination);
  src.start(at);
  return { source: src, gain: g, filter: bp };
}

/** Looped custom sample. */
function startSustainCustom(at, amp, attack) {
  if (!customBuffer) return startSustainClick(at, amp, attack);
  const src = audioCtx.createBufferSource();
  src.buffer = customBuffer; src.loop = true;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(amp * 0.7, at + attack);
  src.connect(g); g.connect(destination);
  src.start(at);
  return { source: src, gain: g };
}

// ---------- custom sample I/O ----------

/** Load a File as the "custom" hit sound, persist it as base64. */
export async function loadCustomHitSoundFromFile(file) {
  if (!audioCtx) return { ok: false, error: 'no audio context' };
  if (file.size > 400 * 1024) {
    return { ok: false, error: 'file too large (max 400 KB)' };
  }
  const ab = await file.arrayBuffer();
  try {
    customBuffer = await audioCtx.decodeAudioData(ab.slice(0));
  } catch (e) {
    return { ok: false, error: 'decode failed' };
  }
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
