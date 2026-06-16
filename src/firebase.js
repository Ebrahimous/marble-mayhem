/**
 * firebase.js — Firestore leaderboard client
 *
 * Collection: "leaderboard"
 * Each document: { name, score, mode, date, createdAt }
 *
 * Security rules (set in Firebase console):
 *   allow read: if true;
 *   allow create: if true;
 *   allow update, delete: if false;
 */

import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore,
  collection,
  addDoc,
  query,
  where,
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

const LB_COLLECTION = 'leaderboard';
const TOP_N = 10;

/**
 * Fetch the top-N scores for a given mode, sorted highest first.
 * Returns an array of { name, score, date } objects.
 */
export async function fetchLeaderboard(mode) {
  const q = query(
    collection(db, LB_COLLECTION),
    where('mode', '==', mode),
    orderBy('score', 'desc'),
    limit(TOP_N),
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => {
    const { name, score, date } = d.data();
    return { name, score, date };
  });
}

/**
 * Returns true if `score` would appear in the top-N for `mode`.
 * Used to decide whether to show the name-entry prompt after a game.
 */
export async function scoreQualifies(mode, score) {
  if (score <= 0) return false;
  const q = query(
    collection(db, LB_COLLECTION),
    where('mode', '==', mode),
    orderBy('score', 'desc'),
    limit(TOP_N),
  );
  const snap = await getDocs(q);
  if (snap.size < TOP_N) return true;
  const lowest = snap.docs[snap.size - 1].data().score;
  return score > lowest;
}

/**
 * Save a leaderboard entry.
 */
export async function saveScore(mode, name, score) {
  await addDoc(collection(db, LB_COLLECTION), {
    mode,
    name: name.trim() || 'Player',
    score,
    date: new Date().toISOString().slice(0, 10),
    createdAt: serverTimestamp(),
  });
}
