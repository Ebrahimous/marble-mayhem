/**
 * sounds.js — synthesized glass-marble sound effects.
 *
 * No audio asset files: every effect is generated on the fly with the Web
 * Audio API using short sine/triangle tones, bright high harmonics, and fast
 * exponential decays — evoking the bright "clink" and "ring" of glass
 * marbles knocking together.
 *
 * Safe to import and call from anywhere (engine, reducers, components). On
 * platforms without Web Audio (native/SSR) every function is a silent no-op,
 * so this can be wired in now and revisited for native builds later.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const MUTE_KEY = 'soundMuted';

let ctx = null;
let muted = false;
let loaded = false;

// Lazily load the persisted mute preference (once).
function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(MUTE_KEY).then(v => { muted = v === 'true'; });
}

export function isMuted() {
  ensureLoaded();
  return muted;
}

export function setMuted(v) {
  muted = !!v;
  loaded = true;
  AsyncStorage.setItem(MUTE_KEY, muted ? 'true' : 'false');
}

export function toggleMuted() {
  setMuted(!isMuted());
  return muted;
}

// Lazily create (and resume) the shared AudioContext. Browsers only allow
// this inside a user-gesture handler, which is how every sound here is
// triggered (taps, swipes, button presses).
function getCtx() {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/**
 * Play a bright glass "ping": a fundamental tone plus a couple of higher
 * inharmonic partials (glass rings brighter & less harmonically than metal),
 * each with a fast attack and exponential decay.
 */
function ping(freq, { dur = 0.18, gain = 0.18, delay = 0, harmonics = [1, 2.76, 4.5] } = {}) {
  ensureLoaded();
  if (muted) return;
  const ac = getCtx();
  if (!ac) return;
  const t0 = ac.currentTime + delay;

  harmonics.forEach((mult, i) => {
    const osc = ac.createOscillator();
    osc.type = i === 0 ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(freq * mult, t0);

    const g = ac.createGain();
    const peak = gain / (i + 1);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g);
    g.connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  });
}

/** A short pitch sweep — used for balls flying in from the top/bottom edges. */
function sweep(f0, f1, { dur = 0.18, gain = 0.09, delay = 0 } = {}) {
  ensureLoaded();
  if (muted) return;
  const ac = getCtx();
  if (!ac) return;
  const t0 = ac.currentTime + delay;

  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f0, t0);
  osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur);

  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(g);
  g.connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/** A low, dull tone — used for the penalty ball landing on the opponent. */
function thud({ dur = 0.22, gain = 0.25, delay = 0 } = {}) {
  ensureLoaded();
  if (muted) return;
  const ac = getCtx();
  if (!ac) return;
  const t0 = ac.currentTime + delay;

  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(170, t0);
  osc.frequency.exponentialRampToValueAtTime(60, t0 + dur);

  const g = ac.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(g);
  g.connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

// ── Public sound effects ────────────────────────────────────────────────────

/** Light marble clink — played when a column/row slide is attempted. */
export function playMove() {
  ping(1900, { dur: 0.09, gain: 0.10, harmonics: [1, 2.4] });
}

/** Bright pop/chime — played when a match clears, scaled by ball count. */
export function playMatch(cleared = 3) {
  const base = 1100 + Math.min(cleared, 6) * 60;
  ping(base, { dur: 0.30, gain: 0.22, harmonics: [1, 2, 3] });
  ping(base * 1.5, { dur: 0.22, gain: 0.12, delay: 0.04, harmonics: [1, 2] });
}

/** Ascending bell arpeggio — played for chain reactions (chains >= 2). */
export function playChain(chains = 2) {
  const notes = [880, 1175, 1568, 1976, 2349];
  const n = Math.min(chains + 1, notes.length);
  for (let i = 0; i < n; i++) {
    ping(notes[i], { dur: 0.35, gain: 0.18, delay: i * 0.09, harmonics: [1, 2.4, 4] });
  }
}

/**
 * New ball flying onto the board: a quick pitch sweep in the direction the
 * ball travels — falling pitch for balls dropping in from the top, rising
 * pitch for balls floating up from the bottom.
 */
export function playSpawn(side = 'top') {
  if (side === 'bottom') sweep(500, 1500, { dur: 0.16, gain: 0.07 });
  else sweep(1700, 600, { dur: 0.16, gain: 0.07 });
}

/** Dull thud — a penalty ball lands on the opponent's board. */
export function playPenalty() {
  thud({ dur: 0.22, gain: 0.25 });
}

/** Cheerful ascending chime — round won. */
export function playWin() {
  [880, 1175, 1568, 2349].forEach((f, i) =>
    ping(f, { dur: 0.5, gain: 0.2, delay: i * 0.12, harmonics: [1, 2, 3] }));
}

/** Descending minor chime — round lost. */
export function playLose() {
  [660, 587, 494, 392].forEach((f, i) =>
    ping(f, { dur: 0.5, gain: 0.18, delay: i * 0.13, harmonics: [1, 1.5] }));
}

/** Neutral two-note chime — a draw, or a solo round simply ending. */
export function playRoundEnd() {
  [660, 660].forEach((f, i) =>
    ping(f, { dur: 0.4, gain: 0.16, delay: i * 0.18, harmonics: [1, 2] }));
}

/** Soft tick — generic UI button press (menus, pause, reset, toggles). */
export function playClick() {
  ping(1200, { dur: 0.07, gain: 0.09, harmonics: [1, 2] });
}
