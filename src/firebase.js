/**
 * firebase.js — Firestore leaderboard client
 *
 * One collection per mode (e.g. "leaderboard_mayhem", "leaderboard_solo-time")
 * so queries only need orderBy('score') — no composite index required.
 *
 * Firestore security rules:
 *   match /{collection}/{entry} {
 *     allow read, create: if collection.matches('leaderboard_.*');
 *     allow update, delete: if false;
 *   }
 */

import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore,
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAAZ9P9RA5oXPnkXq7mAqqwp40xWDHn0qs",
  authDomain: "marblesmayhem.firebaseapp.com",
  projectId: "marblesmayhem",
  storageBucket: "marblesmayhem.firebasestorage.app",
  messagingSenderId: "585510367570",
  appId: "1:585510367570:web:76381653e5407509fe0a8b",
};

// Avoid re-initialising on hot reload
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db  = getFirestore(app);

// Each mode gets its own collection — avoids needing a composite index.
// e.g. "leaderboard_mayhem", "leaderboard_solo-time", etc.
const TOP_N = 10;
// Fetch extra docs so deduplication still yields TOP_N unique names
const FETCH_N = TOP_N * 5;

function lbCollection(mode) {
  return collection(db, `leaderboard_${mode}`);
}

/**
 * Deduplicate entries, keeping only the highest score per player name.
 * Returns the top TOP_N unique players, sorted by score descending.
 */
function dedupeByName(docs) {
  const best = new Map(); // name → { name, score, date }
  for (const d of docs) {
    const { name, score, date } = d.data();
    const key = (name || 'Player').trim().toLowerCase();
    if (!best.has(key) || score > best.get(key).score) {
      best.set(key, { name: name || 'Player', score, date });
    }
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);
}

/**
 * Fetch the top-N scores for a given mode, sorted highest first.
 * Each player name appears at most once (their personal best).
 */
export async function fetchLeaderboard(mode) {
  const q = query(lbCollection(mode), orderBy('score', 'desc'), limit(FETCH_N));
  const snap = await getDocs(q);
  return dedupeByName(snap.docs);
}

/**
 * Returns true if `score` would appear in the top-N for `mode`
 * (accounting for per-player deduplication).
 */
export async function scoreQualifies(mode, score) {
  if (score <= 0) return false;
  const q = query(lbCollection(mode), orderBy('score', 'desc'), limit(FETCH_N));
  const snap = await getDocs(q);
  const unique = dedupeByName(snap.docs);
  if (unique.length < TOP_N) return true;
  return score > unique[unique.length - 1].score;
}

/**
 * Save a leaderboard entry.
 */
export async function saveScore(mode, name, score) {
  await addDoc(lbCollection(mode), {
    name: name.trim() || 'Player',
    score,
    date: new Date().toISOString().slice(0, 10),
    createdAt: serverTimestamp(),
  });
}
