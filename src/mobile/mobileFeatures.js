// Mobile-only features: Screen Wake Lock, Vibration API, orientation lock.
// All graceful-degrade — if the API isn't supported, we just skip it silently.

import { settings } from '../game/settings.js';

let wakeLockSentinel = null;

/**
 * Request the screen wake lock so the phone doesn't dim/lock during play.
 * Must be called from a user gesture (touch/click event handler).
 */
export async function requestWakeLock() {
  if (!settings.keepScreenOn) return;
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLockSentinel = await navigator.wakeLock.request('screen');
    wakeLockSentinel.addEventListener('release', () => {
      wakeLockSentinel = null;
    });
  } catch (e) {
    // Common if user is in low-power mode or backgrounded — not fatal.
    console.warn('wakeLock request failed:', e.message);
  }
}

export async function releaseWakeLock() {
  if (!wakeLockSentinel) return;
  try {
    await wakeLockSentinel.release();
  } catch {}
  wakeLockSentinel = null;
}

// Auto re-acquire wake lock when tab regains focus (browsers auto-release
// it when tab goes to background).
export function initWakeLockAutoReacquire() {
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && wakeLockSentinel === null) {
      await requestWakeLock();
    }
  });
}

/**
 * Vibrate the device on a note hit. Duration is short so it feels tactile,
 * not annoying. Different patterns per hit tier.
 */
export function hapticHit(tier) {
  if (!settings.hapticFeedback) return;
  if (!('vibrate' in navigator)) return;
  try {
    switch (tier) {
      case 'MARVELOUS': navigator.vibrate([8, 4, 8]); break;
      case 'PERFECT':   navigator.vibrate(10); break;
      case 'GREAT':     navigator.vibrate(6); break;
      case 'GOOD':      navigator.vibrate(4); break;
      case 'OK':        navigator.vibrate(2); break;
      case 'MISS':      navigator.vibrate([20, 30, 20]); break;
      case 'HOLD_START': navigator.vibrate(12); break;
      default:          navigator.vibrate(4);
    }
  } catch {}
}

/**
 * Try to lock orientation to landscape when in play mode. Requires the
 * document to be in fullscreen on most browsers.
 */
export async function requestLandscape() {
  if (!screen.orientation || !screen.orientation.lock) return;
  try {
    await screen.orientation.lock('landscape');
  } catch {
    // Silent — usually happens when not in fullscreen. That's fine, the CSS
    // rotation hint will nudge the user to rotate manually.
  }
}

/**
 * Detect whether we're running on a touch device. Used to conditionally
 * show tap hints instead of keyboard hints.
 */
export function isTouchDevice() {
  return 'ontouchstart' in window
      || (navigator.maxTouchPoints > 0);
}

/**
 * Detect portrait vs landscape from viewport, not screen orientation
 * (works on desktop DevTools mobile emulation too).
 */
export function isPortrait() {
  return window.innerHeight > window.innerWidth;
}
