// Etap E (v1.24): Replay recording + playback + video export.
//
// The replay format is a compact JSON with everything needed to reproduce a
// play locally: the note map (deterministic from analysis), a list of input
// events (down/up + lane + time), and metadata (score, judgements, bot flag).
//
// Video export renders the game on an offscreen canvas driven by the same
// game loop, captures via MediaRecorder (WebM VP9 → optional WebM fallback,
// since MP4 support in MediaRecorder is uneven across browsers). If MP4 is
// requested and unavailable, we transparently fall back to WebM and tell
// the user in the download prompt.

let recording = null;   // { startCtxTime, events: [...], meta }
let stateRef = null;

/** Start capturing input events + score for this play session. */
export function startReplayRecording(state) {
  stateRef = state;
  recording = {
    startCtxTime: state.startTime || state.audioCtx?.currentTime || 0,
    fileName: state.fileName || '',
    fileHash: state.fileHash || '',
    mode: state.mode,
    difficulty: state.currentDifficulty || 'normal',
    sens: state.currentSens || 1.25,
    bpm: state.currentBpm || 0,
    fallTime: state.fallTime || 1.45,
    botMode: !!state.botMode,
    createdAt: Date.now(),
    events: [],
    // Note map snapshot (only the fields we need to redraw / replay)
    notes: (state.notes || []).map(n => ({
      time: n.time, endTime: n.endTime, lane: n.lane, isHold: !!n.isHold,
    })),
  };
}

/** Record a single input event. Called from judge.js/pressDown/pressUp. */
export function recordEvent(type, lane, ctxTime) {
  if (!recording) return;
  const t = ctxTime != null ? ctxTime - recording.startCtxTime : 0;
  recording.events.push({ type, lane, t });
}

/** Stop recording, finalise, return JSON string (or null if nothing). */
export function stopReplayRecording() {
  if (!recording) return null;
  recording.finalScore = stateRef?.score || 0;
  recording.maxCombo = stateRef?.maxCombo || 0;
  recording.perfects = stateRef?.perfects || 0;
  recording.goods = stateRef?.goods || 0;
  recording.misses = stateRef?.misses || 0;
  recording.holdsOk = stateRef?.holdsOk || 0;
  const json = JSON.stringify(recording);
  recording = null;
  stateRef = null;
  return json;
}

/** Currently recording? */
export function isRecording() { return recording !== null; }

/** Trigger a browser download for the given replay JSON. */
export function downloadReplay(json, suggestedName) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName || makeReplayFilename();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function makeReplayFilename() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `weksim-replay-${ts}.wtreplay.json`;
}

/**
 * Export a replay to a video file. Records the game canvas + audio via
 * MediaRecorder. Returns a Promise that resolves when the file is downloaded.
 *
 * Prerequisites: the replay must have been played back once (or the game
 * must currently be running) so there's actual visual/audio content to capture.
 *
 * @param {object} opts
 *   canvas         HTMLCanvasElement to capture
 *   audioStream    MediaStreamAudioDestinationNode.stream
 *   durationMs     total capture length (ms)
 *   preferMp4      try 'video/mp4;codecs=avc1,mp4a' first, else WebM
 *   fileName       download filename (extension auto-adjusted)
 *   onProgress?    fn(elapsedMs, totalMs)
 */
export function recordCanvasToVideo({ canvas, audioStream, durationMs, preferMp4 = true, fileName = 'weksim-replay', onProgress }) {
  return new Promise(async (resolve, reject) => {
    if (typeof MediaRecorder === 'undefined') {
      reject(new Error('MediaRecorder not supported'));
      return;
    }
    // Try MIME types in order of preference
    const candidates = preferMp4
      ? ['video/mp4;codecs=avc1,mp4a', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    let mime = '';
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c)) { mime = c; break; }
    }
    if (!mime) { reject(new Error('no supported video mime type')); return; }
    const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';

    const videoStream = canvas.captureStream(60);
    const combined = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...(audioStream ? audioStream.getAudioTracks() : []),
    ]);
    const recorder = new MediaRecorder(combined, {
      mimeType: mime,
      videoBitsPerSecond: 4_500_000,
      audioBitsPerSecond: 128_000,
    });
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onerror = e => reject(e.error || new Error('MediaRecorder error'));
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      resolve({ mime, ext, sizeBytes: blob.size });
    };
    recorder.start(1000); // 1s chunks

    // Progress ticker
    const t0 = performance.now();
    const progressId = setInterval(() => {
      const elapsed = performance.now() - t0;
      if (onProgress) onProgress(elapsed, durationMs);
      if (elapsed >= durationMs) {
        clearInterval(progressId);
        try { recorder.stop(); } catch (e) { reject(e); }
      }
    }, 100);
  });
}
