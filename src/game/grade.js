// Letter rank + combo badges from a finished play.

export function letterGrade({ failed, acc }) {
  if (failed) return 'F';
  const a = Number(acc) || 0;
  if (a >= 100) return 'SS';
  if (a >= 95) return 'S';
  if (a >= 90) return 'A';
  if (a >= 80) return 'B';
  if (a >= 70) return 'C';
  if (a >= 60) return 'D';
  return 'F';
}

export const GRADE_COLORS = {
  SS: '#fff4a3',
  S:  '#7dfffa',
  A:  '#7aff99',
  B:  '#ffb066',
  C:  '#c9a0ff',
  D:  '#8aa0b8',
  F:  '#ff6a7a',
};

export function judgedTaps(s) {
  return (s.marvelous || 0) + (s.perfects || 0) + (s.greats || 0)
       + (s.goods || 0) + (s.oks || 0) + (s.misses || 0);
}

export function isFullCombo(s) {
  return !s.failed && (s.misses || 0) === 0 && judgedTaps(s) > 0;
}

export function isAllPerfect(s) {
  return isFullCombo(s)
      && (s.greats || 0) === 0
      && (s.goods || 0) === 0
      && (s.oks || 0) === 0;
}
