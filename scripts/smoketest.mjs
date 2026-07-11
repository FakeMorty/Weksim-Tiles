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
  documentElement: { lang: 'en', dir: 'ltr' },
  querySelectorAll: () => [],
  createElement: () => ({
    appendChild(){}, setAttribute(){}, addEventListener(){}, style:{},
    textContent:'', innerHTML:'', width: 0, height: 0,
    // createElement('canvas').getContext(...) — used by prerendered grid (v1.24.5)
    getContext: () => ({
      setTransform() {}, clearRect() {}, save() {}, restore() {},
      fillRect() {}, strokeRect() {}, drawImage() {},
      set fillStyle(v) {}, get fillStyle() { return '#000'; },
      set globalAlpha(v) {}, get globalAlpha() { return 1; },
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
    }),
  }),
  getElementById() {
    return {
      style: {},
      classList: { add() {}, remove() {}, contains: () => false },
      addEventListener() {},
      appendChild() {},
      setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
      innerHTML: '', textContent: '', value: '', title: '',
      dataset: {},
      querySelector: () => ({ style: {} }),
      querySelectorAll: () => [],
      getContext: () => ({
        setTransform() {}, clearRect() {}, save() {}, restore() {},
        fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
        stroke() {}, fill() {}, arc() {}, arcTo() {}, closePath() {},
        createLinearGradient: () => ({ addColorStop() {} }),
        createRadialGradient: () => ({ addColorStop() {} }),
        drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }),
        putImageData() {}, measureText: () => ({ width: 10 }),
        fillText() {}, translate() {}, rotate() {}, scale() {},
        set filter(v) {}, get filter() { return 'none'; },
        set globalCompositeOperation(v) {}, get globalCompositeOperation() { return 'source-over'; },
        set globalAlpha(v) {}, get globalAlpha() { return 1; },
        set fillStyle(v) {}, get fillStyle() { return '#000'; },
        set strokeStyle(v) {}, get strokeStyle() { return '#000'; },
        set lineWidth(v) {}, get lineWidth() { return 1; },
        set shadowBlur(v) {}, get shadowBlur() { return 0; },
        set shadowColor(v) {}, get shadowColor() { return '#000'; },
        set font(v) {}, get font() { return '10px sans'; },
        set textBaseline(v) {}, get textBaseline() { return 'alphabetic'; },
        set textAlign(v) {}, get textAlign() { return 'start'; },
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
globalThis.navigator = globalThis.navigator || { userAgent: 'Node', language: 'en', languages: ['en'] };
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  try { Object.defineProperty(globalThis, 'crypto', { value: { subtle: { digest: () => Promise.resolve(new ArrayBuffer(20)) } }, configurable: true }); }
  catch { /* modern node already has one */ }
}

const modules = [
  'src/config.js',
  'src/i18n/locales/en.js',
  'src/i18n/locales/ru.js',
  'src/i18n/locales/de.js',
  'src/i18n/locales/fr.js',
  'src/i18n/locales/es.js',
  'src/i18n/locales/pl.js',
  'src/i18n/locales/zh.js',
  'src/i18n/locales/ja.js',
  'src/i18n/locales/ko.js',
  'src/i18n/locales/ar.js',
  'src/i18n/locales/hi.js',
  'src/i18n/locales/pt.js',
  'src/i18n/locales/id.js',
  'src/i18n/locales/tr.js',
  'src/i18n/locales/vi.js',
  'src/i18n/locales/it.js',
  'src/i18n/locales/bn.js',
  'src/i18n/locales/ur.js',
  'src/i18n/locales/fa.js',
  'src/i18n/locales/uk.js',
  'src/i18n/locales/ta.js',
  'src/i18n/locales/te.js',
  'src/i18n/locales/th.js',
  'src/i18n/locales/he.js',
  'src/i18n/locales/el.js',
  'src/i18n/locales/cs.js',
  'src/i18n/i18n.js',
  'src/game/settings.js',
  'src/utils/canvas.js',
  'src/utils/perf.js',
  'src/game/state.js',
  'src/game/calibration.js',
  'src/audio/stft.js',
  'src/audio/spectralFlux.js',
  'src/audio/onsets.js',
  'src/audio/bpm.js',
  'src/audio/density.js',
  'src/audio/percussive.js',
  'src/audio/beatTracking.js',
  'src/audio/plp.js',
  'src/audio/pitch.js',
  'src/audio/envelope.js',
  'src/audio/mapgen.js',
  'src/audio/holds.js',
  'src/audio/sources.js',
  'src/audio/nmf.js',
  'src/game/library.js',
  'src/game/warmup.js',
  'src/game/hitsound.js',
  'src/game/bot.js',
  'src/game/replay.js',
  'src/audio/cache.js',
  'src/audio/mapIO.js',
  'src/game/stats.js',
  'src/audio/worker.js',
  'src/audio/analyzer.js',
  'src/render/camera.js',
  'src/fx/flash.js',
  'src/fx/particles.js',
  'src/fx/toasts.js',
  'src/fx/musicReactive.js',
  'src/render/notes.js',
  'src/render/bloom.js',
  'src/render/renderer.js',
  'src/ui/hud.js',
  'src/ui/hitChart.js',
  'src/ui/calibration.js',
  'src/game/judge.js',
  'src/game/loop.js',
  'src/game/input.js',
  'src/ui/pause.js',
  'src/ui/stats.js',
  'src/ui/language.js',
  'src/ui/library.js',
  'src/ui/videoExport.js',
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
