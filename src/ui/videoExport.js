// Etap E (v1.24): Replay → video export.
//
// Strategy: play the replay live on the main canvas as a normal playthrough,
// but with:
//   - Bot mode enabled (uses recorded inputs to reproduce the exact play)
//   - A MediaStreamAudioDestinationNode tapping the same gainNode
//   - canvas.captureStream(60) as the video source
// MediaRecorder writes chunks; when the song ends (or timeout hits), we stop
// and trigger a download.
//
// We can't easily do offline/faster-than-realtime rendering because the
// game loop is driven by requestAnimationFrame + audioCtx.currentTime.
// That's a limitation of the current architecture but the recording is
// still solid.

import { state } from '../game/state.js';
import { startPlay } from '../game/loop.js';
import { recordCanvasToVideo } from '../game/replay.js';
import { getTrack } from '../game/library.js';
import { t } from '../i18n/i18n.js';

export async function startVideoExport(replayJson, onProgress) {
  const replay = JSON.parse(replayJson);

  // We need the AudioBuffer for the track that was played. Try the library
  // by hash, else use the currently-loaded audioBuffer.
  let audioBuffer = null;
  if (replay.fileHash) {
    for (const tr of (window.__libraryCache || [])) {
      if (tr.fileHash === replay.fileHash) { audioBuffer = tr.audioBuffer; break; }
    }
  }
  if (!audioBuffer) audioBuffer = state.audioBuffer;
  if (!audioBuffer) throw new Error(t('menu.videoNoAudio'));

  const canvas = document.getElementById('game');
  if (!canvas) throw new Error('no game canvas');

  // Set up an audio tap for the recorder — parallel to the speaker output
  if (!state.audioCtx) throw new Error('audio context not initialised');
  const tap = state.audioCtx.createMediaStreamDestination();
  // We connect *after* startPlay because gainNode is (re)created there
  // guarded by the null check. So we ensure it exists first:
  if (!state.gainNode) {
    state.gainNode = state.audioCtx.createGain();
    state.gainNode.connect(state.audioCtx.destination);
  }
  state.gainNode.connect(tap);

  // Restore state from the replay so bot mode can execute it exactly
  state.audioBuffer = audioBuffer;
  state.fileName = replay.fileName || state.fileName;
  state.mode = replay.mode || state.mode;
  state.currentDifficulty = replay.difficulty || 'normal';
  state.currentBpm = replay.bpm || state.currentBpm;
  state.fallTime = replay.fallTime || state.fallTime;

  // Rebuild note map from replay snapshot
  state.notes = replay.notes.map(n => ({
    time: n.time, endTime: n.endTime, lane: n.lane, isHold: !!n.isHold,
    judged: false, holding: false, holdProgress: 0,
  }));

  const durationMs = Math.ceil((audioBuffer.duration + 1.5) * 1000);

  // Bot mode replays the notes 100%. For a true "played by human" replay we'd
  // need to replay `replay.events`; for now we treat both cases as bot.
  state.botMode = true;

  // Kick off gameplay
  startPlay();

  try {
    const result = await recordCanvasToVideo({
      canvas,
      audioStream: tap.stream,
      durationMs,
      preferMp4: true,
      fileName: makeVideoFileName(replay),
      onProgress: (elapsed, total) => {
        const pct = Math.min(99, Math.round(elapsed / total * 100));
        if (onProgress) onProgress(pct);
      },
    });
    return result;
  } finally {
    try { state.gainNode.disconnect(tap); } catch {}
  }
}

function makeVideoFileName(replay) {
  const base = (replay.fileName || 'track').replace(/[^\w.-]+/g, '_').replace(/\.[a-z0-9]+$/i, '');
  return `weksim-${base}-${replay.difficulty || 'normal'}`;
}
