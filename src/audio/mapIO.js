// Etap 10: Export/import beatmaps as JSON.
//
// Use case: after tuning difficulty and calibration on a track you like,
// export the map so you can share it or restore it later without re-analysing.
// Import re-hydrates the analyzer result — no worker call needed.
//
// Format is intentionally simple and versioned. Future readers should
// tolerate unknown fields.

const FORMAT_VERSION = 1;

/**
 * Serialise the analyzer result + play-config as a plain JSON string.
 * Includes just enough context (fileName, hash, bpm) to identify the song,
 * but NOT the audio itself. User keeps the audio file separately.
 */
export function exportMap(analysis, meta) {
  const doc = {
    format: 'weksim-tiles-map',
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    meta: {
      fileName:    meta.fileName || '',
      fileHash:    meta.fileHash || '',
      durationSec: meta.durationSec || 0,
      mode:        meta.mode || 'classic',
      difficulty:  meta.difficulty || 'normal',
      sens:        meta.sens ?? 1.25,
      hpssMode:    meta.hpssMode || 'hard',
      holdMode:    meta.holdMode ?? 1,
    },
    bpm:           analysis.bpm,
    bpmConfidence: analysis.bpmConfidence,
    bpmStable:     analysis.bpmStable,
    beatTimes:     analysis.beatTimes || [],
    notes: (analysis.notes || []).map(n => ({
      t: +n.time.toFixed(4),
      e: +n.endTime.toFixed(4),
      l: n.lane,
      h: n.isHold ? 1 : 0,
    })),
  };
  return JSON.stringify(doc);
}

/**
 * Parse a JSON string back to an analyzer-shaped result. Notes get rehydrated
 * with the fields the game expects (judged, holding, holdProgress).
 */
export function importMap(jsonText) {
  const doc = JSON.parse(jsonText);
  if (doc.format !== 'weksim-tiles-map') {
    throw new Error('Not a Weksim-Tiles map file');
  }
  if (doc.version > FORMAT_VERSION) {
    console.warn('Map version ' + doc.version + ' newer than reader — trying anyway');
  }
  const notes = (doc.notes || []).map(n => ({
    time:    n.t,
    endTime: n.e,
    lane:    n.l,
    isHold:  !!n.h,
    judged:  false,
    holding: false,
    holdProgress: 0,
  })).sort((a, b) => a.time - b.time);

  return {
    notes,
    bpm:           doc.bpm || 120,
    bpmConfidence: doc.bpmConfidence || 0,
    bpmStable:     doc.bpmStable !== false,
    bpmDrift:      0,
    beatTimes:     doc.beatTimes || [],
    times:         notes.map(n => n.time),
    analysisMs:    0,
    fromCache:     false,
    fromImport:    true,
    difficulty:    doc.meta?.difficulty || 'normal',
    droppedByDensity: 0,
    // Info about the required song
    _importMeta:   doc.meta || {},
  };
}

/**
 * Trigger a download of the given map JSON in the browser.
 */
export function downloadMapFile(jsonText, suggestedName) {
  const blob = new Blob([jsonText], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName || 'weksim-map.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Read a File (from input[type=file]) into a text string.
 */
export function readMapFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}
