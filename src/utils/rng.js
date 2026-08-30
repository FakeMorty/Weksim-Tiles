// Tiny deterministic PRNG (Mulberry32) + string seed.
// Used so the same track + settings always produce the same chart.

export function mulberry32(a) {
  let seed = a >>> 0;
  return function rand() {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromString(s) {
  let h = 2166136261;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
