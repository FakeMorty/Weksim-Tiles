// Central configuration constants. Etap 0 = keep parity with v1.1.
// Later etaps will extend this with judge windows, camera shake, etc.

export const LANES = 4;

// Displayed in the corner and results screen so we know which build is running.
export const APP_VERSION = '1.24.0';

// Judge windows (seconds) — base values, multiplied by calibration.judgeMultiplier() at runtime.
// v1.2: 6 tiers instead of 3 for finer feedback. MISS = anything past OK.
export const JUDGE = {
  MARVELOUS: 0.025,
  PERFECT:   0.048,
  GREAT:     0.085,
  GOOD:      0.135,
  OK:        0.190,
  MISS:      0.200,
  HOLD_START:      0.180,
  HOLD_PERFECT:    0.060,
  HOLD_MARVELOUS:  0.030,
  HOLD_END_TOL:    0.180,
  HOLD_LATE_FORCE: 0.180,
};

// Scoring
export const SCORE = {
  MARVELOUS: 350,
  PERFECT:   300,
  GREAT:     220,
  GOOD:      140,
  OK:         70,
  HOLD_START_MARVELOUS: 260,
  HOLD_START_PERFECT:   220,
  HOLD_START_GOOD:      120,
  HOLD_COMPLETE_BASE:   420,
  HOLD_COMPLETE_PER_SEC: 180,
  HOLD_TICK: 4,
  COMBO_BONUS_MAX_TAP:  160,
  COMBO_BONUS_MAX_HOLD: 120,
};

// Colours per judgement tier
export const JUDGE_COLORS = {
  MARVELOUS: '#fff4a3',
  PERFECT:   '#7dfffa',
  GREAT:     '#7aff99',
  GOOD:      '#ffb066',
  OK:        '#ffd86a',
  MISS:      '#ff5566',
  BREAK:     '#ff6a7a',
  HOLD_START:'#9efbff',
  HOLD_PERF: '#ff9dff',
  HOLD_OK:   '#cafffd',
};

// Lane colours (index by lane 0..3)
export const LANE_COLORS = ['#39eaff', '#61ffa7', '#ffae3a', '#ff55c6'];

// Keyboard mapping (KeyboardEvent.code → lane)
export const KEY_MAP = {
  KeyD:0, KeyA:0, Digit1:0, Numpad1:0,
  KeyF:1, KeyS:1, Digit2:1, Numpad2:1,
  KeyJ:2, KeyL:2, Digit3:2, Semicolon:2, Numpad3:2,
  KeyK:3, Quote:3, Digit4:3, KeySemicolon:3, Numpad4:3,
};

// Renderer
export const RENDER = {
  HIT_Y_RATIO: 0.82,
  PLAY_W_MAX: 590,
  PLAY_W_RATIO: 0.92,
  DPR_MAX: 2,
};

// Analyzer defaults (legacy v1.1 values, will be reworked in Etap 1)
export const ANALYZER = {
  FRAME_SIZE: 1024,
  HOP: 512,
};
