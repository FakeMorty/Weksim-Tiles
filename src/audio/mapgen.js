// Etap 6 + v1.19 fix: musical map generator.
//
// Input:  events with { time, endTime, isHold, strength, bands }
//         plus tracked beatTimes and BPM.
//         `bands` is a length-6 array of energy per frequency band from the
//         analyzer worker: [sub-bass, bass, low-mid, mid, high-mid, high].
// Output: notes with { time, endTime, isHold, lane, judged, holding }.
//
// Design principles after real-world testing on a 122 BPM track:
//
//   1. **Musical lane assignment**: kick drums go to outer lanes (0, 3),
//      snare hits go to inner lanes (1, 2), hi-hats/cymbals alternate
//      across all lanes. This gives the map a physical logic — you feel
//      the low end on your pinkies and the mid punch on your index fingers.
//
//   2. **Anti-monotony on long streams**: the previous version produced
//      1332 sequential ±1 lane steps on a dense EXPERT map — a literal
//      staircase for four minutes. Now every 6-10 notes we insert a lane
//      jump (±2 or ±3) to break the pattern.
//
//   3. **Difficulty scaling via CHOICES, not just density**: EASY uses
//      simple patterns, NORMAL adds trills and stairs, HARD adds jumps
//      and jack, EXPERT unlocks chord doubles and rapid direction changes.

const LANES = 4;

// Band indices from src/audio/spectralFlux.js — kept in sync there.
// [0] sub-bass 20-60Hz, [1] bass 60-250Hz, [2] low-mid 250-500Hz,
// [3] mid 500-2000Hz, [4] high-mid 2000-4000Hz, [5] high 4000-16000Hz.
const B_SUB_BASS = 0, B_BASS = 1, B_LOW_MID = 2, B_MID = 3, B_HIGH_MID = 4, B_HIGH = 5;

// Classify a percussive onset by its band-energy fingerprint.
// Returns one of: 'kick', 'snare', 'hihat', 'melodic', 'unknown'.
function classifyOnset(bands) {
  if (!bands || bands.length < 6) return 'unknown';
  const total = bands.reduce((s, v) => s + v, 0);
  if (total < 1e-6) return 'unknown';
  // Normalise to fractions
  const f = bands.map(v => v / total);

  // Kick: dominant sub-bass + bass, weak high
  const lowShare = f[B_SUB_BASS] + f[B_BASS];
  const highShare = f[B_HIGH_MID] + f[B_HIGH];
  const midShare = f[B_MID];

  if (lowShare > 0.55 && highShare < 0.20) return 'kick';
  // Snare: strong low-mid (200-500) + high-mid crack; less sub-bass
  if (f[B_LOW_MID] > 0.20 && highShare > 0.20 && lowShare < 0.45) return 'snare';
  // Hi-hat / cymbal: dominant high
  if (highShare > 0.50 && lowShare < 0.25) return 'hihat';
  // Melodic / vocal: dominant mid
  if (midShare > 0.35 && lowShare < 0.35) return 'melodic';
  return 'unknown';
}

// --- pattern library ---------------------------------------------------

const PATTERNS = {
  // Simple back-and-forth across all 4 lanes. Feels like a drum roll.
  stream: (run, startLane) => {
    const seq = [0, 1, 2, 3, 2, 1];
    return run.map((ev, i) => ({ lane: seq[(startLane + i) % seq.length], event: ev }));
  },
  // Same lane N times — for repeated emphasis
  jack: (run, startLane) => run.map(ev => ({ lane: startLane, event: ev })),
  // Alternating two lanes rapidly
  trill: (run, startLane) => {
    const a = startLane, b = (startLane + 2) % LANES;
    return run.map((ev, i) => ({ lane: i % 2 === 0 ? a : b, event: ev }));
  },
  stair:     (run, startLane) => run.map((ev, i) => ({ lane: (startLane + i) % LANES, event: ev })),
  stairDown: (run, startLane) => run.map((ev, i) => ({ lane: (startLane - i + LANES * 8) % LANES, event: ev })),
  // Chord: same-time notes on TWO lanes
  chord: (run, startLane) => {
    const out = [];
    for (const ev of run) {
      out.push({ lane: startLane, event: ev });
      out.push({ lane: (startLane + 2) % LANES, event: { ...ev, chord: true } });
    }
    return out;
  },
  // v1.19: broken stream — like stream but every 6-10 notes takes a random
  // ±2 or ±3 lane jump instead of the next ±1 step. Kills monotony.
  brokenStream: (run, startLane) => {
    const out = [];
    let lane = startLane;
    let dir = 1;
    let untilBreak = 6 + Math.floor(Math.random() * 5); // 6..10
    for (let i = 0; i < run.length; i++) {
      out.push({ lane, event: run[i] });
      untilBreak--;
      if (untilBreak <= 0) {
        // Jump ±2 or ±3
        const jumpAbs = Math.random() < 0.6 ? 2 : 3;
        const jumpDir = Math.random() < 0.5 ? 1 : -1;
        lane = ((lane + jumpAbs * jumpDir) % LANES + LANES) % LANES;
        dir = -dir; // flip direction after jump
        untilBreak = 6 + Math.floor(Math.random() * 5);
      } else {
        // Regular ±1 step, bounce off edges
        const nextLane = lane + dir;
        if (nextLane < 0 || nextLane >= LANES) { dir = -dir; lane = lane + dir; }
        else lane = nextLane;
      }
    }
    return out;
  },
};

// --- main entry --------------------------------------------------------

/**
 * @param {Array} events    with {time, endTime, isHold, strength, bands}
 * @param {Array} beatTimes tracked beats from beatTracking.js (may be empty)
 * @param {number} bpm
 * @param {object} opts     { chordProb, smartLane, difficulty, downbeatIndices, downbeatConfidence }
 */
export function generateMap(events, beatTimes, bpm, opts) {
  const chordProb = opts.chordProb ?? 0.08;
  const difficulty = opts.difficulty || 'normal';
  const downbeatIndices = opts.downbeatIndices || [];
  const downbeatConfidence = opts.downbeatConfidence || 0;

  // Classify each onset. Etap C (v1.22): if source separation gave us a
  // direct tag (kick/snare/hihat/melody), trust it — it's far more accurate
  // than band-signature guessing. Fall back to bands otherwise.
  for (const ev of events) {
    if (ev.source === 'kick' || ev.source === 'snare' || ev.source === 'hihat') {
      ev.role = ev.source;
    } else if (ev.source === 'melody') {
      ev.role = 'melodic';
    } else {
      ev.role = classifyOnset(ev.bands);
    }
  }

  const annotated = annotateEvents(events, beatTimes, bpm, downbeatIndices, downbeatConfidence);
  // Etap E (v1.24): musical phrasing pass — thin dense runs, insert breaths
  // after long holds. This is what turns "every-onset-a-note" transcription
  // into something that plays like a real chart.
  const phrased = phraseFilter(annotated, bpm, difficulty);
  const runs = groupIntoRuns(phrased, bpm);

  const rawNotes = [];
  let lastLane = -1;
  let lastChordTime = -Infinity;

  for (const run of runs) {
    // v1.19: on EXPERT+ HARD, use musical routing (kick→outer, snare→inner,
    // hihat→alternating). Falls back to pattern-based when band info is
    // missing or when the run is very short.
    const useMusicalRoute = (difficulty === 'expert' || difficulty === 'hard')
      && run.length >= 3
      && run.some(e => e.role !== 'unknown');

    let assigned;
    if (useMusicalRoute) {
      assigned = routeByMusicalRole(run, lastLane, difficulty);
    } else {
      const pattern = pickPattern(run, difficulty, chordProb);
      const startLane = pickStartLane(lastLane, run, pattern);
      assigned = PATTERNS[pattern](run, startLane);
    }

    for (const { lane, event } of assigned) {
      rawNotes.push({
        time: event.time,
        endTime: event.endTime,
        isHold: event.isHold,
        lane,
        strength: event.strength,
        role: event.role,
      });
      lastLane = lane;
    }

    // Chord doubles on strong downbeats (unchanged from v1.18)
    if (chordProb > 0 && !event_run_has_holds(run)) {
      for (const ev of run) {
        if (!ev.isDownbeat || ev.strength < 0.55) continue;
        if (ev.time - lastChordTime < 0.6) continue;
        if (Math.random() > chordProb * 1.4) continue;
        const placed = rawNotes.find(n => Math.abs(n.time - ev.time) < 0.010);
        if (!placed) continue;
        const twinLane = (placed.lane + 2) % LANES;
        rawNotes.push({
          time: ev.time,
          endTime: ev.time,
          isHold: false,
          lane: twinLane,
          strength: ev.strength,
          role: 'chord-double',
        });
        lastChordTime = ev.time;
      }
    }
  }

  const cleaned = enforcePlayability(rawNotes);

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

// --- musical routing ---------------------------------------------------

/**
 * Assign lanes based on the drum-role classification of each event.
 *
 *   kick   → outer lanes (0 or 3), alternating between them
 *   snare  → inner lanes (1 or 2), alternating between them
 *   hihat  → all four lanes with anti-jack (never same lane twice in a row)
 *   melodic/unknown → follow the previous hi-hat pattern
 *
 * This gives the map a physical logic: the low thud lives under your pinkies
 * and the snap lives under your index fingers, exactly like a real drum kit
 * laid out on the keyboard.
 */
function routeByMusicalRole(run, seedLastLane, difficulty) {
  const out = [];
  let lastKickLane = 3;   // start opposite so first kick lands on 0
  let lastSnareLane = 2;  // same, first snare lands on 1
  let lastHihatLane = seedLastLane >= 0 ? seedLastLane : 1;
  let hihatDir = 1;
  let noteInStream = 0;

  for (const ev of run) {
    let lane;
    switch (ev.role) {
      case 'kick':
        // Alternate outer lanes 0↔3
        lane = lastKickLane === 0 ? 3 : 0;
        lastKickLane = lane;
        break;

      case 'snare':
        // Alternate inner lanes 1↔2
        lane = lastSnareLane === 1 ? 2 : 1;
        lastSnareLane = lane;
        break;

      case 'hihat': {
        // Walk across lanes; on HARD add rare ±2 jumps to add texture
        let next = lastHihatLane + hihatDir;
        if (next < 0 || next >= LANES) { hihatDir = -hihatDir; next = lastHihatLane + hihatDir; }
        // Every 8-12 hi-hats jump ±2 for variety, more often on EXPERT
        const jumpProb = difficulty === 'expert' ? 0.12 : 0.07;
        if (Math.random() < jumpProb) {
          next = ((lastHihatLane + (hihatDir * 2)) % LANES + LANES) % LANES;
          hihatDir = -hihatDir;
        }
        lane = next;
        lastHihatLane = lane;
        break;
      }

      default:
        // Melodic / unknown — follow the hi-hat walker so at least the map
        // stays cohesive rather than jumping randomly.
        lane = (lastHihatLane + hihatDir + LANES) % LANES;
        lastHihatLane = lane;
    }

    // Anti-monotony: if same lane 3+ times in a row, force a jump
    if (out.length >= 2 && out[out.length - 1].lane === lane && out[out.length - 2].lane === lane) {
      lane = (lane + 2) % LANES;
    }

    out.push({ lane, event: ev });
    noteInStream++;
  }
  return out;
}

// --- run grouping + annotation ----------------------------------------

function event_run_has_holds(run) {
  for (const e of run) if (e.isHold) return true;
  return false;
}

/**
 * Etap E (v1.24): Musical phrasing filter.
 *
 * Real-world charts don't put a note on every single onset — they thin out
 * dense fills, keep the downbeats, and give the player a moment to breathe
 * after long sustained notes. This function does three passes:
 *
 * 1. **Breath after HOLD**: any event landing within 250 ms after a hold's
 *    endTime gets dropped (unless it's a downbeat with strong energy). Lets
 *    the hand recover.
 * 2. **Thin dense runs**: within a burst of >6 events tighter than a 1/8th
 *    note interval, only keep downbeats + top-K by strength. K depends on
 *    difficulty (Easy → keep fewer, Expert → keep more).
 * 3. **Weak-onset drop on downbeats**: if an event is under 30% of the
 *    surrounding median strength AND it's not on a downbeat AND its
 *    neighbours are strong — drop it (it's likely a bleed from the previous
 *    hit or a false onset the source separation didn't fully suppress).
 */
function phraseFilter(events, bpm, difficulty) {
  if (!events.length) return events;
  const beatPeriod = bpm > 40 ? 60 / bpm : 0.5;
  const eighth = beatPeriod / 2;

  // Per-difficulty tuning
  const cfg = {
    easy:   { keepFrac: 0.45, breathMs: 320, weakThr: 0.28 },
    normal: { keepFrac: 0.60, breathMs: 260, weakThr: 0.30 },
    hard:   { keepFrac: 0.75, breathMs: 200, weakThr: 0.33 },
    expert: { keepFrac: 0.88, breathMs: 140, weakThr: 0.35 },
  }[difficulty || 'normal'] || { keepFrac: 0.60, breathMs: 260, weakThr: 0.30 };

  // Pass 1: breath after hold — mark drops
  const drops = new Set();
  for (let i = 0; i < events.length - 1; i++) {
    const ev = events[i];
    if (!ev.isHold) continue;
    const holdEnd = ev.endTime ?? (ev.time + 0.3);
    const breathUntil = holdEnd + (cfg.breathMs / 1000);
    for (let j = i + 1; j < events.length; j++) {
      const nxt = events[j];
      if (nxt.time >= breathUntil) break;
      // Keep it if it's a downbeat with above-average strength
      if (nxt.isDownbeat && nxt.strength > 1.0) continue;
      drops.add(j);
    }
  }

  // Pass 2: dense-run thinning
  // Scan windows of consecutive events with gaps < 1/8th note, keep top-K by
  // strength (always keep downbeats).
  let i = 0;
  while (i < events.length) {
    let j = i;
    while (j + 1 < events.length && (events[j + 1].time - events[j].time) < eighth) j++;
    const runLen = j - i + 1;
    if (runLen > 6) {
      const keepCount = Math.max(3, Math.ceil(runLen * cfg.keepFrac));
      // Sort indices in [i..j] by score (downbeat priority + strength)
      const idx = [];
      for (let k = i; k <= j; k++) {
        const ev = events[k];
        const score = (ev.isDownbeat ? 100 : 0) + (ev.strength ?? 1);
        idx.push({ k, score });
      }
      idx.sort((a, b) => b.score - a.score);
      const keep = new Set(idx.slice(0, keepCount).map(x => x.k));
      for (let k = i; k <= j; k++) {
        if (!keep.has(k)) drops.add(k);
      }
    }
    i = j + 1;
  }

  // Pass 3: weak-onset filter
  // For each non-downbeat, non-hold event, look at strengths of the 3 nearest
  // neighbours; if ours is far below the median, drop it.
  for (let k = 0; k < events.length; k++) {
    if (drops.has(k)) continue;
    const ev = events[k];
    if (ev.isDownbeat || ev.isHold) continue;
    const neighbours = [];
    for (let dj = -3; dj <= 3; dj++) {
      if (dj === 0) continue;
      const nb = events[k + dj];
      if (nb) neighbours.push(nb.strength ?? 1);
    }
    if (neighbours.length < 3) continue;
    neighbours.sort((a, b) => a - b);
    const median = neighbours[neighbours.length >> 1];
    if ((ev.strength ?? 1) < median * cfg.weakThr) drops.add(k);
  }

  // Emit only survivors
  if (drops.size === 0) return events;
  return events.filter((_, i) => !drops.has(i));
}

function annotateEvents(events, beatTimes, bpm, downbeatIndices, downbeatConfidence) {
  const beatPeriod = bpm > 40 ? 60 / bpm : 0.5;
  // v1.20: downbeatIndices comes from real downbeat detection in worker
  // (using bass energy correlation). Falls back to naïve every-4th only if
  // detection was weak (confidence < 0.15) or absent.
  const useRealDownbeats = downbeatIndices && downbeatIndices.length > 0 && downbeatConfidence >= 0.15;
  const downbeatSet = useRealDownbeats ? new Set(downbeatIndices) : null;

  return events.map(ev => {
    let beatIdx = -1;
    let phase = 0;
    if (beatTimes.length) {
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
    const onBeat = phase < 0.15 || phase > 0.85;
    // Real downbeat if we're on-beat AND that beat index is in the detected
    // downbeat set. Fallback to every-4th-beat naïve rule.
    const isDownbeat = onBeat && (
      useRealDownbeats
        ? downbeatSet.has(beatIdx)
        : (beatIdx % 4 === 0)
    );
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
  const runs = [];
  let cur = [events[0]];
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1];
    const ev = events[i];
    const gap = ev.time - prev.time;
    let breakRun = gap > beatPeriod * 1.05;
    if (!breakRun && cur.length >= 2) {
      const prevGap = prev.time - cur[cur.length - 2].time;
      if (Math.abs(gap - prevGap) > beatPeriod * 0.3) breakRun = true;
    }
    // v1.19: also break long runs into ~16-note chunks so we can rotate
    // patterns even inside a continuous stream. Prevents the 1300-note-in-a-row
    // scenario that produced a monotone staircase.
    if (!breakRun && cur.length >= 16) breakRun = true;
    if (breakRun) { runs.push(cur); cur = [ev]; }
    else cur.push(ev);
  }
  if (cur.length) runs.push(cur);
  return runs;
}

function pickPattern(run, difficulty, chordProb) {
  const len = run.length;
  const anyDownbeat = run.some(e => e.isDownbeat);
  const strongestStrength = run.reduce((m, e) => Math.max(m, e.strength), 0);

  if (len === 1 && anyDownbeat && strongestStrength > 0.6 && Math.random() < chordProb) {
    return 'chord';
  }
  if (len === 1) return 'stair';

  if (len <= 3) {
    if (difficulty === 'expert' && Math.random() < 0.3) return 'trill';
    return 'stair';
  }

  if (len <= 8) {
    const gapAvg = (run[run.length - 1].time - run[0].time) / (len - 1);
    if (difficulty === 'expert' && gapAvg < 0.16 && Math.random() < 0.15) {
      return 'jack';
    }
    // v1.19: rotate through several stream variants instead of pinning to 'stream'
    const options = ['stream', 'stair', 'stairDown', 'brokenStream'];
    if (difficulty === 'hard' || difficulty === 'expert') options.push('trill', 'brokenStream');
    return options[Math.floor(Math.random() * options.length)];
  }

  // v1.19: long runs (9+) — use brokenStream to inject jumps, not the
  // monotone stream that produced the staircase bug.
  const longOptions = difficulty === 'easy'
    ? ['stream', 'stair']
    : ['brokenStream', 'brokenStream', 'stream', 'stairDown']; // 2x weight
  return longOptions[Math.floor(Math.random() * longOptions.length)];
}

function pickStartLane(lastLane, run, pattern) {
  const first = run[0];
  let candidate;
  if (pattern === 'jack') {
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

// --- playability enforcement (unchanged) -------------------------------

function enforcePlayability(notes) {
  if (!notes.length) return notes;
  notes.sort((a, b) => a.time - b.time);

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

  const laneLastEnd = new Array(LANES).fill(-Infinity);
  const finalNotes = [];
  for (const n of kept) {
    const sameLaneGap = n.time - laneLastEnd[n.lane];
    if (sameLaneGap < 0.09) {
      const alt = findFreeLane(n, laneLastEnd);
      if (alt >= 0) n.lane = alt;
      else continue;
    }
    finalNotes.push(n);
    laneLastEnd[n.lane] = n.endTime + 0.03;
  }
  return finalNotes;
}

function groupByTime(notes, epsilon) {
  const groups = [];
  let cur = [];
  let curT = -Infinity;
  for (const n of notes) {
    if (Math.abs(n.time - curT) <= epsilon) cur.push(n);
    else {
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
