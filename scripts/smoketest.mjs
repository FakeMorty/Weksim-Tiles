// Loads every module through Node with a minimal browser mock.
// Catches: bad import names, missing exports, top-level side-effects that crash.

import { pathToFileURL } from 'node:url';
import path from 'node:path';

// --- browser globals mock ---
globalThis.window = {
  innerWidth: 1280,
  innerHeight: 860,
  devicePixelRatio: 1,
  addEventListener() {},
  AudioContext: class {},
};
globalThis.document = {
  getElementById() {
    return {
      style: {},
      classList: { add() {}, remove() {}, contains: () => false },
      addEventListener() {},
      textContent: '',
      querySelector: () => ({ style: {} }),
      querySelectorAll: () => [],
      getContext: () => ({
        setTransform() {}, clearRect() {}, save() {}, restore() {},
        fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
        stroke() {}, fill() {}, arc() {}, arcTo() {}, closePath() {},
        createLinearGradient: () => ({ addColorStop() {} }),
        fillText() {}, translate() {}, rotate() {}, scale() {},
      }),
    };
  },
  querySelectorAll: () => [],
  addEventListener() {},
};
globalThis.performance = { now: () => Date.now() };
globalThis.requestAnimationFrame = () => 0;
globalThis.OfflineAudioContext = class {};
globalThis.Worker = class { constructor(){} postMessage(){} addEventListener(){} removeEventListener(){} };
globalThis.self = { onmessage: null, postMessage(){} };
globalThis.localStorage = {
  _s: {},
  getItem(k) { return this._s[k] ?? null; },
  setItem(k, v) { this._s[k] = String(v); },
  removeItem(k) { delete this._s[k]; },
};

const modules = [
  'src/config.js',
  'src/utils/canvas.js',
  'src/game/state.js',
  'src/game/settings.js',
  'src/game/calibration.js',
  'src/audio/stft.js',
  'src/audio/spectralFlux.js',
  'src/audio/onsets.js',
  'src/audio/bpm.js',
  'src/audio/worker.js',
  'src/audio/analyzer.js',
  'src/render/camera.js',
  'src/fx/flash.js',
  'src/fx/particles.js',
  'src/fx/toasts.js',
  'src/render/notes.js',
  'src/render/renderer.js',
  'src/ui/hud.js',
  'src/ui/hitChart.js',
  'src/ui/calibration.js',
  'src/game/judge.js',
  'src/game/loop.js',
  'src/game/input.js',
  'src/ui/pause.js',
  'src/ui/menu.js',
  'src/main.js',
];

let failed = 0;
for (const m of modules) {
  const url = pathToFileURL(path.resolve(m)).href;
  try {
    await import(url);
    console.log('  OK   ' + m);
  } catch (e) {
    failed++;
    console.log('  FAIL ' + m + '  ->  ' + e.message);
  }
}
if (failed) {
  console.log('\n' + failed + ' module(s) failed to load');
  process.exit(1);
} else {
  console.log('\nAll modules loaded cleanly.');
}
