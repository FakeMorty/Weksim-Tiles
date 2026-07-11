// Test Etap E replay recording.

import { startReplayRecording, recordEvent, stopReplayRecording, isRecording } from '../src/game/replay.js';

let pass = 0, fail = 0;
function check(name, cond, msg) {
  if (cond) { console.log('PASS ' + name); pass++; }
  else { console.log('FAIL ' + name + (msg ? ' — ' + msg : '')); fail++; }
}

// --- Test 1: start/stop cycle ---
{
  const mockState = {
    startTime: 100,
    fileName: 'test.mp3',
    fileHash: 'abc',
    mode: 'classic',
    currentDifficulty: 'hard',
    currentSens: 1.25,
    currentBpm: 120,
    fallTime: 1.5,
    botMode: false,
    notes: [
      { time: 1.0, endTime: 1.0, lane: 0, isHold: false },
      { time: 1.5, endTime: 2.5, lane: 2, isHold: true },
    ],
    score: 12345, maxCombo: 88, perfects: 40, goods: 5, misses: 2, holdsOk: 4,
  };
  startReplayRecording(mockState);
  check('recording started', isRecording());

  recordEvent('down', 0, 101.0);
  recordEvent('up',   0, 101.04);
  recordEvent('down', 2, 101.5);
  recordEvent('up',   2, 102.5);

  const json = stopReplayRecording();
  check('recording stopped, returns json', typeof json === 'string' && json.length > 100);
  check('not recording after stop', !isRecording());

  const r = JSON.parse(json);
  check('json includes 4 events', r.events.length === 4);
  check('event times are relative to startCtxTime',
        Math.abs(r.events[0].t - 1.0) < 0.001 && Math.abs(r.events[3].t - 2.5) < 0.001);
  check('note snapshot preserved', r.notes.length === 2);
  check('meta preserves file/difficulty', r.fileName === 'test.mp3' && r.difficulty === 'hard');
  check('final score captured', r.finalScore === 12345 && r.maxCombo === 88);
}

// --- Test 2: recordEvent no-op when not recording ---
{
  recordEvent('down', 0, 1.0); // should not throw
  const json = stopReplayRecording();
  check('stopReplayRecording returns null when not recording', json === null);
}

// --- Test 3: replay JSON round-trips ---
{
  startReplayRecording({
    startTime: 0, fileName: 'x', mode: 'drums', currentDifficulty: 'easy',
    currentBpm: 80, fallTime: 1.2, notes: [], botMode: true,
    score: 0, maxCombo: 0, perfects: 0, goods: 0, misses: 0, holdsOk: 0,
  });
  const json = stopReplayRecording();
  const r = JSON.parse(json);
  const json2 = JSON.stringify(r);
  const r2 = JSON.parse(json2);
  check('replay JSON round-trips cleanly', r2.mode === 'drums' && r2.botMode === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
