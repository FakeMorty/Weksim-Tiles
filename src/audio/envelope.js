// Attack-Sustain-Release envelope analysis.
//
// Complements pitch tracking. Pitch is great for vocals/melodic instruments
// but goes silent on drums, distorted guitars, synths with no clear f0.
// Envelope analysis works on anything that makes sound and tells us the
// SHAPE of the sound over time — which is what actually distinguishes
// "this is a kick that decays in 100ms" from "this is a synth pad that
// holds for 2 seconds".
//
// Concepts:
//   attack — how fast the amplitude rises from 10% peak to 90% peak
//   sustain — how long the amplitude stays above 50% peak
//   release — how fast it drops back to 10% peak after leaving sustain
//
// For our purposes:
//   • short attack + fast decay → transient (tap note)
//   • any attack + long sustain (>250ms above 50%) → HOLD candidate
//   • slow attack + long sustain → definitely HOLD (organ, pad, vocal)

/**
 * Analyse an event's envelope shape starting at `onsetTime`.
 *
 * @param {Float32Array} energyEnvelope  smoothed per-frame energy (any band)
 * @param {number} framesPerSec
 * @param {number} onsetTime             seconds
 * @param {number} maxLookaheadSec       how far to scan after the onset (default 2 s)
 * @returns {{
 *   attackMs: number,
 *   sustainMs: number,
 *   releaseMs: number,
 *   peakAmp: number,
 *   sustainRatio: number,  // sustain amp / peak amp — how "flat" the top is
 *   shape: 'transient'|'medium'|'sustained'
 * }}
 */
export function analyzeEnvelope(energyEnvelope, framesPerSec, onsetTime, maxLookaheadSec = 2.0) {
  const startFrame = Math.max(0, Math.floor(onsetTime * framesPerSec));
  const endFrame = Math.min(energyEnvelope.length - 1,
                            startFrame + Math.floor(maxLookaheadSec * framesPerSec));

  if (endFrame <= startFrame + 2) {
    return { attackMs: 0, sustainMs: 0, releaseMs: 0, peakAmp: 0, sustainRatio: 0, shape: 'transient' };
  }

  // Find peak within first 100ms of the onset (attack phase should be short)
  const attackWindow = Math.floor(0.10 * framesPerSec);
  let peakFrame = startFrame;
  let peakAmp = energyEnvelope[startFrame];
  for (let f = startFrame; f <= Math.min(startFrame + attackWindow, endFrame); f++) {
    if (energyEnvelope[f] > peakAmp) {
      peakAmp = energyEnvelope[f];
      peakFrame = f;
    }
  }

  if (peakAmp < 1e-6) {
    return { attackMs: 0, sustainMs: 0, releaseMs: 0, peakAmp: 0, sustainRatio: 0, shape: 'transient' };
  }

  // Attack: time from 10% to 90% of peak, working backward from peakFrame
  const thr10 = peakAmp * 0.10;
  const thr90 = peakAmp * 0.90;
  let attackStart = startFrame, attack90 = peakFrame;
  for (let f = peakFrame; f >= startFrame; f--) {
    if (energyEnvelope[f] < thr90) { attack90 = f + 1; break; }
  }
  for (let f = attack90; f >= startFrame; f--) {
    if (energyEnvelope[f] < thr10) { attackStart = f + 1; break; }
  }
  const attackMs = ((attack90 - attackStart) / framesPerSec) * 1000;

  // Sustain: how long amp stays above 50% of peak after the peak
  const thr50 = peakAmp * 0.50;
  let sustainEnd = peakFrame;
  for (let f = peakFrame + 1; f <= endFrame; f++) {
    if (energyEnvelope[f] < thr50) break;
    sustainEnd = f;
  }
  const sustainMs = ((sustainEnd - peakFrame) / framesPerSec) * 1000;

  // Release: time from 50% down to 10% after sustain ends
  let releaseEnd = sustainEnd;
  for (let f = sustainEnd + 1; f <= endFrame; f++) {
    if (energyEnvelope[f] < thr10) { releaseEnd = f; break; }
    releaseEnd = f;
  }
  const releaseMs = ((releaseEnd - sustainEnd) / framesPerSec) * 1000;

  // Sustain ratio: average amp during sustain / peak amp. High = flat top,
  // low = quickly decays even during "sustain" phase (e.g. plucked string).
  let sustainSum = 0, sustainCount = 0;
  for (let f = peakFrame; f <= sustainEnd; f++) {
    sustainSum += energyEnvelope[f];
    sustainCount++;
  }
  const sustainAvg = sustainCount ? sustainSum / sustainCount : 0;
  const sustainRatio = peakAmp > 0 ? sustainAvg / peakAmp : 0;

  // Classify shape
  let shape;
  if (sustainMs >= 250 && sustainRatio >= 0.55) shape = 'sustained';
  else if (sustainMs >= 120) shape = 'medium';
  else shape = 'transient';

  return { attackMs, sustainMs, releaseMs, peakAmp, sustainRatio, shape };
}

/**
 * Precompute per-frame RMS amplitude envelope from raw PCM. Cheap.
 * Used as a fallback if we don't have HPSS envelopes yet.
 */
export function computeRMSEnvelope(pcm, sampleRate, hopSize = 512, winSize = 1024) {
  const numFrames = Math.max(1, Math.floor((pcm.length - winSize) / hopSize) + 1);
  const env = new Float32Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    const start = f * hopSize;
    let sum = 0;
    for (let i = 0; i < winSize; i++) {
      const s = pcm[start + i] || 0;
      sum += s * s;
    }
    env[f] = Math.sqrt(sum / winSize);
  }
  return env;
}
