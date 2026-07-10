// FPS meter + frame-time tracker. Updated once per frame from the render loop.

export const perf = {
  fps: 60,
  frameMs: 16.7,
  minFps: Infinity,
  avgFps: 60,
  _accum: 0,
  _frames: 0,
  _last: 0,
  _samples: [],
};

// Call every frame with the current dt (seconds).
export function tickPerf(dt) {
  perf.frameMs = dt * 1000;
  perf._accum += dt;
  perf._frames++;
  perf._samples.push(dt);
  if (perf._samples.length > 240) perf._samples.shift();

  // Update once per 500ms so the counter doesn't jitter madly
  if (perf._accum >= 0.5) {
    perf.fps = Math.round(perf._frames / perf._accum);
    perf._accum = 0;
    perf._frames = 0;
    if (perf.fps < perf.minFps) perf.minFps = perf.fps;
  }
}

export function resetPerf() {
  perf.fps = 60;
  perf.minFps = Infinity;
  perf.avgFps = 60;
  perf._accum = 0;
  perf._frames = 0;
  perf._samples.length = 0;
}

// Called at end of song to summarise
export function summarisePerf() {
  if (!perf._samples.length) return { avg: 60, min: 60, p1: 60 };
  const sorted = [...perf._samples].sort((a, b) => b - a); // biggest dt first
  const p1Idx = Math.max(0, Math.floor(sorted.length * 0.01));
  const p1Dt = sorted[p1Idx];
  const p1Fps = Math.round(1 / p1Dt);
  const avgDt = perf._samples.reduce((a, b) => a + b, 0) / perf._samples.length;
  const avg = Math.round(1 / avgDt);
  const min = perf.minFps === Infinity ? avg : perf.minFps;
  perf.avgFps = avg;
  return { avg, min, p1: p1Fps };
}
