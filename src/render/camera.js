// Camera FX: micro-shake, zoom pulses, tilt. Applied by renderer around
// its main draw. All effects are time-based (dt-driven), not frame-based.

export const camera = {
  // Current transform (applied by renderer)
  shakeX: 0,
  shakeY: 0,
  zoom: 1.0,
  tilt: 0,

  // Internal decay state
  _shakeAmp: 0,       // current shake amplitude in px
  _shakeSeed: Math.random() * 1000,
  _zoomTarget: 1.0,
  _tiltTarget: 0,
};

// Trigger a shake. Intensity in px, duration in seconds.
export function shake(intensity, duration = 0.25) {
  // Take the stronger of current vs new so PERFECT during BREAK doesn't cancel.
  const decayFromCurrent = camera._shakeAmp;
  camera._shakeAmp = Math.max(decayFromCurrent, intensity);
  camera._shakeDecay = camera._shakeAmp / Math.max(0.05, duration);
}

// Push zoom target (typically 1.02–1.06). Camera lerps to it, then back.
export function zoomPulse(target = 1.03, snapBack = true) {
  camera._zoomTarget = target;
  camera._zoomSnapBack = snapBack;
}

// Push a tilt in radians (±0.01 is subtle, ±0.03 is strong).
export function tiltPulse(radians) {
  camera._tiltTarget = radians;
}

export function updateCamera(dt) {
  // Shake
  if (camera._shakeAmp > 0.01) {
    camera._shakeSeed += dt * 60;
    // 2D noise-ish shake using sin at slightly-different rates
    camera.shakeX = Math.sin(camera._shakeSeed * 1.7) * camera._shakeAmp;
    camera.shakeY = Math.cos(camera._shakeSeed * 2.1) * camera._shakeAmp * 0.7;
    camera._shakeAmp = Math.max(0, camera._shakeAmp - (camera._shakeDecay || 20) * dt);
  } else {
    camera.shakeX = 0;
    camera.shakeY = 0;
    camera._shakeAmp = 0;
  }

  // Zoom (soft attack, faster relax)
  const zoomLerp = camera.zoom < camera._zoomTarget ? 12 : 6;
  camera.zoom += (camera._zoomTarget - camera.zoom) * Math.min(1, dt * zoomLerp);
  if (camera._zoomSnapBack !== false && Math.abs(camera.zoom - camera._zoomTarget) < 0.003) {
    camera._zoomTarget = 1.0;
  }

  // Tilt
  camera.tilt += (camera._tiltTarget - camera.tilt) * Math.min(1, dt * 10);
  if (Math.abs(camera.tilt - camera._tiltTarget) < 0.001) camera._tiltTarget = 0;
}

// Apply camera transform to ctx. Caller must save() first and restore() after.
export function applyCameraTransform(ctx, W, H) {
  const cx = W / 2;
  const cy = H / 2;
  ctx.translate(cx + camera.shakeX, cy + camera.shakeY);
  if (camera.zoom !== 1) ctx.scale(camera.zoom, camera.zoom);
  if (camera.tilt !== 0) ctx.rotate(camera.tilt);
  ctx.translate(-cx, -cy);
}

export function resetCamera() {
  camera.shakeX = 0; camera.shakeY = 0;
  camera.zoom = 1.0; camera.tilt = 0;
  camera._shakeAmp = 0;
  camera._zoomTarget = 1.0;
  camera._tiltTarget = 0;
}
