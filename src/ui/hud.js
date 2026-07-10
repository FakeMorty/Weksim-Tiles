// HUD numeric updates.

import { state } from '../game/state.js';

export function updateHUD() {
  document.getElementById('scoreEl').textContent = state.score.toLocaleString('ru-RU');
  document.getElementById('comboEl').textContent = state.combo;
  const total = state.perfects + state.goods + state.misses;
  const acc = total ? Math.round((state.perfects + state.goods * 0.58) / total * 100) : 100;
  document.getElementById('accEl').textContent = acc + '%';
  document.getElementById('hitsEl').textContent = (state.perfects + state.goods) + ' / ' + state.notes.length;
}
