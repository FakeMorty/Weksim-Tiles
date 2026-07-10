// Judgement text, combo counter, HOLD toast — DOM overlays.

let judgeTimer = null;
let holdToastTimer = null;

export function showJudge(text, color, scale = 1) {
  const el = document.getElementById('judgeText');
  el.textContent = text;
  el.style.color = color;
  el.style.opacity = '1';
  el.style.transform = `translate(-50%,-50%) scale(${scale})`;
  clearTimeout(judgeTimer);
  judgeTimer = setTimeout(() => { el.style.opacity = '0'; }, 260);
}

export function showHoldToast() {
  const el = document.getElementById('holdToast');
  el.style.opacity = '1';
  clearTimeout(holdToastTimer);
  holdToastTimer = setTimeout(() => el.style.opacity = '0', 320);
}

export function showCombo(c) {
  const el = document.getElementById('comboText');
  if (c < 3) { el.style.opacity = '0'; return; }
  el.textContent = c + 'x COMBO';
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => el.style.opacity = '0', 460);
}
