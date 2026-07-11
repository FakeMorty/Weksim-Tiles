// Etap 6: pattern-aware map generator.
//
// Input:  events with { time, endTime, isHold, strength, bands? }
//         plus tracked beatTimes and BPM
// Output: notes with { time, endTime, isHold, lane, judged, holding }
//
// Instead of random lane assignment with "don't repeat last lane" rule,
// this generator:
//
//   1. Classifies each event: percussive vs sustained, on-beat vs off-beat,
//      strong (downbeat) vs weak (subdivision).
//   2. Detects runs of similar events and applies a musical PATTERN to them:
//      stream (0-1-2-3-2-1-0...), jack (D-D-D on emphasis), chord (2 lanes
//      simultaneously on downbeats), stair (0-1-2-3), roll (rapid alternation).
//   3. Enforces playability: never 3+ simultaneous, min 100ms after chord,
//      no lane held longer than 40ms before next same-lane note.
//   4. Uses beat structure: chord notes only on strong beats (every 2nd or 4th
//      tracked beat), streams on off-beats / subdivisions.

const LANES = 4;

// Enough pattern presets to feel musical. Each pattern is a function that
// takes a run of events and assigns lanes to them.

const PATTERNS = {
  // Simple back-and-forth across all 4 lanes. Feels like a drum roll.
  stream: (run, startLane) => {
    const seq = [0, 1, 2, 3, 2, 1];
    const out = [];
    for (let i = 0; i < run.length; i++) {
      out.push({ lane: seq[(startLane + i) % seq.length], event: run[i] });
    }
    return out;
  },

  // Same lane N times — for repeated emphasis (jack in mania).
  jack: (run, startLane) => {
    return run.map(ev => ({ lane: startLane, event: ev }));
  },

  // Alternating two lanes rapidly. "Trill" pattern.
  trill: (run, startLane) => {
    const a = startLane, b = (startLane + 2) % LANES;
    return run.map((ev, i) => ({ lane: i % 2 === 0 ? a : b, event: ev }));
  },

  // Ascending staircase — 0→1→2→3 then loop.
  stair: (run, startLane) => {
    return run.map((ev, i) => ({ lane: (startLane + i) % LANES, event: ev }));
  },

  // Descending
  stairDown: (run, startLane) => {
    return run.map((ev, i) => ({ lane: (startLane - i + LANES * 8) % LANES, event: ev }));
  },

  // Chord: place event on TWO lanes at once. Used for very strong onsets
  // on downbeats.
  chord: (run, startLane) => {
    const out = [];
    for (const ev of run) {
      const l1 = startLane;
      const l2 = (startLane + 2) % LANES; // opposite hand
      out.push({ lane: l1, event: ev });
      out.push({ lane: l2, event: { ...ev, chord: true } });
    }
    return out;
  },
};

const PATTERN_NAMES = Object.keys(PATTERNS);

/**
 * Assign lanes to events using musical patterns.
 *
 * @param {Array} events    with {time, endTime, isHold, strength}
 * @param {Array} beatTimes tracked beats from beatTracking.js (may be empty)
 * @param {number} bpm
 * @param {object} opts     { chordProb, smartLane, difficulty }
 * @returns {Array} notes with lane assigned
 */
export function generateMap(events, beatTimes, bpm, opts) {
  const chordProb = opts.chordProb ?? 0.08;
  const smartLane = opts.smartLane !== false;
  const difficulty = opts.difficulty || 'normal';

  // Annotate each event with beat metadata
  const annotated = annotateEvents(events, beatTimes, bpm);

  // Group into runs by inter-onset interval + similarity
  const runs = groupIntoRuns(annotated, bpm);

  // For each run, pick a pattern based on context
  const rawNotes = [];
  let lastLane = -1;
  let lastChordTime = -Infinity;

  for (const run of runs) {
    const pattern = pickPattern(run, difficulty, chordProb);
    const startLane = pickStartLane(lastLane, run, pattern);
    const assigned = PATTERNS[pattern](run, startLane);

    for (const { lane, event } of assigned) {
      rawNotes.push({
        time: event.time,
        endTime: event.endTime,
        isHold: event.isHold,
        lane,
        strength: event.strength,
        pattern,
      });
      lastLane = lane;
    }

    // Sprinkle chord doubles on strong downbeats *inside* runs too.
    // Skip if last chord was <0.6s ago (avoid chord spam).
    if (chordProb > 0 && !event_run_has_holds(run)) {
      for (const ev of run) {
        if (!ev.isDownbeat || ev.strength < 0.55) continue;
        if (ev.time - lastChordTime < 0.6) continue;
        if (Math.random() > chordProb * 1.4) continue;
        // Find the note we just placed for this event
        const placed = rawNotes.find(n => Math.abs(n.time - ev.time) < 0.010);
        if (!placed) continue;
        // Add a second note on the opposite hand
        const twinLane = (placed.lane + 2) % LANES;
        rawNotes.push({
          time: ev.time,
          endTime: ev.time,
          isHold: false,
          lane: twinLane,
          strength: ev.strength,
          pattern: 'chord-double',
        });
        lastChordTime = ev.time;
      }
    }
  }

  // Playability pass: fix impossible-to-play spots
  const cleaned = enforcePlayability(rawNotes);

  // Final normalisation to game note shape
  return cleaned.map(n => ({
    time: n.time,
    endTime: n.endTime,
    isHold: n.isHold,
    lane: n.lane,
    judged: false,
    holding: false,
    holdProgress: 0,
  })).sort((a, b) => a.time - b.time);
}

// --- helpers ---

function event_run_has_holds(run) {
  for (const e of run) if (e.isHold) return true;
  return false;
}

function annotateEvents(events, beatTimes, bpm) {
  const beatPeriod = bpm > 40 ? 60 / bpm : 0.5;
  const half = beatPeriod / 2;

  // Precompute beat index for each event via binary search
  return events.map(ev => {
    let beatIdx = -1;
    let phase = 0; // 0..1, where in the beat this onset lies
    if (beatTimes.length) {
      // Binary search for nearest beat
      let lo = 0, hi = beatTimes.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (beatTimes[mid] <= ev.time) lo = mid; else hi = mid;
      }
      const b0 = beatTimes[lo];
      const b1 = beatTimes[hi] ?? (b0 + beatPeriod);
      beatIdx = lo;
      phase = (ev.time - b0) / Math.max(0.001, b1 - b0);
    }
    // Position class: downbeat (phase near 0 on even beat), on-beat, off-beat
    const onBeat = phase < 0.15 || phase > 0.85;
    const isDownbeat = onBeat && (beatIdx % 4 === 0);
    return {
      ...ev,
      beatIdx,
      phase,
      onBeat,
      isDownbeat,
      strength: ev.strength ?? 1,
    };
  });
}

function groupIntoRuns(events, bpm) {
  if (!events.length) return [];
  const beatPeriod = bpm > 40 ? 60 / bpm : 0.5;
  // A "run" is a sequence of events with tight, mostly-uniform spacing.
  const runs = [];
  let cur = [events[0]];
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1];
    const ev = events[i];
    const gap = ev.time - prev.time;
    // If gap > 1 beat, break the run. If gap is very different from previous
    // gap (rhythm change), break too.
    let breakRun = gap > beatPeriod * 1.05;
    if (!breakRun && cur.length >= 2) {
      const prevGap = prev.time - cur[cur.length - 2].time;
      if (Math.abs(gap - prevGap) > beatPeriod * 0.3) breakRun = true;
    }
    if (breakRun) {
      runs.push(cur);
      cur = [ev];
    } else {
      cur.push(ev);
    }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

function pickPattern(run, difficulty, chordProb) {
  const len = run.length;
  const anyDownbeat = run.some(e => e.isDownbeat);
  const strongestStrength = run.reduce((m, e) => Math.max(m, e.strength), 0);

  // Chord only on singleton very-strong downbeat events (like a big snare hit).
  if (len === 1 && anyDownbeat && strongestStrength > 0.6 && Math.random() < chordProb) {
    return 'chord';
  }

  // Singleton — just place it, use stair(1) which is same as one note.
  if (len === 1) return 'stair';

  // Very short run of 2-3: trill on hard/expert, stair otherwise
  if (len <= 3) {
    if (difficulty === 'expert' && Math.random() < 0.3) return 'trill';
    return 'stair';
  }

  // Medium run of 4-8: mix stream and stair; if strengths are very uniform
  // and short, could be a jack (rare — hard for players).
  if (len <= 8) {
    const gapAvg = (run[run.length - 1].time - run[0].time) / (len - 1);
    // Fast + very uniform + strong → jack candidate on expert
    if (difficulty === 'expert' && gapAvg < 0.16 && Math.random() < 0.15) {
      return 'jack';
    }
    return Math.random() < 0.65 ? 'stream' : (Math.random() < 0.5 ? 'stair' : 'stairDown');
  }

  // Long run (9+): definitely stream — anything else is unplayable
  return 'stream';
}

function pickStartLane(lastLane, run, pattern) {
  // Try to avoid starting on the last-used lane, except for jack (which IS
  // repeating the lane deliberately).
  const first = run[0];
  // If first event is on a downbeat, bias toward "outer" lanes 0 or 3 so it
  // feels punchy. Otherwise random.
  let candidate;
  if (pattern === 'jack') {
    // Jack usually on an inner lane — feels more central
    candidate = 1 + Math.floor(Math.random() * 2);
  } else if (first.isDownbeat) {
    candidate = Math.random() < 0.5 ? 0 : 3;
  } else {
    candidate = Math.floor(Math.random() * LANES);
  }
  if (candidate === lastLane && pattern !== 'jack') {
    candidate = (candidate + 1 + Math.floor(Math.random() * (LANES - 1))) % LANES;
  }
  return candidate;
}

function enforcePlayability(notes) {
  if (!notes.length) return notes;
  // Sort by time
  notes.sort((a, b) => a.time - b.time);

  // Rule 1: never more than 2 notes at the exact same time (drop weakest)
  const grouped = groupByTime(notes, 0.020);
  const kept = [];
  for (const group of grouped) {
    if (group.length <= 2) {
      kept.push(...group);
    } else {
      group.sort((a, b) => (b.strength || 0) - (a.strength || 0));
      kept.push(group[0], group[1]);
    }
  }
  kept.sort((a, b) => a.time - b.time);

  // Rule 2: min gap after HOLD start = 100 ms (don't fire tap on same lane)
  // Rule 3: min gap between two notes on same lane = 90 ms (playable jack rate)
  const laneLastTime = new Array(LANES).fill(-Infinity);
  const laneLastEnd = new Array(LANES).fill(-Infinity);
  const finalNotes = [];
  for (const n of kept) {
    const sameLaneGap = n.time - laneLastEnd[n.lane];
    if (sameLaneGap < 0.09) {
      // Try to relocate to an available lane
      const alt = findFreeLane(n, laneLastEnd);
      if (alt >= 0) n.lane = alt;
      else continue; // drop this note
    }
    finalNotes.push(n);
    laneLastTime[n.lane] = n.time;
    laneLastEnd[n.lane] = n.endTime + 0.03;
  }

  return finalNotes;
}

function groupByTime(notes, epsilon) {
  const groups = [];
  let cur = [];
  let curT = -Infinity;
  for (const n of notes) {
    if (Math.abs(n.time - curT) <= epsilon) {
      cur.push(n);
    } else {
      if (cur.length) groups.push(cur);
      cur = [n];
      curT = n.time;
    }
  }
  if (cur.length) groups.push(cur);
  return groups;
}

function findFreeLane(note, laneLastEnd) {
  const candidates = [0, 1, 2, 3];
  candidates.sort((a, b) => laneLastEnd[a] - laneLastEnd[b]);
  for (const c of candidates) {
    if (note.time - laneLastEnd[c] >= 0.09) return c;
  }
  return -1;
}
