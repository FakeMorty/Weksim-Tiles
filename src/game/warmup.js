// Etap E (v1.24): Warmup / count-in.
//
// Before the track starts, we play 4 metronome ticks in tempo — like a
// drummer counting "1-2-3-4" before the band comes in. Gives the player
// time to prepare and locks in the beat feel.
//
// Uses Web Audio oscillator + gain envelope for zero-file synthetic clicks:
//   Beats 1 & 3 (downbeats): higher pitched click (1000 Hz)
//   Beats 2 & 4 (backbeats): lower pitched click (700 Hz)
// Beat 4 is slightly quieter to blend into the track start.

/**
 * Schedule 4 count-in ticks at a given tempo, then return the audio-context
 * time at which the actual track should start playing.
 *
 * @param {AudioContext} ctx
 * @param {AudioNode} destination
 * @param {number} bpm
 * @param {number} startAt      audioCtx time when the first tick should sound
 * @param {number} [volume=0.35]  loudness of clicks (0..1)
 * @param {number} [beats=4]
 * @returns {number}            audioCtx time when the actual song should start
 */
export function scheduleCountIn(ctx, destination, bpm, startAt, volume = 0.35, beats = 4) {
  if (!bpm || bpm < 30) bpm = 120; // safety
  const beatSec = 60 / bpm;
  for (let i = 0; i < beats; i++) {
    const isDownbeat = (i % 2) === 0; // 1 & 3
    const freq = isDownbeat ? 1000 : 700;
    const amp = i === beats - 1 ? volume * 0.6 : volume;
    scheduleClick(ctx, destination, startAt + i * beatSec, freq, amp);
  }
  return startAt + beats * beatSec;
}

function scheduleClick(ctx, destination, at, freq, amp) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  osc.type = 'sine';
  // Fast attack, ~80ms exponential decay
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(amp, at + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
  osc.connect(gain);
  gain.connect(destination);
  osc.start(at);
  osc.stop(at + 0.12);
}
