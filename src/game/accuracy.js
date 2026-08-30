// Accuracy from 6 judgement tiers.
// MARVELOUS/PERFECT = 100%, GREAT = 75%, GOOD = 40%, OK = 20%, MISS = 0%.

export const ACC_WEIGHT = {
  MARVELOUS: 1,
  PERFECT:   1,
  GREAT:     0.75,
  GOOD:      0.40,
  OK:        0.20,
  MISS:      0,
};

export function computeAccuracy(s) {
  const mv = s.marvelous || 0;
  const pf = s.perfects  || 0;
  const gr = s.greats    || 0;
  const gd = s.goods     || 0;
  const ok = s.oks       || 0;
  const ms = s.misses    || 0;
  const total = mv + pf + gr + gd + ok + ms;
  if (!total) return 100;
  const w = mv * ACC_WEIGHT.MARVELOUS
          + pf * ACC_WEIGHT.PERFECT
          + gr * ACC_WEIGHT.GREAT
          + gd * ACC_WEIGHT.GOOD
          + ok * ACC_WEIGHT.OK;
  return Math.round((w / total) * 100);
}

export function judgedCount(s) {
  return (s.marvelous || 0) + (s.perfects || 0) + (s.greats || 0)
       + (s.goods || 0) + (s.oks || 0) + (s.misses || 0);
}

export function hitCount(s) {
  return judgedCount(s) - (s.misses || 0);
}
