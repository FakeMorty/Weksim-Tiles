// Etap C (v1.22): Source separation via spectral masking.
//
// We split the spectrogram into 4 "instrument streams" using a combination of
// HPSS masks (which we already computed) + narrow frequency bands. This is
// deliberately lightweight — no ML models, no matrix factorisation. Just
// clever band-limited energy envelopes that respond to specific instrument
// families:
//
//   kick   — kick body, percussive only           (30-120 Hz, P mask)
//   snare  — low-mid body × high-mid crack        (180-450 × 2.5k-5.5k, P mask)
//   hihat  — high-frequency percussive            (7k-16k, P mask)
//   melody — mid-band harmonic (vocals+lead)      (180-4k + presence 800-3.5k, H mask)
//
// Each stream is a per-frame energy envelope. Onset detection then runs on
// each stream independently with parameters tuned to that instrument, and
// the results are merged with a "chord grouping" pass at the end.
//
// Cost: ~150-300 ms extra on a 4-min track (mostly just summing sub-arrays
// over the spectrogram we already have). No extra STFT passes.

import { hzToBin } from './stft.js';

/**
 * Build per-instrument energy envelopes from percussive/harmonic magnitude
 * spectrograms and a raw mag spectrogram.
 *
 * @param {Float32Array} magP   percussive-masked magnitude spectrogram
 * @param {Float32Array} magH   harmonic-masked magnitude spectrogram
 * @param {number} numFrames
 * @param {number} numBins
 * @param {number} sr
 * @param {number} frameSize
 * @returns {{kick, snare, hihat, melody}} four Float32Array[numFrames]
 */
export function buildSourceEnvelopes(magP, magH, numFrames, numBins, sr, frameSize) {
  // Bin ranges for each source
  const kLoKick   = Math.max(1, hzToBin(30,   sr, frameSize));
  const kHiKick   = Math.min(numBins - 1, hzToBin(120,  sr, frameSize));

  const kLoSnare1 = hzToBin(180,  sr, frameSize);
  const kHiSnare1 = hzToBin(450,  sr, frameSize);
  const kLoSnare2 = hzToBin(2500, sr, frameSize);
  const kHiSnare2 = hzToBin(5500, sr, frameSize);

  const kLoHat    = hzToBin(7000, sr, frameSize);
  const kHiHat    = Math.min(numBins - 1, hzToBin(16000, sr, frameSize));

  const kLoMel    = hzToBin(180,  sr, frameSize);
  const kHiMel    = hzToBin(4000, sr, frameSize);
  const kLoPres   = hzToBin(800,  sr, frameSize);
  const kHiPres   = hzToBin(3500, sr, frameSize);

  const kick   = new Float32Array(numFrames);
  const snare  = new Float32Array(numFrames);
  const hihat  = new Float32Array(numFrames);
  const melody = new Float32Array(numFrames);

  const hasP = magP && magP.length > 0;
  const source = hasP ? magP : magH; // fallback if HPSS off
  const harmonicSource = magH && magH.length > 0 ? magH : source;

  for (let f = 0; f < numFrames; f++) {
    const base = f * numBins;

    // Kick — sum sub-bass on percussive component
    let sKick = 0;
    for (let k = kLoKick; k < kHiKick; k++) sKick += source[base + k];
    kick[f] = sKick;

    // Snare — combine low crack + high body
    let sSnA = 0, sSnB = 0;
    for (let k = kLoSnare1; k < kHiSnare1; k++) sSnA += source[base + k];
    for (let k = kLoSnare2; k < kHiSnare2; k++) sSnB += source[base + k];
    // Snare wants BOTH regions to fire — multiply not add. This suppresses
    // pure bass hits and pure hats.
    snare[f] = Math.sqrt(sSnA * sSnB);

    // Hi-hat — high freq percussive
    let sHat = 0;
    for (let k = kLoHat; k < kHiHat; k++) sHat += source[base + k];
    hihat[f] = sHat;

    // Melody — mid-band harmonic + extra weight on vocal presence (800–3.5k)
    let sMel = 0, sPres = 0;
    for (let k = kLoMel; k < kHiMel; k++) sMel += harmonicSource[base + k];
    for (let k = kLoPres; k < kHiPres; k++) sPres += harmonicSource[base + k];
    melody[f] = sMel + 0.55 * sPres;
  }

  // Half-wave-rectified flux (novelty) for each stream. This is what the
  // onset picker expects — a curve that spikes at attacks.
  return {
    kick:   fluxOfEnvelope(kick),
    snare:  fluxOfEnvelope(snare),
    hihat:  fluxOfEnvelope(hihat),
    melody: fluxOfEnvelope(melody),
    // Raw envelopes are useful too (for hold detection later)
    kickEnv:   kick,
    snareEnv:  snare,
    hihatEnv:  hihat,
    melodyEnv: melody,
  };
}

// Half-wave rectified flux + log compression, matching computeMultibandFlux.
function fluxOfEnvelope(env) {
  const N = env.length;
  const out = new Float32Array(N);
  const C = 10;
  let prev = Math.log1p(C * env[0]);
  for (let i = 1; i < N; i++) {
    const cur = Math.log1p(C * env[i]);
    const d = cur - prev;
    if (d > 0) out[i] = d;
    prev = cur;
  }
  return out;
}

/**
 * Merge onset lists from multiple sources into a single event stream,
 * tagging each event with which instrument(s) fired. Onsets within
 * `windowMs` of each other are grouped as a "chord" — the earliest time
 * wins, the strongest source is primary.
 *
 * @param {Object<string, Array<{time,strength,frame}>>} bySource
 *        e.g. {kick: [...], snare: [...], hihat: [...], melody: [...]}
 * @param {number} windowMs group window (default 40 ms)
 * @returns {Array<{time, strength, frame, primary, sources}>}
 */
export function mergeSourceOnsets(bySource, windowMs = 40) {
  const all = [];
  for (const src of Object.keys(bySource)) {
    for (const o of bySource[src]) {
      all.push({ time: o.time, strength: o.strength, frame: o.frame, source: src });
    }
  }
  all.sort((a, b) => a.time - b.time);

  const windowSec = windowMs / 1000;
  const merged = [];
  for (const o of all) {
    const last = merged[merged.length - 1];
    if (last && o.time - last.time < windowSec) {
      // Grouped into last event
      if (!last.sources.includes(o.source)) last.sources.push(o.source);
      if (o.strength > last.strength) {
        last.strength = o.strength;
        last.primary = o.source;
        last.time = o.time;
        last.frame = o.frame;
      }
    } else {
      merged.push({
        time: o.time,
        strength: o.strength,
        frame: o.frame,
        primary: o.source,
        sources: [o.source],
      });
    }
  }
  return merged;
}

/**
 * Priority order for choosing "primary" instrument when multiple fire
 * simultaneously. Kick beats everything (it defines the pulse), then
 * snare (backbeat), then melody (feels chordal), then hats last.
 */
export const SOURCE_PRIORITY = ['kick', 'snare', 'melody', 'hihat'];

export function pickPrimary(sources) {
  for (const s of SOURCE_PRIORITY) {
    if (sources.includes(s)) return s;
  }
  return sources[0];
}

/**
 * Mode-aware fusion of novelty peaks and source-separated onsets.
 *
 * The old pipeline did an all-or-nothing replace when the count ratio
 * looked "reasonable". That threw away a good novelty stream on mixed
 * tracks and kept a bad one on drums. Per-mode rules:
 *
 *   drums  — trust kick+snare; keep hats only if they aren't sitting
 *            on top of a kick/snare (otherwise 16ths flood the map)
 *   vocal  — melody stream only
 *   classic — source merge if density is in a sane band, else novelty
 *
 * Returns the same object identity as `noveltyOnsets` when falling back,
 * so the caller can detect "fusion declined".
 */
export function fuseOnsets(noveltyOnsets, sourceOnsets, mode, durationSec) {
  const duration = Math.max(1, durationSec || 1);
  if (!sourceOnsets || !sourceOnsets.length) return noveltyOnsets;

  if (mode === 'drums') {
    const kicks  = sourceOnsets.filter(o => o.primary === 'kick');
    const snares = sourceOnsets.filter(o => o.primary === 'snare');
    const hats   = sourceOnsets.filter(o => o.primary === 'hihat');
    const pulse  = kicks.concat(snares);
    const keptHats = hats.filter(h =>
      !pulse.some(p => Math.abs(p.time - h.time) < 0.045)
    );
    const merged = mergeSourceOnsets({ kick: kicks, snare: snares, hihat: keptHats }, 32);
    const nps = merged.length / duration;
    if (merged.length >= 12 && nps >= 0.35 && nps < 10) return merged;
    return noveltyOnsets;
  }

  if (mode === 'vocal') {
    const mel = sourceOnsets.filter(o =>
      o.primary === 'melody' || (o.sources || []).includes('melody')
    );
    const nps = mel.length / duration;
    if (mel.length >= 8 && nps < 8) return mel;
    return noveltyOnsets;
  }

  const ratio = sourceOnsets.length / Math.max(1, noveltyOnsets.length);
  if (sourceOnsets.length >= 16 && ratio > 0.35 && ratio < 2.5) return sourceOnsets;
  return noveltyOnsets;
}
