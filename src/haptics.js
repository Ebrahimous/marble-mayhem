/**
 * haptics.js — Vibration API wrapper for Marble Mayhem
 *
 * Uses the Web Vibration API (navigator.vibrate), which is supported on
 * Android Chrome/Firefox. iOS Safari does not support it — calls are
 * silently ignored. No error is thrown on unsupported browsers.
 *
 * Enabled state is persisted via AsyncStorage ('hapticsEnabled').
 * Import setHapticsEnabled / isHapticsEnabled to read and write it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const HAPTICS_KEY = 'hapticsEnabled';

let enabled = true;
let loaded  = false;

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(HAPTICS_KEY).then(v => {
    // Default to true — only false if the user explicitly turned it off.
    enabled = v !== 'false';
  });
}

/** Returns whether haptics are currently enabled. */
export function isHapticsEnabled() {
  ensureLoaded();
  return enabled;
}

/** Toggle haptics on/off and persist the preference. */
export function setHapticsEnabled(value) {
  enabled = !!value;
  loaded  = true;
  AsyncStorage.setItem(HAPTICS_KEY, enabled ? 'true' : 'false');
}

function vibe(pattern) {
  ensureLoaded();
  if (!enabled) return;
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(pattern);
  }
}

/** Short tap — button presses, UI interactions. */
export function vibrateClick()    { vibe(10); }

/** Single match — satisfying pulse. */
export function vibrateMatch()    { vibe(30); }

/** Chain match — double pulse to signal the chain. */
export function vibrateChain()    { vibe([30, 50, 30]); }

/** Power-up activated (freeze, bomb, tbomb). */
export function vibratePowerUp()  { vibe([20, 30, 60]); }

/** Game over — long rumble. */
export function vibrateGameOver() { vibe(200); }
