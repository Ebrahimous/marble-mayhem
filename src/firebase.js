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

function lbCollection(mode) {
  return collection(db, `leaderboard_${mode}`);
}

/**
 * Fetch the top-N scores for a given mode, sorted highest first.
 * Returns an array of { name, score, date } objects.
 */
export async function fetchLeaderboard(mode) {
  const q = query(lbCollection(mode), orderBy('score', 'desc'), limit(TOP_N));
  const snap = await getDocs(q);
  return snap.docs.map(d => {
    const { name, score, date } = d.data();
    return { name, score, date };
  });
}

/**
 * Returns true if `score` would appear in the top-N for `mode`.
 */
export async function scoreQualifies(mode, score) {
  if (score <= 0) return false;
  const q = query(lbCollection(mode), orderBy('score', 'desc'), limit(TOP_N));
  const snap = await getDocs(q);
  if (snap.size < TOP_N) return true;
  const lowest = snap.docs[snap.size - 1].data().score;
  return score > lowest;
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
