// Etap 8: Cheap bloom effect via offscreen canvas + CSS filter blur.
//
// Real bloom (as in Beat Saber / Bloom shader) is multi-pass Gaussian blur
// on a threshold-extracted brightness pass, then additive-blended over the
// scene. We approximate with:
//
//   1. Draw the main scene to the visible canvas (as always).
//   2. Copy it to an offscreen canvas at reduced resolution (1/2).
//   3. Apply canvas ctx.filter = 'blur(Xpx)' — hardware-accelerated in
//      Chromium, uses GPU shader under the hood.
//   4. Draw the blurred offscreen back over the main canvas with
//      globalCompositeOperation='lighter' (additive) at 40-60% opacity.
//
// Cost: one full-canvas drawImage + one blurred drawImage per frame.
// On Intel Iris Xe at 1080p that's ~2-4 ms — acceptable for high FX.

let bloomCanvas = null;
let bloomCtx = null;
let bloomW = 0, bloomH = 0;

/**
 * Prepare the offscreen bloom buffer at half resolution.
 */
function ensureBloomBuffer(W, H) {
  const bw = Math.round(W / 2);
  const bh = Math.round(H / 2);
  if (bloomCanvas && bloomW === bw && bloomH === bh) return;
  bloomCanvas = document.createElement('canvas');
  bloomCanvas.width = bw;
  bloomCanvas.height = bh;
  bloomCtx = bloomCanvas.getContext('2d');
  bloomW = bw;
  bloomH = bh;
}

/**
 * Apply bloom pass to `mainCtx`. Call AFTER the scene is drawn.
 * @param {CanvasRenderingContext2D} mainCtx
 * @param {number} W  logical width of visible canvas
 * @param {number} H  logical height
 * @param {number} intensity  0..1, how much bloom to apply
 * @param {number} radius     blur radius in offscreen pixels (~4-8)
 */
export function applyBloom(mainCtx, W, H, intensity = 0.55, radius = 6) {
  ensureBloomBuffer(W, H);

  // 1. Copy scaled-down scene to offscreen
  bloomCtx.globalCompositeOperation = 'copy';
  bloomCtx.filter = 'none';
  bloomCtx.drawImage(mainCtx.canvas, 0, 0, bloomW, bloomH);

  // 2. Re-draw with blur applied — creates the glow layer
  bloomCtx.globalCompositeOperation = 'source-over';
  bloomCtx.filter = `blur(${radius}px)`;
  bloomCtx.drawImage(bloomCanvas, 0, 0);
  bloomCtx.filter = 'none';

  // 3. Blend back over main using additive comp
  mainCtx.save();
  mainCtx.globalCompositeOperation = 'lighter';
  mainCtx.globalAlpha = intensity;
  mainCtx.drawImage(bloomCanvas, 0, 0, W, H);
  mainCtx.restore();
}

export function invalidateBloomBuffer() {
  bloomCanvas = null;
  bloomCtx = null;
  bloomW = 0; bloomH = 0;
}
