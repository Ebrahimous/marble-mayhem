/**
 * GameScreen.js — Marble Mayhem Prototype 2.0
 *
 * Controls
 *   Keyboard: ← → select column   ↑ ↓ slide selected column   Space → cycle row right
 *   Touch   : drag column up/down, swipe main row left/right
 */

import React, {
  useReducer, useEffect, useRef, useCallback, useState,
} from 'react';
import {
  View, Text, TouchableOpacity, Animated, Easing,
  StyleSheet, PanResponder, ScrollView, useWindowDimensions, Platform, Modal, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  COLS, ROWS, MAIN_ROW,
  CHAIN_BONUS, SCORE_PER_BALL,
  AI_DELAY, DEFAULT_AI_DIFFICULTY,
  BALL_TYPES_5, BALL_TYPES_6,
  BALL_ADD_INTERVAL, BALL_ADD_COUNT,
  getBoardMetrics,
} from '../constants';

import {
  createInitialBoard,
  createFullBoard,
  cloneBoard,
  makeBall,
  applyGravity,
  slideColumnUp,
  slideColumnDown,
  slideColumnUpWrap,
  slideColumnDownWrap,
  slideMainRowLeft,
  slideMainRowRight,
  isBoardFull,
  settleBoard,
  resolveMatchesRelax,
  addPenaltyBall,
  spawnBallWave,
  addRandomBalls,
  setBallTypes,
  getAIMove,
} from '../engine';

import BallView from '../components/BallView';
import TutorialModal from '../components/TutorialModal';
import * as sfx from '../sounds';
import * as haptics from '../haptics';
import { scoreQualifies, saveScore } from '../firebase';

// ── Initial state ─────────────────────────────────────────────────────────────

// Modes that share Zen Mode's board mechanics: the board starts (and
// stays) completely full, column slides wrap top↔bottom, and matches are
// refilled in place from the top of the column (resolveMatchesRelax)
// instead of the usual gravity + main-row top-up / auto ball-add timer.
function usesRelaxMechanics(mode) {
  return mode === 'relax' || mode === 'solo-time' || mode === 'mayhem';
}

// XP required to complete level N in Zen mode — grows ~40% per level.
function zenXPForLevel(level) {
  return Math.floor(20 * Math.pow(1.4, level - 1));
}

function createInitialState(mode, ballCount = 5, resumeData = null) {
  setBallTypes(ballCount === 6 ? BALL_TYPES_6 : BALL_TYPES_5);
  const isSolo = mode === 'solo-time' || mode === 'solo-normal' || mode === 'relax' || mode === 'mayhem';

  // Build the board(s) first so we can read the actual ball IDs for Mayhem seeding.
  const boards = usesRelaxMechanics(mode)
    ? [createFullBoard()]
    : isSolo ? [createInitialBoard()] : [createInitialBoard(), createInitialBoard()];

  const base = {
    mode,
    ballCount,
    boards,
    scores:      isSolo ? [0] : [0, 0],
    combos:      isSolo ? [0] : [0, 0],
    gameOver:    false,
    winner:      null,
    message:     '',
    lastMatch:   null,
    aiTick:      0,
    ballAddTick: 0,   // bumped each time the auto ball-add timer fires (solo)
    selectedCol: 0,   // keyboard-selected column on P1's board
    paused:      false,
    timeLeft:    (mode === 'solo-time' || mode === 'mayhem') ? 60 : null,
  };

  if (mode === 'mayhem') {
    // Seed the board with 0–3 random power-ups (freeze or bomb only — no
    // tbomb at start, so the player isn't immediately under threat).
    const allIds = [];
    boards[0].forEach(row => row.forEach(ball => { if (ball) allIds.push(ball.id); }));
    const count = Math.floor(Math.random() * 4); // 0, 1, 2, or 3
    const picked = allIds.sort(() => Math.random() - 0.5).slice(0, count);
    const startPowerUps = {};
    picked.forEach(id => {
      startPowerUps[id] = { type: Math.random() < 0.5 ? 'freeze' : 'bomb', timer: null };
    });
    base.powerUps = startPowerUps;
    base.freezeLeft = 0;
    base.multiplierLeft = 0;    // seconds remaining on the 2× score power-up
    base.mayhemOverReason = null;
    base.lastBombBlast    = null; // { id, row, col } — set when a bomb PU fires
    base.lastTbombDefuse  = 0;   // incremented each time a tbomb is defused by a match
  }

  if (mode === 'relax') {
    if (resumeData) {
      // Restore board + progress from a previous session
      base.boards        = [resumeData.board];
      base.scores        = [resumeData.score ?? 0];
      base.combos        = [resumeData.combos?.[0] ?? 0];
      base.zenXP         = resumeData.zenXP ?? 0;
      base.zenLevel      = resumeData.zenLevel ?? 1;
      base.zenXPRequired = resumeData.zenXPRequired ?? zenXPForLevel(1);
    } else {
      base.zenXP         = 0;
      base.zenLevel      = 1;
      base.zenXPRequired = zenXPForLevel(1); // 20
    }
  }

  return base;
}

// Monotonically increasing id for each match-clear "event" (a slide/spawn
// or auto ball-add that clears at least one ball). Used to give each
// floating score popup a unique key so it animates even when the gain
// value happens to repeat.
let matchSeqCounter = 0;

// Format whole seconds as M:SS for the Time Attack countdown
function formatTime(sec) {
  const s = Math.max(0, sec ?? 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

// ── Shared move logic ─────────────────────────────────────────────────────────

function applySlide(state, playerIdx, slidedBoard) {
  const boards   = state.boards.map(b => cloneBoard(b));
  const scores   = [...state.scores];
  const combos   = [...(state.combos ?? boards.map(() => 0))];
  let gameOver   = false;
  let winner     = null;
  let message    = '';
  let lastMatch  = state.lastMatch;

  // Resolve matches, top up the main row, and keep settling until stable
  // (catches chain matches formed by newly-spawned balls). Zen Mode uses
  // its own resolver — the board is always full, so cleared balls are
  // replaced by a fresh ball dropping in from the top of the column instead
  // of the usual gravity + main-row top-up.
  const { board: settled, cleared, chains, rawScore, sizes } =
    usesRelaxMechanics(state.mode) ? resolveMatchesRelax(slidedBoard) : settleBoard(slidedBoard);
  boards[playerIdx] = settled;

  if (cleared > 0) {
    // Consecutive matching moves build a combo streak (resets on a move
    // that clears nothing); each combo step adds +25% score, capped at
    // +100% from combo 5 onward.
    combos[playerIdx] = (combos[playerIdx] ?? 0) + 1;
    const combo = combos[playerIdx];
    const multiplier = 1 + Math.min(combo - 1, 4) * 0.25;

    // rawScore already accounts for match-size (3/4/5) scaling — see
    // resolveMatches() / MATCH_SIZE_BONUS in constants.js.
    const rawGain = rawScore + (chains > 1 ? (chains - 1) * CHAIN_BONUS : 0);
    // 2× multiplier power-up stacks with the combo multiplier
    const puMult = (state.mode === 'mayhem' && (state.multiplierLeft ?? 0) > 0) ? 2 : 1;
    const gain = Math.round(rawGain * multiplier * puMult);
    scores[playerIdx] += gain;

    const comboTxt = combo > 1 ? ` ×${combo} COMBO` : '';
    message = chains > 1 ? `${chains}× CHAIN! +${gain}${comboTxt}` : `+${gain}${comboTxt}`;

    // Drive the floating score popup shown over the matched balls — see
    // useBallAnimations()'s `popups` handling. maxSize (3/4/5) and chains
    // pick the "big match" / "chain" celebration styling.
    lastMatch = {
      id: ++matchSeqCounter,
      player: playerIdx,
      gain,
      chains,
      combo,
      maxSize: sizes.length ? Math.max(...sizes) : 0,
    };

    // One penalty ball per chain-round (head-to-head modes only)
    if (boards.length > 1) {
      const opponent = 1 - playerIdx;
      for (let i = 0; i < chains && !gameOver; i++) {
        const { board: penBoard, gameOver: lost } = addPenaltyBall(boards[opponent]);
        boards[opponent] = penBoard;
        if (lost) { gameOver = true; winner = playerIdx; }
      }
    }
  } else {
    // A move that clears nothing breaks that player's combo streak.
    combos[playerIdx] = 0;
  }

  // Solo "Challenge" mode ends once the board is completely full — stuck
  if (state.mode === 'solo-normal' && isBoardFull(boards[playerIdx])) {
    gameOver = true;
  }

  // ── Mayhem power-up effects ───────────────────────────────────────────────────
  // After settling, find which power-up balls were matched (cleared) and apply
  // their effects: freeze the timer, bomb-blast 3×3, or defuse a timed bomb.
  let powerUps = state.powerUps ?? {};
  let freezeLeft = state.freezeLeft ?? 0;
  let multiplierLeft = state.multiplierLeft ?? 0;
  const mayhemOverReason = state.mayhemOverReason ?? null;
  let lastBombBlast    = state.lastBombBlast ?? null;
  let lastTbombDefuse  = state.lastTbombDefuse ?? 0;

  let blastGain = 0; // extra score from bomb blasts — added to popup at the end

  if (state.mode === 'mayhem' && Object.keys(powerUps).length > 0) {
    // Record each PU ball's position in the post-slide (pre-settle) board
    const puPos = {};
    slidedBoard.forEach((rowArr, ri) => rowArr.forEach((ball, ci) => {
      if (ball && powerUps[ball.id]) puPos[String(ball.id)] = { row: ri, col: ci };
    }));

    // Which PU balls survived settling?
    const stillAlive = new Set();
    settled.forEach(rowArr => rowArr.forEach(ball => {
      if (ball && powerUps[ball.id]) stillAlive.add(String(ball.id));
    }));

    const newPowerUps = { ...powerUps };
    let blastBoard = boards[playerIdx];

    for (const [idStr, pu] of Object.entries(powerUps)) {
      if (stillAlive.has(idStr) || !puPos[idStr]) continue; // still on board

      delete newPowerUps[idStr]; // consume this power-up

      if (pu.type === 'freeze') {
        freezeLeft += 5; // pause the countdown for 5 s

      } else if (pu.type === 'bomb') {
        const { row: br, col: bc } = puPos[idStr];

        // Queue-based blast — supports chain reactions if a bomb is in the blast area.
        // We accumulate all destroyed cell coords first, then clear at once.
        const blastQueue = [{ row: br, col: bc }];
        const destroyedKeys = new Set(); // "row,col" strings to avoid double-processing

        while (blastQueue.length > 0) {
          const { row: qr, col: qc } = blastQueue.shift();
          // Record position for the visual shockwave ring
          lastBombBlast = { id: (lastBombBlast?.id ?? 0) + 1, row: qr, col: qc };

          for (let r = Math.max(0, qr - 1); r <= Math.min(ROWS - 1, qr + 1); r++) {
            for (let c = Math.max(0, qc - 1); c <= Math.min(COLS - 1, qc + 1); c++) {
              const key = `${r},${c}`;
              if (destroyedKeys.has(key)) continue;
              destroyedKeys.add(key);
              const ball = blastBoard[r][c];
              if (!ball) continue;
              // Every ball destroyed by the blast earns score
              scores[playerIdx] += SCORE_PER_BALL;
              blastGain += SCORE_PER_BALL;
              // If it's a power-up ball, trigger its effect
              if (newPowerUps[ball.id]) {
                const chainPu = newPowerUps[ball.id];
                delete newPowerUps[ball.id]; // consume it
                if (chainPu.type === 'freeze') {
                  freezeLeft += 5;
                } else if (chainPu.type === 'bomb') {
                  blastQueue.push({ row: r, col: c }); // chain explosion
                } else if (chainPu.type === 'tbomb') {
                  lastTbombDefuse += 1;
                } else if (chainPu.type === 'multiplier') {
                  multiplierLeft = 8; // activate 2× multiplier
                } else if (chainPu.type === 'lightning') {
                  // Clear entire column directly into destroyedKeys
                  for (let lr = 0; lr < ROWS; lr++) {
                    const lKey = `${lr},${c}`;
                    if (!destroyedKeys.has(lKey)) {
                      destroyedKeys.add(lKey);
                      if (blastBoard[lr][c]) { scores[playerIdx] += SCORE_PER_BALL; blastGain += SCORE_PER_BALL; }
                    }
                  }
                } else if (chainPu.type === 'colorbomb') {
                  // Destroy all balls of the target color
                  for (let cbR = 0; cbR < ROWS; cbR++) {
                    for (let cbC = 0; cbC < COLS; cbC++) {
                      const cbBall = blastBoard[cbR][cbC];
                      if (cbBall && cbBall.type === chainPu.targetColor) {
                        const cbKey = `${cbR},${cbC}`;
                        if (!destroyedKeys.has(cbKey)) {
                          destroyedKeys.add(cbKey);
                          scores[playerIdx] += SCORE_PER_BALL; blastGain += SCORE_PER_BALL;
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }

        // Clear all blast-affected cells at once
        let blasted = blastBoard.map(row => [...row]);
        for (const key of destroyedKeys) {
          const [r, c] = key.split(',').map(Number);
          blasted[r][c] = null;
        }
        blasted = applyGravity(blasted);
        // Refill every null cell with a fresh ball so the board stays packed
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            if (!blasted[r][c]) {
              const b = makeBall(); b.spawnSide = 'top'; blasted[r][c] = b;
            }
          }
        }
        const { board: blastSettled, rawScore: blastRaw } = resolveMatchesRelax(blasted);
        blastBoard = blastSettled;
        scores[playerIdx] += blastRaw; // bonus from any chain matches formed after blast
        blastGain += blastRaw;

      } else if (pu.type === 'tbomb') {
        // Defused! Increment so GameScreen's useEffect can play the triumph sound.
        lastTbombDefuse += 1;

      } else if (pu.type === 'wild') {
        // Wild ball participated in a normal match — no extra effect needed.
        // The match already cleared it along with its run.

      } else if (pu.type === 'lightning') {
        // Clear every ball in the column the lightning ball occupied.
        const { col: lCol } = puPos[idStr];
        let bonus = 0;
        let lightBoard = blastBoard.map(row => [...row]);
        for (let r = 0; r < ROWS; r++) {
          const lBall = lightBoard[r][lCol];
          if (lBall) {
            bonus += SCORE_PER_BALL;
            if (newPowerUps[lBall.id]) {
              const lPu = newPowerUps[lBall.id];
              delete newPowerUps[lBall.id];
              if (lPu.type === 'freeze')      freezeLeft += 5;
              else if (lPu.type === 'multiplier') multiplierLeft = 8;
              else if (lPu.type === 'tbomb')   lastTbombDefuse += 1;
            }
            lightBoard[r][lCol] = null;
          }
        }
        // Gravity collapses the remaining balls, then refill from top
        lightBoard = applyGravity(lightBoard);
        for (let r = 0; r < ROWS; r++) {
          if (!lightBoard[r][lCol]) { const b = makeBall(); b.spawnSide = 'top'; lightBoard[r][lCol] = b; }
        }
        blastBoard = lightBoard;
        scores[playerIdx] += bonus;
        blastGain += bonus;

      } else if (pu.type === 'multiplier') {
        // Activate 8-second 2× score multiplier.
        multiplierLeft = 8;

      } else if (pu.type === 'colorbomb') {
        // Remove every ball on the board that matches the bomb's stored colour.
        const target = pu.targetColor;
        let bonus = 0;
        let cbBoard = blastBoard.map(row =>
          row.map(ball => {
            if (ball && ball.type === target) {
              bonus += SCORE_PER_BALL;
              if (newPowerUps[ball.id]) {
                const cbPu = newPowerUps[ball.id];
                delete newPowerUps[ball.id];
                if (cbPu.type === 'freeze')      freezeLeft += 5;
                else if (cbPu.type === 'multiplier') multiplierLeft = 8;
                else if (cbPu.type === 'tbomb')   lastTbombDefuse += 1;
              }
              return null;
            }
            return ball;
          })
        );
        cbBoard = applyGravity(cbBoard);
        // Refill so the board stays packed
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            if (!cbBoard[r][c]) { const b = makeBall(); b.spawnSide = 'top'; cbBoard[r][c] = b; }
          }
        }
        blastBoard = cbBoard;
        scores[playerIdx] += bonus;
        blastGain += bonus;
      }
    }

    boards[playerIdx] = blastBoard;
    powerUps = newPowerUps;
    // Update the popup to show the full score (match + blast)
    if (blastGain > 0 && lastMatch) {
      lastMatch = { ...lastMatch, gain: lastMatch.gain + blastGain };
    }
  }

  // Zen Mode: accumulate XP from cleared balls; level up when bar fills.
  let zenXP         = state.zenXP         ?? 0;
  let zenLevel      = state.zenLevel      ?? 1;
  let zenXPRequired = state.zenXPRequired ?? zenXPForLevel(1);
  if (state.mode === 'relax' && cleared > 0) {
    zenXP += cleared + (chains > 1 ? (chains - 1) * 2 : 0);
    while (zenXP >= zenXPRequired) {
      zenXP        -= zenXPRequired;
      zenLevel      += 1;
      zenXPRequired  = zenXPForLevel(zenLevel);
    }
  }

  return {
    ...state,
    boards,
    scores,
    combos,
    gameOver,
    winner,
    message,
    lastMatch,
    aiTick: playerIdx === 1 ? state.aiTick + 1 : state.aiTick,
    ...(state.mode === 'mayhem' && { powerUps, freezeLeft, multiplierLeft, mayhemOverReason, lastBombBlast, lastTbombDefuse }),
    ...(state.mode === 'relax'  && { zenXP, zenLevel, zenXPRequired }),
  };
}

// ── Reducer ───────────────────────────────────────────────────────────────────

function gameReducer(state, action) {
  if (state.gameOver && action.type !== 'RESET' && action.type !== 'CLEAR_MESSAGE') {
    return state;
  }

  switch (action.type) {

    case 'COL_SLIDE': {
      if (state.paused) return state;
      const { player, col, dir } = action;
      if (state.mode === 'ai' && player === 1) return state;
      // Zen Mode/Time Attack: the board is always full, so a column slide wraps
      // the end ball around to the other side instead of shifting into empty
      // space (same idea as the main row's left/right wrap).
      const slideFns = usesRelaxMechanics(state.mode)
        ? { up: slideColumnUpWrap, down: slideColumnDownWrap }
        : { up: slideColumnUp, down: slideColumnDown };
      const { board, moved } = slideFns[dir](state.boards[player], col);
      if (!moved) return state;
      return applySlide(state, player, board);
    }

    case 'ROW_SLIDE': {
      if (state.paused) return state;
      const { player, dir } = action;
      if (state.mode === 'ai' && player === 1) return state;
      const board = (dir === 'left' ? slideMainRowLeft : slideMainRowRight)(state.boards[player]);
      return applySlide(state, player, board);
    }

    case 'SPAWN_WAVE': {
      // "Tap to move": tapping the centre of the main row throws a fresh
      // wave of balls onto the board instead of sliding anything.
      if (state.paused) return state;
      const { player } = action;
      if (state.mode === 'ai' && player === 1) return state;
      return applySlide(state, player, spawnBallWave(state.boards[player]));
    }

    case 'AUTO_BALL_ADD': {
      // Global solo-mode timer: every BALL_ADD_INTERVAL ms, BALL_ADD_COUNT
      // balls drop into random columns regardless of player input. Any
      // matches this triggers still score (with match-size scaling +
      // chain bonus), but don't affect the player's combo streak since
      // the player didn't make a move.
      if (state.paused) return state;
      const boards = state.boards.map(b => cloneBoard(b));
      const { board: settled, chains, rawScore, sizes } = settleBoard(addRandomBalls(boards[0], BALL_ADD_COUNT));
      boards[0] = settled;

      const scores = [...state.scores];
      let message = state.message;
      let lastMatch = state.lastMatch;
      if (rawScore > 0) {
        const gain = rawScore + (chains > 1 ? (chains - 1) * CHAIN_BONUS : 0);
        scores[0] += gain;
        message = chains > 1 ? `${chains}× CHAIN! +${gain}` : `+${gain}`;
        lastMatch = {
          id: ++matchSeqCounter,
          player: 0,
          gain,
          chains,
          combo: 0,
          maxSize: sizes.length ? Math.max(...sizes) : 0,
        };
      }

      let gameOver = state.gameOver;
      if (state.mode === 'solo-normal' && isBoardFull(boards[0])) gameOver = true;

      return { ...state, boards, scores, message, lastMatch, gameOver, ballAddTick: state.ballAddTick + 1 };
    }

    case 'AI_MOVE': {
      if (state.mode !== 'ai' || state.paused) return state;
      const move = getAIMove(state.boards[1]);
      let board;
      if (move.type === 'col') {
        const { board: b, moved } = (move.dir === 'up' ? slideColumnUp : slideColumnDown)(
          state.boards[1], move.col
        );
        if (!moved) return { ...state, aiTick: state.aiTick + 1 };
        board = b;
      } else {
        board = (move.dir === 'left' ? slideMainRowLeft : slideMainRowRight)(state.boards[1]);
      }
      return applySlide(state, 1, board);
    }

    case 'SELECT_COL':
      if (state.paused) return state;
      return {
        ...state,
        selectedCol: Math.max(0, Math.min(COLS - 1, state.selectedCol + action.delta)),
      };

    case 'TOGGLE_PAUSE':
      return { ...state, paused: !state.paused };

    case 'SET_PAUSED':
      return { ...state, paused: action.value };

    case 'ZEN_END_SESSION':
      if (state.mode !== 'relax') return state;
      return { ...state, gameOver: true, paused: false };

    case 'TICK': {
      if (state.paused || state.timeLeft == null) return state;

      if (state.mode === 'mayhem') {
        let freezeLeft = state.freezeLeft ?? 0;
        let timeLeft = state.timeLeft;
        let gameOver = false;
        let mayhemOverReason = null;

        if (freezeLeft > 0) {
          freezeLeft = Math.max(0, freezeLeft - 1); // frozen — don't tick the clock
        } else {
          timeLeft = Math.max(0, timeLeft - 1);
          if (timeLeft === 0) gameOver = true;
        }

        // Decrement timed-bomb timers; any bomb reaching 0 ends the game
        let powerUps = { ...state.powerUps };
        for (const [id, pu] of Object.entries(powerUps)) {
          if (pu.type !== 'tbomb') continue;
          const newTimer = pu.timer - 1;
          if (newTimer <= 0) {
            gameOver = true;
            mayhemOverReason = 'bomb';
            powerUps = { ...powerUps, [id]: { ...pu, timer: 0 } };
          } else {
            powerUps = { ...powerUps, [id]: { ...pu, timer: newTimer } };
          }
        }

        const multiplierLeft = Math.max(0, (state.multiplierLeft ?? 0) - 1);
        return { ...state, timeLeft, freezeLeft, multiplierLeft, powerUps, gameOver, mayhemOverReason };
      }

      const timeLeft = Math.max(0, state.timeLeft - 1);
      return timeLeft === 0
        ? { ...state, timeLeft, gameOver: true }
        : { ...state, timeLeft };
    }

    case 'SPAWN_POWERUP': {
      if (state.mode !== 'mayhem' || state.paused || state.gameOver) return state;
      const board = state.boards[0];
      const existing = new Set(Object.keys(state.powerUps));
      const candidates = [];
      board.forEach(row => row.forEach(ball => {
        if (ball && !existing.has(String(ball.id))) candidates.push(ball.id);
      }));
      if (candidates.length === 0) return state;
      const id = candidates[Math.floor(Math.random() * candidates.length)];
      // At most one timed bomb on the board at a time — prevent a second tbomb
      // appearing before the player has had a chance to defuse the first.
      const hasTbomb = Object.values(state.powerUps).some(p => p.type === 'tbomb');
      const roll = Math.random();
      // Weights (no tbomb): freeze 28%, bomb 22%, tbomb 20%, wild 12%, lightning 8%, multiplier 5%, colorbomb 5%
      // Weights (tbomb active): freeze 35%, bomb 30%, wild 18%, lightning 10%, multiplier 4%, colorbomb 3%
      let type;
      if (hasTbomb) {
        type = roll < 0.35 ? 'freeze'
             : roll < 0.65 ? 'bomb'
             : roll < 0.83 ? 'wild'
             : roll < 0.93 ? 'lightning'
             : roll < 0.97 ? 'multiplier'
             :                'colorbomb';
      } else {
        type = roll < 0.28 ? 'freeze'
             : roll < 0.50 ? 'bomb'
             : roll < 0.70 ? 'tbomb'
             : roll < 0.82 ? 'wild'
             : roll < 0.90 ? 'lightning'
             : roll < 0.95 ? 'multiplier'
             :                'colorbomb';
      }

      // Wild ball: mark the board ball's type as 'wild' so the engine sees it.
      if (type === 'wild') {
        const newBoards = state.boards.map((brd, bi) =>
          bi !== 0 ? brd : brd.map(row =>
            row.map(b => (b && b.id === id) ? { ...b, type: 'wild' } : b)
          )
        );
        return {
          ...state,
          boards: newBoards,
          powerUps: { ...state.powerUps, [id]: { type: 'wild', timer: null } },
        };
      }

      // Color bomb: store the ball's current colour so the effect knows what to erase.
      if (type === 'colorbomb') {
        let targetColor = null;
        board.forEach(row => row.forEach(b => { if (b && b.id === id) targetColor = b.type; }));
        return {
          ...state,
          powerUps: { ...state.powerUps, [id]: { type: 'colorbomb', timer: null, targetColor } },
        };
      }

      return {
        ...state,
        powerUps: {
          ...state.powerUps,
          [id]: { type, timer: type === 'tbomb' ? 8 : null },
        },
      };
    }

    case 'CLEAR_MESSAGE':
      return { ...state, message: '' };

    case 'RESET':
      return createInitialState(state.mode, state.ballCount);

    default:
      return state;
  }
}

// ── Ball fall/clear animation ─────────────────────────────────────────────────

const FALL_DURATION    = 220;  // ms — gravity slide into new position
const CLEAR_DURATION   = 180;  // ms — matched balls shrinking/fading out
const POP_DURATION     = 110;  // ms — matched balls popping/flashing before clearing
const SQUASH_DURATION  = 90;   // ms — landing squash (compress)
const RECOVER_DURATION = 140;  // ms — landing recovery (squash → normal, with overshoot)
const POPUP_DURATION   = 850;  // ms — floating match-score popup enlarge/rise/fade

// Eased curves: arrivals decelerate (cubic ease-out); the landing recovery
// overshoots slightly past 1 then settles, for a little "bounce" on impact.
const SLIDE_EASING   = Easing.out(Easing.cubic);
const SQUASH_EASING  = Easing.out(Easing.quad);
const RECOVER_EASING = Easing.out(Easing.back(1.6));


/** Call `fn(ball, row, col)` for every occupied cell on the board. */
function forEachCell(board, fn) {
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      const cell = board[r][c];
      if (cell) fn(cell, r, c);
    }
  }
}

/**
 * Quick squash-and-recover "landing" bounce on a ball's vertical scale —
 * played when a ball arrives after falling/rising into a new cell.
 */
function landingBounce(scaleY) {
  scaleY.setValue(1);
  Animated.sequence([
    Animated.timing(scaleY, { toValue: 0.72, duration: SQUASH_DURATION, easing: SQUASH_EASING, useNativeDriver: false }),
    Animated.timing(scaleY, { toValue: 1, duration: RECOVER_DURATION, easing: RECOVER_EASING, useNativeDriver: false }),
  ]).start();
}

/**
 * Tracks per-ball Animated positions across board state changes (identified
 * by each ball's stable `id`), so that:
 *  - balls that move (e.g. gravity pulling them down after a match) slide
 *    smoothly from their old cell to their new one instead of teleporting,
 *  - newly-spawned balls fade/drop in from just above their landing cell,
 *  - matched balls that disappear shrink + fade out in place ("ghosts")
 *    instead of vanishing instantly.
 *
 * Returns an array of <Animated.View> elements (one per ball + ghost) ready
 * to render inside an absolutely-positioned overlay the size of the board.
 */
function useBallAnimations(board, cellSize, dragInfo, lastMatch, colWrap, powerUps, lastBombBlast) {
  const animsRef = useRef(new Map()); // id -> { top, left, scaleY, opacity, type, row, col }
  const prevRef  = useRef(null);
  const [ghosts, setGhosts] = useState([]);
  const [popups, setPopups] = useState([]);
  const [blasts, setBlasts] = useState([]); // bomb shockwave rings
  // Tracks the id of the last lastMatch we already spawned a popup for, so a
  // re-render with the same lastMatch (e.g. a resize) doesn't duplicate it.
  const lastPopupIdRef  = useRef(null);
  const lastBlastIdRef  = useRef(null); // likewise for bomb blast rings
  // Per-tbomb looping scale-pulse animations: Map<ballId, { scale, lastTier, loop }>
  // Created synchronously during render (so the Animated.Value is wired into the
  // View's transform on the first paint); loop is started in the useEffect below.
  const tbombPulseRef = useRef(new Map());

  // Full board width/height — used to slide wrapped main-row balls in from
  // the opposite edge instead of sliding them across the whole board, and to
  // render the wrap-around preview ghost while dragging (see below).
  const boardWidth  = cellSize * COLS;
  const boardHeight = cellSize * ROWS;

  // Populate the very first set of ball positions synchronously during the
  // initial render (not inside useEffect). useEffect runs *after* the first
  // paint, and animsRef is just a ref — populating it there doesn't trigger
  // a re-render, so the board would stay visually empty until some unrelated
  // state change (e.g. the 5s auto-ball-add timer) forced a re-render. Doing
  // it here means the very first paint already has every ball placed.
  if (prevRef.current === null && animsRef.current.size === 0) {
    prevRef.current = board;
    forEachCell(board, (ball, row, col) => {
      animsRef.current.set(ball.id, {
        top: new Animated.Value(row * cellSize),
        left: new Animated.Value(col * cellSize),
        scaleY: new Animated.Value(1),
        opacity: new Animated.Value(1),
        type: ball.type,
        row, col,
      });
    });
  }

  // Re-snap all balls to their grid position when cellSize changes (resize),
  // without animating.
  const prevCellSize = useRef(cellSize);
  useEffect(() => {
    if (prevCellSize.current === cellSize) return;
    prevCellSize.current = cellSize;
    animsRef.current.forEach((entry) => {
      entry.top.setValue(entry.row * cellSize);
      entry.left.setValue(entry.col * cellSize);
    });
    setGhosts(gs => gs.map(gh => {
      gh.top.setValue(gh.row * cellSize);
      gh.left.setValue(gh.col * cellSize);
      return gh;
    }));
  }, [cellSize]);

  // Re-snap every ball to its current grid cell when the tab/page regains
  // visibility or focus. Mobile browsers throttle or fully pause
  // requestAnimationFrame while backgrounded, which can leave an
  // Animated.timing for a slide/fall permanently stuck mid-flight — the ball
  // then renders hovering over its old cell while the board model (and the
  // cell it actually occupies) has already moved on, producing "empty spots"
  // where balls visually appear to be missing. Forcing every ball back to
  // `row*cellSize` / `col*cellSize` (its already-current model position)
  // fixes the desync without affecting in-progress animations on an active tab.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const resync = () => {
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      animsRef.current.forEach((entry) => {
        entry.top.stopAnimation();
        entry.left.stopAnimation();
        entry.top.setValue(entry.row * cellSize);
        entry.left.setValue(entry.col * cellSize);
      });
    };
    document.addEventListener('visibilitychange', resync);
    if (typeof window !== 'undefined') window.addEventListener('focus', resync);
    return () => {
      document.removeEventListener('visibilitychange', resync);
      if (typeof window !== 'undefined') window.removeEventListener('focus', resync);
    };
  }, [cellSize]);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = board;

    if (!prev) {
      // Defensive fallback only — the initial population now happens
      // synchronously above, so prevRef.current is already set by the time
      // this effect runs. Kept in case useBallAnimations is ever called
      // before any render has populated it.
      forEachCell(board, (ball, row, col) => {
        animsRef.current.set(ball.id, {
          top: new Animated.Value(row * cellSize),
          left: new Animated.Value(col * cellSize),
          scaleY: new Animated.Value(1),
          opacity: new Animated.Value(1),
          type: ball.type,
          row, col,
        });
      });
      return;
    }

    const prevMap = new Map();
    forEachCell(prev, (ball, row, col) => prevMap.set(ball.id, { row, col }));

    const seen = new Set();
    const moves = [];
    const bounces = []; // scaleY values that should play a landing bounce

    forEachCell(board, (ball, row, col) => {
      seen.add(ball.id);
      let entry = animsRef.current.get(ball.id);
      const old = prevMap.get(ball.id);
      const targetTop  = row * cellSize;
      const targetLeft = col * cellSize;

      if (!entry) {
        // Newly-spawned ball: slide in from just beyond the edge it entered
        // from (top of the board for 'top' spawns, bottom for 'bottom'
        // spawns — defaulting to 'top' for balls with no recorded side,
        // e.g. the initial board fill).
        //
        // In RELAX mode (colWrap), spawn at full opacity so a rapid second
        // move can't interrupt the fade-in and leave a ball stuck dark.
        // The boardGrid overflow:hidden clips the ball above the top edge,
        // giving the same visual "sliding in" effect without the opacity risk.
        const startTop = ball.spawnSide === 'bottom'
          ? ROWS * cellSize     // start below the entire board
          : -cellSize;          // start above the entire board
        const startOpacity = colWrap ? 1 : 0; // RELAX: full opacity from the start
        entry = {
          top: new Animated.Value(startTop),
          left: new Animated.Value(targetLeft),
          scaleY: new Animated.Value(1),
          opacity: new Animated.Value(startOpacity),
          type: ball.type,
          row, col,
        };
        animsRef.current.set(ball.id, entry);
        sfx.playSpawn(ball.spawnSide);
        const spawnAnims = [
          Animated.timing(entry.top, { toValue: targetTop, duration: FALL_DURATION, easing: SLIDE_EASING, useNativeDriver: false }),
        ];
        if (!colWrap) {
          spawnAnims.push(
            Animated.timing(entry.opacity, { toValue: 1, duration: FALL_DURATION, easing: SLIDE_EASING, useNativeDriver: false })
          );
        }
        moves.push(Animated.parallel(spawnAnims));
        bounces.push(entry.scaleY);
      } else {
        entry.type = ball.type;
        entry.row = row;
        entry.col = col;
        if (!old || old.row !== row || old.col !== col) {
          // A MAIN_ROW ball whose column index jumped by COLS-1 wrapped
          // around the row slide (e.g. col 0 → col COLS-1) — rather than
          // sliding it visibly across every other column, jump it just off
          // the edge it's entering from and slide it in to its new cell.
          const isRowWrap = old && row === MAIN_ROW && old.row === MAIN_ROW
            && COLS > 2 && Math.abs(col - old.col) === COLS - 1;

          // In RELAX/wrap column-slide mode a ball at row 0 wraps to row
          // ROWS-1 (or vice-versa). Without special handling it would animate
          // the full board height in the wrong direction, flying through every
          // other ball. Detect this and snap the ball to just outside the edge
          // it enters from, then slide it in the short direction only.
          const isColWrap = colWrap && old && col === old.col
            && Math.abs(row - old.row) === ROWS - 1;

          if (isRowWrap) {
            const enteringFromRight = col > old.col;
            entry.top.setValue(targetTop);
            entry.left.setValue(enteringFromRight ? boardWidth : -cellSize);
            moves.push(
              Animated.timing(entry.left, { toValue: targetLeft, duration: FALL_DURATION, easing: SLIDE_EASING, useNativeDriver: false })
            );
          } else if (isColWrap) {
            // Ball exited one end of the column and re-enters from the other.
            // Snap it just outside the entry edge, then animate the one cell
            // into its landing position.
            const enteringFromBelow = row < old.row; // old=ROWS-1, new=0 → enters from below top
            entry.left.setValue(targetLeft);
            entry.top.setValue(enteringFromBelow ? boardHeight : -cellSize);
            moves.push(
              Animated.timing(entry.top, { toValue: targetTop, duration: FALL_DURATION, easing: SLIDE_EASING, useNativeDriver: false })
            );
          } else {
            // Existing ball moved (gravity / slide) — slide to its new cell.
            moves.push(Animated.parallel([
              Animated.timing(entry.top,  { toValue: targetTop,  duration: FALL_DURATION, easing: SLIDE_EASING, useNativeDriver: false }),
              Animated.timing(entry.left, { toValue: targetLeft, duration: FALL_DURATION, easing: SLIDE_EASING, useNativeDriver: false }),
            ]));
            if (old.row !== row) bounces.push(entry.scaleY);
          }
        }
      }
    });

    // Balls present before but gone now were matched — pop/flash them
    // briefly, then shrink/fade them out in place rather than letting them
    // vanish instantly.
    const removed = [];
    prevMap.forEach((pos, id) => {
      if (seen.has(id)) return;
      const entry = animsRef.current.get(id);
      animsRef.current.delete(id);
      removed.push({
        id,
        row: pos.row,
        col: pos.col,
        type: entry?.type,
        top: entry?.top ?? new Animated.Value(pos.row * cellSize),
        left: entry?.left ?? new Animated.Value(pos.col * cellSize),
        opacity: entry?.opacity ?? new Animated.Value(1),
        scale: new Animated.Value(1),
        glow: new Animated.Value(0),
      });
    });

    if (removed.length) {
      setGhosts(g => [...g, ...removed]);
      removed.forEach((gh) => {
        const removeGhost = () => setGhosts(g => g.filter(x => x.id !== gh.id));
        Animated.sequence([
          // Pop: brief scale-up + white flash to highlight the match.
          Animated.parallel([
            Animated.timing(gh.scale, { toValue: 1.3,  duration: POP_DURATION, easing: SQUASH_EASING, useNativeDriver: false }),
            Animated.timing(gh.glow,  { toValue: 0.85, duration: POP_DURATION, useNativeDriver: false }),
          ]),
          // Then shrink/fade out.
          Animated.parallel([
            Animated.timing(gh.opacity, { toValue: 0,    duration: CLEAR_DURATION, useNativeDriver: false }),
            Animated.timing(gh.scale,   { toValue: 0.25, duration: CLEAR_DURATION, useNativeDriver: false }),
            Animated.timing(gh.glow,    { toValue: 0,    duration: CLEAR_DURATION, useNativeDriver: false }),
          ]),
        ]).start(removeGhost);
        // Safety net: if the animation's completion callback never fires
        // (e.g. interrupted by a rapid follow-up chain/resize), force the
        // ghost out of state shortly after it should have finished fading.
        // Without this, a "stuck" ghost renders forever as a dim, partially
        // transparent ball overlapping whatever lands in that cell next.
        setTimeout(removeGhost, POP_DURATION + CLEAR_DURATION + 100);
      });

      // Floating match-score popup — enlarges and fades out over the centroid
      // of the matched balls. lastMatch carries the gain/chain/combo/maxSize
      // info computed by the reducer for this exact clear event; guard against
      // re-spawning the same popup if this effect re-runs for the same event.
      if (lastMatch && lastPopupIdRef.current !== lastMatch.id) {
        lastPopupIdRef.current = lastMatch.id;

        const avgRow = removed.reduce((s, r) => s + r.row, 0) / removed.length;
        const avgCol = removed.reduce((s, r) => s + r.col, 0) / removed.length;

        let kind = 'normal';
        if (lastMatch.chains > 1) kind = 'chain';
        else if (lastMatch.maxSize >= 5) kind = 'big5';
        else if (lastMatch.maxSize === 4) kind = 'big4';

        let subText = '';
        if (lastMatch.chains > 1) subText = `${lastMatch.chains}× CHAIN`;
        if (lastMatch.combo > 1) {
          subText = subText ? `${subText}  ×${lastMatch.combo} COMBO` : `×${lastMatch.combo} COMBO`;
        }

        const popup = {
          id: lastMatch.id,
          top: (avgRow + 0.5) * cellSize,
          left: (avgCol + 0.5) * cellSize,
          text: `+${lastMatch.gain}`,
          subText,
          kind,
          scale: new Animated.Value(0.4),
          opacity: new Animated.Value(1),
          rise: new Animated.Value(0),
        };
        setPopups(p => [...p, popup]);

        const targetScale = kind === 'big5' ? 1.9 : kind === 'chain' ? 1.8 : kind === 'big4' ? 1.6 : 1.3;
        const removePopup = () => setPopups(p => p.filter(x => x.id !== popup.id));

        Animated.parallel([
          Animated.timing(popup.scale, { toValue: targetScale, duration: POPUP_DURATION, easing: Easing.out(Easing.back(1.4)), useNativeDriver: false }),
          Animated.timing(popup.rise,  { toValue: -cellSize * 1.4, duration: POPUP_DURATION, easing: Easing.out(Easing.quad), useNativeDriver: false }),
          Animated.timing(popup.opacity, { toValue: 0, duration: POPUP_DURATION * 0.6, delay: POPUP_DURATION * 0.4, useNativeDriver: false }),
        ]).start(removePopup);
        // Safety net, matching the ghost-removal pattern above.
        setTimeout(removePopup, POPUP_DURATION + 150);
      }
    }

    // ── Bomb blast ring ────────────────────────────────────────────────────
    // Triggered by a new `lastBombBlast` arriving (guarded by ID to prevent
    // re-spawning on re-renders with the same event).
    if (lastBombBlast && lastBlastIdRef.current !== lastBombBlast.id) {
      lastBlastIdRef.current = lastBombBlast.id;
      const blast = {
        id: lastBombBlast.id,
        cx: (lastBombBlast.col + 0.5) * cellSize,
        cy: (lastBombBlast.row + 0.5) * cellSize,
        ring:    new Animated.Value(0.1),
        opacity: new Animated.Value(0.9),
        flash:   new Animated.Value(1.0),
        flashOp: new Animated.Value(0.75),
      };
      setBlasts(b => [...b, blast]);
      const removeBlast = () => setBlasts(b => b.filter(x => x.id !== blast.id));
      Animated.parallel([
        Animated.timing(blast.ring,    { toValue: 1,   duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
        Animated.timing(blast.opacity, { toValue: 0,   duration: 380, useNativeDriver: false }),
        Animated.timing(blast.flash,   { toValue: 2.5, duration: 200, easing: Easing.out(Easing.quad),  useNativeDriver: false }),
        Animated.timing(blast.flashOp, { toValue: 0,   duration: 250, useNativeDriver: false }),
      ]).start(removeBlast);
      setTimeout(removeBlast, 500);
    }

    if (moves.length) Animated.parallel(moves).start();
    // Landing bounces start once the fall/slide tween finishes.
    if (bounces.length) {
      setTimeout(() => bounces.forEach(landingBounce), FALL_DURATION);
    }
  }, [board, cellSize, lastMatch]);

  // Start / update / stop tbomb looping scale-pulse animations.
  // Runs after every board or powerUps change; bails early when the speed
  // tier hasn't changed (timer ≤ 6 / ≤ 4 / ≤ 2 are the four thresholds),
  // so it only restarts the loop at those four transition points.
  useEffect(() => {
    const boardIds = new Set();
    forEachCell(board, ball => boardIds.add(ball.id));

    forEachCell(board, ball => {
      const pu = powerUps && powerUps[ball.id];
      const entry = tbombPulseRef.current.get(ball.id);
      if (!pu || pu.type !== 'tbomb' || !entry) return;

      const t    = pu.timer ?? 8;
      const tier = t <= 2 ? 4 : t <= 4 ? 3 : t <= 6 ? 2 : 1;
      if (entry.lastTier === tier) return; // no speed change, keep existing loop

      entry.loop?.stop();
      const halfDur = t <= 2 ? 90 : t <= 4 ? 170 : t <= 6 ? 280 : 500;
      const peak    = t <= 2 ? 1.30 : t <= 4 ? 1.20 : 1.12;
      entry.scale.setValue(1);
      const loop = Animated.loop(Animated.sequence([
        Animated.timing(entry.scale, { toValue: peak, duration: halfDur, useNativeDriver: false }),
        Animated.timing(entry.scale, { toValue: 1.0,  duration: halfDur, useNativeDriver: false }),
      ]));
      loop.start();
      entry.lastTier = tier;
      entry.loop = loop;
    });

    // Stop and remove pulse anims for balls that have left the board
    tbombPulseRef.current.forEach((entry, id) => {
      if (!boardIds.has(id)) {
        entry.loop?.stop();
        tbombPulseRef.current.delete(id);
      }
    });
  }, [board, powerUps]);

  const elements = [];

  forEachCell(board, (ball, row, col) => {
    const a = animsRef.current.get(ball.id);
    if (!a) return;

    // ── Tbomb pulse scale ─────────────────────────────────────────────────
    // Create the Animated.Value synchronously so it's wired into the View's
    // transform on this render; the useEffect above starts the actual loop
    // after the paint.
    const pu = powerUps && powerUps[ball.id];
    let tbombPulse = null;
    if (pu && pu.type === 'tbomb') {
      let entry = tbombPulseRef.current.get(ball.id);
      if (!entry) {
        entry = { scale: new Animated.Value(1), lastTier: -1, loop: null };
        tbombPulseRef.current.set(ball.id, entry);
      }
      tbombPulse = entry.scale;
    }

    const transform = [{ scaleY: a.scaleY }];
    if (tbombPulse) transform.push({ scale: tbombPulse });

    // Live touch-drag preview: while the player is dragging, offset every
    // ball in the dragged column (vertical drag) or the whole main row
    // (horizontal drag) by the live finger-tracking Animated.Value. Match
    // resolution is untouched — it only runs once the real board state
    // changes on release.
    let wrapTransform = null;
    if (dragInfo && dragInfo.axis === 'col' && col === dragInfo.index) {
      transform.push({ translateY: dragInfo.offset });
      // Edge balls get a wrap-around preview copy so they don't appear to
      // poke outside the board while dragging — the copy slides in from the
      // opposite edge as the original slides out, mirroring the wrap that
      // happens on release.
      if (colWrap && row === ROWS - 1) {
        // Dragging down: this ball would exit the bottom — preview copy
        // enters from the top.
        wrapTransform = [{ scaleY: a.scaleY }, { translateY: Animated.add(dragInfo.offset, -boardHeight) }];
      } else if (colWrap && row === 0) {
        // Dragging up: this ball would exit the top — preview copy enters
        // from the bottom.
        wrapTransform = [{ scaleY: a.scaleY }, { translateY: Animated.add(dragInfo.offset, boardHeight) }];
      }
    } else if (dragInfo && dragInfo.axis === 'row' && row === MAIN_ROW) {
      transform.push({ translateX: dragInfo.offset });
      if (col === COLS - 1) {
        // Dragging right: preview copy enters from the left.
        wrapTransform = [{ scaleY: a.scaleY }, { translateX: Animated.add(dragInfo.offset, -boardWidth) }];
      } else if (col === 0) {
        // Dragging left: preview copy enters from the right.
        wrapTransform = [{ scaleY: a.scaleY }, { translateX: Animated.add(dragInfo.offset, boardWidth) }];
      }
    }

    // ── Power-up overlay node ──────────────────────────────────────────────
    // Timed bomb: 💀 icon with countdown number overlaid, colour-coded by
    // urgency. Other types: single icon symbol.
    const puNode = pu ? (
      <View style={styles.puOverlay} pointerEvents="none">
        {pu.type === 'tbomb' ? (
          <View style={styles.tbombBadge}>
            <Text style={{ fontSize: cellSize * 0.52 }}>💀</Text>
            <Text style={[
              styles.tbombCount,
              { fontSize: cellSize * 0.30 },
              (pu.timer ?? 8) <= 6 && (pu.timer ?? 8) > 3 && styles.tbombCountWarn,
              (pu.timer ?? 8) <= 3 && styles.tbombCountUrgent,
            ]}>
              {pu.timer ?? 8}
            </Text>
          </View>
        ) : (
          <Text style={[styles.puSymbol, { fontSize: cellSize * 0.42 }]}>
            {pu.type === 'freeze'     ? '❄'
           : pu.type === 'bomb'      ? '💥'
           : pu.type === 'wild'      ? '🌈'
           : pu.type === 'lightning' ? '⚡'
           : pu.type === 'multiplier'? '×2'
           : pu.type === 'colorbomb' ? '🎨'
           : '?'}
          </Text>
        )}
      </View>
    ) : null;

    // ── Power-up glow ring ─────────────────────────────────────────────────
    // Balls carrying a power-up get a coloured outline so they read as
    // special at a glance, not just from the icon overlay.
    const puGlow = pu ? (
      <View style={[
        styles.puGlowRing,
        pu.type === 'freeze'     && styles.puGlowFreeze,
        pu.type === 'bomb'       && styles.puGlowBomb,
        pu.type === 'tbomb'      && styles.puGlowTbomb,
        pu.type === 'wild'       && styles.puGlowWild,
        pu.type === 'lightning'  && styles.puGlowLightning,
        pu.type === 'multiplier' && styles.puGlowMultiplier,
        pu.type === 'colorbomb'  && styles.puGlowColorbomb,
        { borderRadius: cellSize * 0.5, width: cellSize - 2, height: cellSize - 2 },
      ]} pointerEvents="none" />
    ) : null;

    elements.push(
      <Animated.View
        key={ball.id}
        style={[
          styles.ballSlot,
          {
            width: cellSize, height: cellSize, top: a.top, left: a.left,
            opacity: a.opacity, transform,
          },
        ]}
      >
        <BallView type={a.type} size={cellSize} />
        {puGlow}
        {puNode}
      </Animated.View>
    );
    if (wrapTransform) {
      elements.push(
        <Animated.View
          key={`${ball.id}-wrap`}
          style={[
            styles.ballSlot,
            {
              width: cellSize, height: cellSize, top: a.top, left: a.left,
              opacity: a.opacity, transform: wrapTransform,
            },
          ]}
        >
          <BallView type={a.type} size={cellSize} />
          {puGlow}
          {puNode}
        </Animated.View>
      );
    }
  });

  ghosts.forEach((gh) => {
    elements.push(
      <Animated.View
        key={`ghost-${gh.id}`}
        style={[
          styles.ballSlot,
          {
            width: cellSize, height: cellSize, top: gh.top, left: gh.left,
            opacity: gh.opacity, transform: [{ scale: gh.scale }],
          },
        ]}
      >
        <Animated.View style={[styles.ghostGlow, { opacity: gh.glow }]} />
        <BallView type={gh.type} size={cellSize} />
      </Animated.View>
    );
  });

  // Bomb blast rings — expanding shockwave circles over the 3×3 blast area
  blasts.forEach((b) => {
    const ringSize = cellSize * 4.5;
    elements.push(
      <Animated.View
        key={`blast-ring-${b.id}`}
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: ringSize,
          height: ringSize,
          top: b.cy - ringSize / 2,
          left: b.cx - ringSize / 2,
          borderRadius: ringSize / 2,
          borderWidth: 5,
          borderColor: '#FF9900',
          opacity: b.opacity,
          transform: [{ scale: b.ring }],
        }}
      />
    );
    // Inner flash — solid orange disc that scales and fades
    const flashSize = cellSize * 2;
    elements.push(
      <Animated.View
        key={`blast-flash-${b.id}`}
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: flashSize,
          height: flashSize,
          top: b.cy - flashSize / 2,
          left: b.cx - flashSize / 2,
          borderRadius: flashSize / 2,
          backgroundColor: '#FFCC44',
          opacity: b.flashOp,
          transform: [{ scale: b.flash }],
        }}
      />
    );
  });

  popups.forEach((p) => {
    elements.push(
      <Animated.View
        key={`popup-${p.id}`}
        pointerEvents="none"
        style={[
          styles.popup,
          {
            top: Animated.add(p.rise, p.top - 14),
            left: p.left,
            opacity: p.opacity,
            transform: [{ translateX: '-50%' }, { scale: p.scale }],
          },
        ]}
      >
        <Text style={[styles.popupText, styles[`popupText_${p.kind}`]]}>{p.text}</Text>
        {!!p.subText && (
          <Text style={[styles.popupSubText, styles[`popupSubText_${p.kind}`]]}>{p.subText}</Text>
        )}
      </Animated.View>
    );
  });

  return elements;
}

// ── BoardWithControls ─────────────────────────────────────────────────────────

// Below this many pixels of movement, a press is treated as a tap rather
// than a swipe/drag (used by the "tap to move" control scheme).
const TAP_THRESHOLD = 10;

const BoardWithControls = React.memo(({
  board, label, onColSlide, onRowSlide, onCenterTap, disabled, selectedCol, cellSize, boardPx, tapToMove, lastMatch, colWrap, powerUps, freezeActive, lastBombBlast,
  isRelaxMode = false, lastMatchId = 0,
}) => {
  // Animate the freeze border in/out as freezeActive changes
  const freezeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(freezeAnim, {
      toValue: freezeActive ? 1 : 0,
      duration: freezeActive ? 300 : 800,
      useNativeDriver: false,
    }).start();
  }, [freezeActive]);

  // Drift animation for corner snowflakes — gentle up/down float
  const snowDriftAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (freezeActive) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(snowDriftAnim, { toValue: 1, duration: 1400, useNativeDriver: false }),
          Animated.timing(snowDriftAnim, { toValue: 0, duration: 1400, useNativeDriver: false }),
        ])
      ).start();
    } else {
      snowDriftAnim.stopAnimation();
      snowDriftAnim.setValue(0);
    }
  }, [freezeActive]);

  // Match flash — brief white burst on main row when a match fires
  const matchFlashAnim = useRef(new Animated.Value(0)).current;
  const lastMatchIdRef = useRef(null);
  useEffect(() => {
    if (!lastMatch || lastMatch.id === lastMatchIdRef.current) return;
    lastMatchIdRef.current = lastMatch.id;
    matchFlashAnim.setValue(0);
    Animated.sequence([
      Animated.timing(matchFlashAnim, { toValue: 0.6, duration: 70,  useNativeDriver: true }),
      Animated.timing(matchFlashAnim, { toValue: 0,   duration: 230, useNativeDriver: true }),
    ]).start();
  }, [lastMatch]);

  // Main row shimmer — slow gold pulse that loops forever
  const shimmerAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(shimmerAnim, { toValue: 0, duration: 1400, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  const swipeThreshold = cellSize * 0.45;

  // Always-fresh callbacks/values without stale closure
  const cbRef = useRef({ onColSlide, onRowSlide, onCenterTap, disabled, cellSize, boardPx, swipeThreshold, tapToMove, isRelaxMode, lastMatchId });
  cbRef.current = { onColSlide, onRowSlide, onCenterTap, disabled, cellSize, boardPx, swipeThreshold, tapToMove, isRelaxMode, lastMatchId };

  const gestureStart   = useRef({ col: 0, row: 0, x: 0 });
  const gestureHandled = useRef(false);

  // RELAX continuous-scroll state: tracks steps already dispatched during the
  // current drag so we can offset the visual by the fractional remainder only.
  const relaxDragRef = useRef({ steps: 0, matchId: 0, locked: false, col: 0, axis: null });

  // Live touch-drag preview state: while dragging, `dragAxisRef` tracks
  // whether the gesture is sliding a column ('col') or the main row ('row'),
  // and `dragOffset` is the live pixel offset applied as a transform to the
  // affected balls (see useBallAnimations). `dragInfo` mirrors the axis/index
  // in state so the render picks up which balls should get the transform.
  const dragAxisRef = useRef(null); // null | 'col' | 'row' | 'none'
  const dragOffset  = useRef(new Animated.Value(0)).current;
  const [dragInfo, setDragInfo] = useState({ axis: null, index: -1, offset: dragOffset });

  const resetDrag = () => {
    Animated.timing(dragOffset, {
      toValue: 0, duration: FALL_DURATION, easing: SLIDE_EASING, useNativeDriver: false,
    }).start(() => setDragInfo({ axis: null, index: -1, offset: dragOffset }));
    dragAxisRef.current = null;
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !cbRef.current.disabled,
      onMoveShouldSetPanResponder:  (_, g) =>
        !cbRef.current.disabled && (Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6),
      // Claim the gesture *before* the parent ScrollView so vertical drags on
      // the board slide a column instead of scrolling the page.
      onStartShouldSetPanResponderCapture: () => !cbRef.current.disabled,
      onMoveShouldSetPanResponderCapture: (_, g) =>
        !cbRef.current.disabled && (Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6),
      onShouldBlockNativeResponder: () => true,
      onPanResponderTerminationRequest: () => false,

      onPanResponderGrant: (e) => {
        const cs = cbRef.current.cellSize;
        const x = e.nativeEvent.locationX ?? 0;
        gestureStart.current = {
          col: Math.min(COLS - 1, Math.max(0, Math.floor(x / cs))),
          row: Math.min(ROWS - 1, Math.max(0, Math.floor((e.nativeEvent.locationY ?? 0) / cs))),
          x,
        };
        gestureHandled.current = false;
        dragAxisRef.current = null;
        dragOffset.setValue(0);
        // Reset RELAX scroll tracker for this gesture
        if (cbRef.current.isRelaxMode) {
          relaxDragRef.current = {
            steps: 0, matchId: cbRef.current.lastMatchId, locked: false,
            col: Math.min(COLS - 1, Math.max(0, Math.floor(x / cs))),
            axis: null,
          };
        }
      },

      // Live-follow: as the finger moves, translate the dragged column (or
      // main row) so it visually tracks the touch.
      // RELAX mode: continuous scroll — dispatch a COL_SLIDE / ROW_SLIDE for
      // every full cell crossed; show only the fractional remainder as dragOffset.
      // Normal modes: clamp offset to one cell, dispatch only on release.
      onPanResponderMove: (_, g) => {
        if (cbRef.current.disabled) return;
        const cs = cbRef.current.cellSize;
        const { col, row } = gestureStart.current;
        const absX = Math.abs(g.dx);
        const absY = Math.abs(g.dy);

        if (cbRef.current.isRelaxMode) {
          // ── RELAX continuous scroll ───────────────────────────────────────
          const rd = relaxDragRef.current;

          // Stop dispatching if a match fired during this drag
          if (cbRef.current.lastMatchId !== rd.matchId) {
            rd.locked = true;
            return;
          }
          if (rd.locked) return;

          // Determine axis on first significant movement.
          // We track axis in rd.axis but do NOT call setDragInfo — the dragOffset
          // fractional preview conflicts with the ball position animations and
          // causes visual doubling. Ball animations from each dispatch are the
          // only visuals needed for continuous scroll.
          if (!dragAxisRef.current) {
            if (Math.max(absX, absY) < 6) return;
            if (absY >= absX) {
              dragAxisRef.current = 'col';
              rd.axis = 'col';
              rd.col = col;
            } else if (row === MAIN_ROW) {
              dragAxisRef.current = 'row';
              rd.axis = 'row';
            } else {
              dragAxisRef.current = 'none';
              return;
            }
          }
          if (dragAxisRef.current === 'none') return;

          if (dragAxisRef.current === 'col') {
            const totalSteps = Math.trunc(g.dy / cs);
            const delta = totalSteps - rd.steps;
            if (delta !== 0) {
              const dir = delta > 0 ? 'down' : 'up';
              for (let i = 0; i < Math.abs(delta); i++) {
                cbRef.current.onColSlide(rd.col, dir);
              }
              rd.steps = totalSteps;
            }
            // No dragOffset — ball animations handle the visual movement
          } else if (dragAxisRef.current === 'row') {
            const totalSteps = Math.trunc(g.dx / cs);
            const delta = totalSteps - rd.steps;
            if (delta !== 0) {
              const dir = delta > 0 ? 'right' : 'left';
              for (let i = 0; i < Math.abs(delta); i++) {
                cbRef.current.onRowSlide(dir);
              }
              rd.steps = totalSteps;
            }
          }
          return; // skip normal one-step preview below
        }

        // ── Normal (non-RELAX) one-step visual preview ────────────────────
        if (!dragAxisRef.current) {
          if (Math.max(absX, absY) < 6) return;
          if (absY >= absX) {
            dragAxisRef.current = 'col';
            setDragInfo({ axis: 'col', index: col, offset: dragOffset });
          } else if (row === MAIN_ROW) {
            dragAxisRef.current = 'row';
            setDragInfo({ axis: 'row', index: MAIN_ROW, offset: dragOffset });
          } else {
            dragAxisRef.current = 'none';
          }
        }

        if (dragAxisRef.current === 'col') {
          dragOffset.setValue(Math.max(-cs, Math.min(cs, g.dy)));
        } else if (dragAxisRef.current === 'row') {
          dragOffset.setValue(Math.max(-cs, Math.min(cs, g.dx)));
        }
      },

      onPanResponderRelease: (_, g) => {
        // ── RELAX: steps were already dispatched during drag; just add momentum ──
        if (cbRef.current.isRelaxMode) {
          // Finger lifted — stop immediately, no momentum
          resetDrag();
          return;
        }

        if (gestureHandled.current || cbRef.current.disabled) {
          resetDrag();
          return;
        }
        const { col, row, x } = gestureStart.current;
        const absX = Math.abs(g.dx);
        const absY = Math.abs(g.dy);
        const threshold = cbRef.current.swipeThreshold;

        if (absX > absY && absX > threshold && row === MAIN_ROW) {
          cbRef.current.onRowSlide(g.dx > 0 ? 'right' : 'left');
          gestureHandled.current = true;
        } else if (absY > absX && absY > threshold) {
          cbRef.current.onColSlide(col, g.dy > 0 ? 'down' : 'up');
          gestureHandled.current = true;
        } else if (cbRef.current.tapToMove && absX < TAP_THRESHOLD && absY < TAP_THRESHOLD) {
          // "Tap to move": tapping a column above the mid row pushes it up,
          // below the mid row pushes it down. Tapping the mid row slides it
          // toward the side that was tapped — unless the centre ball was
          // tapped, which throws a fresh wave of balls onto the board
          // instead of sliding.
          if (row < MAIN_ROW) {
            cbRef.current.onColSlide(col, 'up');
          } else if (row > MAIN_ROW) {
            cbRef.current.onColSlide(col, 'down');
          } else {
            const center = Math.floor(COLS / 2);
            if (col === center) {
              cbRef.current.onCenterTap();
            } else {
              cbRef.current.onRowSlide(col < center ? 'left' : 'right');
            }
          }
          gestureHandled.current = true;
        }

        resetDrag();
      },

      onPanResponderTerminate: () => {
        resetDrag();
      },
    })
  ).current;

  const ballElements = useBallAnimations(board, cellSize, dragInfo, lastMatch, colWrap, powerUps, lastBombBlast);

  return (
    <View style={styles.boardCtrl}>
      <Text style={styles.boardLabel}>{label}</Text>

      {/* Board grid + gesture overlay (swipe up/down to slide a column,
          swipe left/right on the centre row to shift the match row) */}
      <View style={{ position: 'relative' }}>
        <View style={[styles.boardGrid, { width: boardPx }]}>
          {board.map((row, rowIdx) => (
            <View
              key={rowIdx}
              style={[styles.boardRow, rowIdx === MAIN_ROW && styles.mainRowBg]}
            >
              {row.map((cell, colIdx) => {
                const isMain = rowIdx === MAIN_ROW;
                return (
                  <View
                    key={colIdx}
                    style={[
                      styles.cell,
                      { width: cellSize, height: cellSize },
                      isMain && styles.mainCell,
                    ]}
                  />
                );
              })}
            </View>
          ))}
        </View>

        {/* Keyboard column selection highlight (P1/solo board only —
            other boards pass selectedCol={-1}). */}
        {selectedCol >= 0 && selectedCol < COLS && (
          <View
            pointerEvents="none"
            style={[
              styles.selectedColHighlight,
              {
                left: 1 + selectedCol * cellSize,
                width: cellSize,
                height: cellSize * board.length,
              },
            ]}
          />
        )}

        {/* Balls render in their own absolutely-positioned layer so they can
            animate (falling/gravity, fade in/out) independently of the grid. */}
        <View
          style={[styles.ballLayer, { width: boardPx, height: cellSize * board.length }]}
          pointerEvents="none"
        >
          {ballElements}
        </View>

        {!disabled && (
          <View
            {...panResponder.panHandlers}
            style={[StyleSheet.absoluteFill, styles.gestureOverlay]}
            pointerEvents="box-only"
          />
        )}


        {/* Main row shimmer — repeating gold pulse to draw the eye */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: MAIN_ROW * cellSize,
            left: 0,
            width: boardPx,
            height: cellSize,
            backgroundColor: '#FFD700',
            opacity: shimmerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.03, 0.16] }),
          }}
        />

        {/* Match flash — white burst over main row on each match */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: MAIN_ROW * cellSize,
            left: 0,
            width: boardPx,
            height: cellSize,
            backgroundColor: '#FFFFFF',
            opacity: matchFlashAnim,
          }}
        />

        {/* Freeze border — glowing ice ring around the board, nothing over the gameplay area */}
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.freezeBorder, { opacity: freezeAnim }]}
        />
        {/* Corner snowflakes — drift gently at each corner while frozen */}
        {[
          { key: 'tl', top: 2,    left:  2 },
          { key: 'tr', top: 2,    right: 2 },
          { key: 'bl', bottom: 2, left:  2 },
          { key: 'br', bottom: 2, right: 2 },
        ].map(({ key, ...pos }) => (
          <Animated.Text
            key={key}
            pointerEvents="none"
            style={[
              styles.freezeCorner,
              pos,
              {
                opacity: freezeAnim,
                transform: [{
                  translateY: snowDriftAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: key.startsWith('t') ? [0, 3] : [0, -3],
                  }),
                }],
              },
            ]}
          >
            ❄
          </Animated.Text>
        ))}
      </View>
    </View>
  );
});

// ── Main screen ───────────────────────────────────────────────────────────────

export default function GameScreen({ navigation, route }) {
  const mode        = route?.params?.mode ?? 'ai';
  const ballCount    = route?.params?.ballCount ?? 5;
  const aiDifficulty = route?.params?.aiDifficulty ?? DEFAULT_AI_DIFFICULTY;
  const resumeData   = route?.params?.resumeData ?? null;
  const insets = useSafeAreaInsets();
  const isSolo  = mode === 'solo-time' || mode === 'solo-normal' || mode === 'relax' || mode === 'mayhem';

  // Recompute board sizing whenever the viewport changes (resize/orientation).
  // Solo modes render a single board, so it can use nearly the full width.
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const { cellSize, boardPx } = getBoardMetrics(winWidth, isSolo ? 1 : 2, winHeight);

  // The keyboard-selected-column highlight only makes sense on desktop
  // (where arrow keys drive column selection) — hide it on narrow/mobile
  // viewports where it just shows as a stray blue line.
  const isMobile = winWidth < 768;

  const [state, dispatch] = useReducer(gameReducer, undefined, () =>
    createInitialState(mode, ballCount, resumeData)
  );

  // Keep a ref to always-current state for the keyboard handler
  const stateRef = useRef(state);
  stateRef.current = state;



  // ── "Tap to move" setting (toggled in the Settings menu) ─────────────────────
  const [tapToMove, setTapToMove] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem('tapToMove').then(v => setTapToMove(v === 'true'));
  }, []);

  // ── First-run tutorial ────────────────────────────────────────────────────────
  // A simplified "how to play" overlay shown the first time a game mode is
  // started. `showTutorial` starts as `null` (unknown) until the AsyncStorage
  // check resolves, so it never flashes on screen for returning players.
  const [showTutorial, setShowTutorial] = useState(null);
  const showTutorialRef = useRef(false);
  useEffect(() => {
    AsyncStorage.getItem('tutorialDismissed').then(v => setShowTutorial(v !== 'true'));
  }, []);
  showTutorialRef.current = showTutorial === true;

  // ── Leave-game confirmation (mobile/web back gesture) ─────────────────────────
  // On web, the browser/phone "back" gesture would normally navigate away from
  // the site entirely. We trap it with a dummy history entry: a back gesture
  // re-arms that trap, pauses the game, and asks the player to confirm before
  // returning to the Menu screen.
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const showLeaveConfirmRef = useRef(false);
  showLeaveConfirmRef.current = showLeaveConfirm;
  const pausedBeforeConfirmRef = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    window.history.pushState({ marbleGame: true }, '');

    const onPopState = () => {
      // Re-arm the trap so the next back press is caught too.
      window.history.pushState({ marbleGame: true }, '');
      if (stateRef.current.gameOver) return;
      pausedBeforeConfirmRef.current = stateRef.current.paused;
      dispatch({ type: 'SET_PAUSED', value: true });
      setShowLeaveConfirm(true);
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const handleCancelLeave = useCallback(() => {
    sfx.playClick();
    setShowLeaveConfirm(false);
    dispatch({ type: 'SET_PAUSED', value: pausedBeforeConfirmRef.current });
  }, []);

  const handleConfirmLeave = useCallback(() => {
    sfx.playClick();
    setShowLeaveConfirm(false);
    // Persist RELAX state so the player can resume from the menu
    if (mode === 'relax' && !stateRef.current.gameOver) {
      const s = stateRef.current;
      const saveData = {
        board:         s.boards[0],
        score:         s.scores[0],
        combos:        [s.combos?.[0] ?? 0],
        zenXP:         s.zenXP ?? 0,
        zenLevel:      s.zenLevel ?? 1,
        zenXPRequired: s.zenXPRequired ?? zenXPForLevel(1),
        ballCount,
        savedAt:       Date.now(),
      };
      AsyncStorage.setItem(`savedRelaxGame_${ballCount}`, JSON.stringify(saveData)).catch(() => {});
    }
    navigation.navigate('Menu');
  }, [navigation, mode, ballCount]);

  // ── AI timer ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'ai' || state.gameOver || state.paused || showTutorial) return;
    const delay = AI_DELAY[aiDifficulty] ?? AI_DELAY[DEFAULT_AI_DIFFICULTY];
    const t = setTimeout(() => dispatch({ type: 'AI_MOVE' }), delay);
    return () => clearTimeout(t);
  }, [state.aiTick, state.gameOver, state.paused, mode, aiDifficulty, showTutorial]);

  // ── Solo Time Attack countdown ────────────────────────────────────────────────
  useEffect(() => {
    if ((mode !== 'solo-time' && mode !== 'mayhem') || state.gameOver || state.paused || showTutorial) return;
    const t = setInterval(() => dispatch({ type: 'TICK' }), 1000);
    return () => clearInterval(t);
  }, [mode, state.gameOver, state.paused, showTutorial]);

  // ── Mayhem power-up spawning ─────────────────────────────────────────────────
  // One random power-up every 10 s (periodic), plus an extra one when the
  // player lands a chain, combo, or match-5.
  useEffect(() => {
    if (mode !== 'mayhem' || state.gameOver || state.paused || showTutorial) return;
    const t = setInterval(() => dispatch({ type: 'SPAWN_POWERUP' }), 10000);
    return () => clearInterval(t);
  }, [mode, state.gameOver, state.paused, showTutorial]);

  useEffect(() => {
    if (mode !== 'mayhem' || !state.lastMatch) return;
    const { chains, combo, maxSize } = state.lastMatch;
    if (chains > 1 || combo > 1 || maxSize >= 5) dispatch({ type: 'SPAWN_POWERUP' });
  }, [mode, state.lastMatch]);

  // ── Mayhem danger glow — pulsing red screen border when tbomb is active ───────
  // Pulse speed escalates in four tiers as the timer counts down:
  //   tier 1 (8–7 s): slow   600 ms half-cycle
  //   tier 2 (6–5 s): medium 350 ms
  //   tier 3 (4–3 s): fast   200 ms
  //   tier 4 (2–1 s): frantic 120 ms
  // The effect only restarts the loop when the tier changes, not every second.
  const dangerGlowAnim    = useRef(new Animated.Value(0)).current;
  const dangerGlowLoopRef = useRef(null);
  const dangerTierRef     = useRef(0);

  useEffect(() => {
    if (mode !== 'mayhem') return;
    const puMap = state.powerUps ?? {};
    const tbombs = Object.values(puMap).filter(p => p.type === 'tbomb');
    const minTimer = (tbombs.length > 0 && !state.gameOver)
      ? Math.min(...tbombs.map(p => p.timer ?? 8)) : Infinity;

    const newTier = minTimer <= 2 ? 4 : minTimer <= 4 ? 3 : minTimer <= 6 ? 2 : minTimer <= 8 ? 1 : 0;
    if (newTier === dangerTierRef.current) return; // no tier change
    dangerTierRef.current = newTier;

    if (dangerGlowLoopRef.current) { dangerGlowLoopRef.current.stop(); dangerGlowLoopRef.current = null; }

    if (newTier === 0) {
      Animated.timing(dangerGlowAnim, { toValue: 0, duration: 300, useNativeDriver: false }).start();
      return;
    }
    const halfDur = [0, 600, 350, 200, 120][newTier];
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(dangerGlowAnim, { toValue: 0.9,  duration: halfDur, useNativeDriver: false }),
      Animated.timing(dangerGlowAnim, { toValue: 0.15, duration: halfDur, useNativeDriver: false }),
    ]));
    loop.start();
    dangerGlowLoopRef.current = loop;
  }, [mode, state.powerUps, state.gameOver]);

  // ── Countdown vignette (TIME BLAST) ──────────────────────────────────────────
  // Pulses as a full-screen edge-darkening overlay; speed ramps up as time drops.
  const vignetteAnim    = useRef(new Animated.Value(0)).current;
  const vignetteLoopRef = useRef(null);
  const vignettePhase = (mode !== 'mayhem' || state.gameOver) ? -1
    : (state.timeLeft ?? 61) <= 10 ? 3
    : (state.timeLeft ?? 61) <= 20 ? 2
    : (state.timeLeft ?? 61) <= 30 ? 1 : 0;

  useEffect(() => {
    if (vignettePhase < 0) {
      if (vignetteLoopRef.current) { vignetteLoopRef.current.stop(); vignetteLoopRef.current = null; }
      vignetteAnim.setValue(0);
      return;
    }
    const halfDur = [1100, 750, 500, 280][vignettePhase];
    if (vignetteLoopRef.current) vignetteLoopRef.current.stop();
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(vignetteAnim, { toValue: 1, duration: halfDur, useNativeDriver: false }),
      Animated.timing(vignetteAnim, { toValue: 0, duration: halfDur, useNativeDriver: false }),
    ]));
    vignetteLoopRef.current = loop;
    loop.start();
    return () => { if (vignetteLoopRef.current) { vignetteLoopRef.current.stop(); vignetteLoopRef.current = null; } };
  }, [vignettePhase]);

  // ── Automatic ball-add timer (solo modes) ─────────────────────────────────────
  // Every BALL_ADD_INTERVAL ms, BALL_ADD_COUNT balls drop into random columns.
  // ballAddAnim animates 0→1 over that interval to drive the thin progress
  // line below the header; it restarts whenever the timer fires (ballAddTick)
  // or pause state changes.
  const ballAddAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // Zen Mode/Time Attack have no global ball-add timer — balls only enter via
    // the top-of-column refill when a match clears.
    if (!isSolo || usesRelaxMechanics(mode) || state.gameOver || state.paused || showTutorial) return;
    ballAddAnim.setValue(0);
    const anim = Animated.timing(ballAddAnim, {
      toValue: 1,
      duration: BALL_ADD_INTERVAL,
      easing: Easing.linear,
      useNativeDriver: false,
    });
    anim.start();
    const t = setTimeout(() => dispatch({ type: 'AUTO_BALL_ADD' }), BALL_ADD_INTERVAL);
    return () => { clearTimeout(t); anim.stop(); };
  }, [isSolo, state.gameOver, state.paused, state.ballAddTick, showTutorial]);

  // ── Message auto-clear ────────────────────────────────────────────────────────
  const msgTimer = useRef(null);
  useEffect(() => {
    if (!state.message) return;
    clearTimeout(msgTimer.current);
    msgTimer.current = setTimeout(() => dispatch({ type: 'CLEAR_MESSAGE' }), 1600);
    return () => clearTimeout(msgTimer.current);
  }, [state.message]);

  // ── High score (separate per solo mode) ───────────────────────────────────────
  // Each solo mode (solo-time / solo-normal / relax) keeps its own
  // AsyncStorage key, so a Zen Mode high score doesn't overwrite/compete with
  // a Time Attack or Challenge one. `bestScore` mirrors the stored value for
  // display in the game-over overlay.
  const [bestScore, setBestScore] = useState(0);

  // Leaderboard name-entry state (shown in game-over overlay when score qualifies)
  const [showNameEntry, setShowNameEntry] = useState(false);
  const [isNewBest, setIsNewBest] = useState(false);
  const [lbName, setLbName] = useState('');
  const [lbSaved, setLbSaved] = useState(false);
  const [lbSaveError, setLbSaveError] = useState(null);

  // Pre-fill player name from last saved entry
  useEffect(() => {
    AsyncStorage.getItem('lbPlayerName').then(v => { if (v) setLbName(v); });
  }, []);

  // Reset name-entry state when a new game starts
  useEffect(() => {
    if (!state.gameOver) {
      setShowNameEntry(false);
      setLbSaved(false);
      setLbSaveError(null);
      setIsNewBest(false);
      // Re-load saved name instead of blanking it, so it's pre-filled each game
      AsyncStorage.getItem('lbPlayerName').then(v => setLbName(v || ''));
    }
  }, [state.gameOver]);

  // Load this mode's current best once on mount.
  useEffect(() => {
    if (!isSolo) return;
    AsyncStorage.getItem(`highScore_${mode}_${ballCount}`).then(v => setBestScore(v ? parseInt(v, 10) : 0));
  }, [isSolo, mode]);

  // Zen Mode has no game-over state, so the high score is checked as the
  // score updates rather than only once at the end of a run.
  useEffect(() => {
    if (!isSolo) return;
    const score = state.scores[0];
    if (score <= 0) return;
    const key = `highScore_${mode}_${ballCount}`;
    AsyncStorage.getItem(key).then(v => {
      const prevBest = v ? parseInt(v, 10) : 0;
      if (score > prevBest) {
        AsyncStorage.setItem(key, String(score));
        setBestScore(score);
        setIsNewBest(true);
      }
    });
  }, [isSolo, mode, state.scores[0]]);

  // ── RELAX auto-save: persist progress on every match so the player can resume ──
  useEffect(() => {
    if (mode !== 'relax' || state.gameOver) return;
    const saveData = {
      board:         state.boards[0],
      score:         state.scores[0],
      combos:        [state.combos?.[0] ?? 0],
      zenXP:         state.zenXP ?? 0,
      zenLevel:      state.zenLevel ?? 1,
      zenXPRequired: state.zenXPRequired ?? zenXPForLevel(1),
      ballCount,
      savedAt:       Date.now(),
    };
    AsyncStorage.setItem(`savedRelaxGame_${ballCount}`, JSON.stringify(saveData)).catch(() => {});
  }, [mode, state.scores[0], state.zenLevel, state.gameOver]);

  // Clear save when the session is intentionally ended (End Session / time's up)
  useEffect(() => {
    if (mode === 'relax' && state.gameOver) {
      AsyncStorage.removeItem(`savedRelaxGame_${ballCount}`).catch(() => {});
    }
  }, [mode, state.gameOver]);

  // ── Keyboard controls (web) ───────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onKey = (e) => {
      const s = stateRef.current;
      if (s.gameOver || showTutorialRef.current || showLeaveConfirmRef.current) return;

      if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
        dispatch({ type: 'TOGGLE_PAUSE' });
        e.preventDefault();
        return;
      }
      if (s.paused) return;

      switch (e.key) {
        case 'ArrowLeft':
        case 'a':
        case 'A':
          dispatch({ type: 'SELECT_COL', delta: -1 });
          e.preventDefault();
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          dispatch({ type: 'SELECT_COL', delta: 1 });
          e.preventDefault();
          break;
        case 'ArrowUp':
        case 'w':
        case 'W':
          dispatch({ type: 'COL_SLIDE', player: 0, col: s.selectedCol, dir: 'up' });
          e.preventDefault();
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          dispatch({ type: 'COL_SLIDE', player: 0, col: s.selectedCol, dir: 'down' });
          e.preventDefault();
          break;
        case ' ':
          dispatch({ type: 'ROW_SLIDE', player: 0, dir: 'right' });
          e.preventDefault();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // register once; stateRef always has current state

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleP1ColSlide = useCallback((col, dir) => {
    sfx.playMove();
    dispatch({ type: 'COL_SLIDE', player: 0, col, dir });
  }, []);
  const handleP1RowSlide = useCallback((dir) => {
    sfx.playMove();
    dispatch({ type: 'ROW_SLIDE', player: 0, dir });
  }, []);
  const handleP2ColSlide = useCallback((col, dir) => {
    sfx.playMove();
    dispatch({ type: 'COL_SLIDE', player: 1, col, dir });
  }, []);
  const handleP2RowSlide = useCallback((dir) => {
    sfx.playMove();
    dispatch({ type: 'ROW_SLIDE', player: 1, dir });
  }, []);
  const handleP1CenterTap = useCallback(() => {
    sfx.playMove();
    dispatch({ type: 'SPAWN_WAVE', player: 0 });
  }, []);
  const handleP2CenterTap = useCallback(() => {
    sfx.playMove();
    dispatch({ type: 'SPAWN_WAVE', player: 1 });
  }, []);

  // ── Leaderboard save ─────────────────────────────────────────────────────────
  const saveToLeaderboard = useCallback(async () => {
    const score = stateRef.current.scores[0];
    const name  = lbName.trim() || 'Player';
    setLbSaveError(null);
    try {
      await AsyncStorage.setItem('lbPlayerName', name); // always persist name
      let savedToBoard = false;
      if (isNewBest && score > 0) {
        const qualifies = await scoreQualifies(`${mode}-${ballCount}`, score).catch(() => true);
        if (qualifies) {
          await saveScore(`${mode}-${ballCount}`, name, score);
          savedToBoard = true;
        }
      }
      setShowNameEntry(false);
      if (savedToBoard) setLbSaved(true);
      sfx.playClick();
    } catch (e) {
      setLbSaveError(`Could not save: ${e?.code ?? e?.message ?? 'unknown error'}`);
    }
  }, [lbName, mode, isNewBest]);

  // ── Sound effects: matches, chains, penalties, game over ─────────────────────
  useEffect(() => {
    if (!state.lastMatch) return;
    if (state.lastMatch.chains > 1) {
      sfx.playChain(state.lastMatch.chains);
      haptics.vibrateChain();
    } else {
      sfx.playMatch();
      haptics.vibrateMatch();
    }
    if (!isSolo) sfx.playPenalty();
  }, [state.lastMatch]);

  // Show name-entry when:
  //   a) player just beat their best AND qualifies for leaderboard, OR
  //   b) player has never set a name (first game — prompt so future runs are pre-filled).
  useEffect(() => {
    if (!state.gameOver || !isSolo || mode === 'relax') return;
    const score = state.scores[0];
    // First-time player: prompt regardless of score
    if (!lbName) {
      setShowNameEntry(true);
      return;
    }
    if (!isNewBest || score <= 0) return;
    scoreQualifies(`${mode}-${ballCount}`, score)
      .then(qualifies => { if (qualifies) setShowNameEntry(true); })
      .catch(() => { setShowNameEntry(true); });
  }, [state.gameOver]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!state.gameOver) return;
    haptics.vibrateGameOver();
    if (isSolo) {
      sfx.playRoundEnd();
    } else if (state.winner === null) {
      sfx.playRoundEnd();
    } else if (mode === 'ai') {
      state.winner === 0 ? sfx.playWin() : sfx.playLose();
    } else {
      sfx.playWin();
    }
  }, [state.gameOver]);

  const { boards, scores, gameOver, winner, lastMatch, selectedCol, paused, timeLeft } = state;
  const zenXP         = state.zenXP         ?? 0;
  const zenLevel      = state.zenLevel      ?? 1;
  const zenXPRequired = state.zenXPRequired ?? 20;
  const powerUps       = state.powerUps ?? {};
  const freezeLeft     = state.freezeLeft ?? 0;
  const multiplierLeft = state.multiplierLeft ?? 0;
  const mayhemOverReason = state.mayhemOverReason ?? null;
  const lastBombBlast   = state.lastBombBlast ?? null;
  const lastTbombDefuse = state.lastTbombDefuse ?? 0;
  // Consecutive-matching-move streak (already drives score multiplier)
  const streakCombo = isSolo ? (state.combos?.[0] ?? 0) : 0;

  // ── Power-up sound effects ─────────────────────────────────────────────────────
  // Freeze: play when freezeLeft transitions from 0 to positive (i.e. freeze activated)
  const prevFreezeLeftRef = useRef(0);
  useEffect(() => {
    if (freezeLeft > 0 && prevFreezeLeftRef.current === 0) sfx.playFreeze();
    prevFreezeLeftRef.current = freezeLeft;
  }, [freezeLeft]);

  // Bomb: play each time a new bomb blast fires (guarded by blast id)
  const prevBombBlastIdRef = useRef(null);
  useEffect(() => {
    if (lastBombBlast && lastBombBlast.id !== prevBombBlastIdRef.current) {
      prevBombBlastIdRef.current = lastBombBlast.id;
      sfx.playBomb();
      haptics.vibratePowerUp();
    }
  }, [lastBombBlast]);

  // Tbomb defuse: triumphant sound each time a timed bomb is matched/defused
  const prevTbombDefuseRef = useRef(0);
  useEffect(() => {
    if (lastTbombDefuse > prevTbombDefuseRef.current) {
      prevTbombDefuseRef.current = lastTbombDefuse;
      sfx.playTbombDefuse();
      haptics.vibratePowerUp();
    }
  }, [lastTbombDefuse]);

  // ── Score pop animation ───────────────────────────────────────────────────────
  const scorePop = useRef(new Animated.Value(1)).current;
  const prevScoreRef = useRef(0);
  useEffect(() => {
    const s = scores[0];
    if (s > prevScoreRef.current) {
      Animated.sequence([
        Animated.timing(scorePop, { toValue: 1.45, duration: 110, useNativeDriver: true }),
        Animated.timing(scorePop, { toValue: 1.0,  duration: 160, useNativeDriver: true }),
      ]).start();
    }
    prevScoreRef.current = s;
  }, [scores[0]]);

  // ── Animated score tick-up (#7) ───────────────────────────────────────────────
  // Displayed score ticks smoothly toward the real score rather than jumping.
  const displayedScoreRef = useRef(0);
  const [displayedScore, setDisplayedScore]   = useState(0);
  const scoreTickRafRef   = useRef(null);
  useEffect(() => {
    const target = scores[0];
    const start  = displayedScoreRef.current;
    if (target === start) return;
    const diff     = target - start;
    const duration = Math.min(700, Math.max(180, Math.abs(diff) * 1.5));
    const startTime = Date.now();
    const tick = () => {
      const elapsed  = Date.now() - startTime;
      const progress = Math.min(1, elapsed / duration);
      const eased    = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const current  = Math.round(start + diff * eased);
      displayedScoreRef.current = current;
      setDisplayedScore(current);
      if (progress < 1) {
        scoreTickRafRef.current = requestAnimationFrame(tick);
      }
    };
    if (scoreTickRafRef.current) cancelAnimationFrame(scoreTickRafRef.current);
    scoreTickRafRef.current = requestAnimationFrame(tick);
    return () => { if (scoreTickRafRef.current) cancelAnimationFrame(scoreTickRafRef.current); };
  }, [scores[0]]);
  // ── Chain popup animation ─────────────────────────────────────────────────────
  const chainPopOpacity = useRef(new Animated.Value(0)).current;
  const chainPopScale   = useRef(new Animated.Value(0.5)).current;
  const [chainPopLabel, setChainPopLabel] = useState('');
  useEffect(() => {
    if (!state.lastMatch || state.lastMatch.chains <= 1) return;
    const n = state.lastMatch.chains;
    setChainPopLabel(`CHAIN ×${n}!`);
    chainPopOpacity.setValue(0);
    chainPopScale.setValue(0.5);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(chainPopOpacity, { toValue: 1,   duration: 120, useNativeDriver: true }),
        Animated.spring(chainPopScale,   { toValue: 1.0, speed: 18, bounciness: 10, useNativeDriver: true }),
      ]),
      Animated.delay(700),
      Animated.timing(chainPopOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  }, [state.lastMatch]);

  const p2Label = mode === 'ai' ? 'CPU' : 'P2';

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1,
      backgroundColor: mode === 'mayhem' ? '#130808' : mode === 'relax' ? '#071518' : '#080815',
      ...Platform.select({ web: {
        background: mode === 'mayhem'
          ? 'radial-gradient(ellipse at 50% 45%, #2A100A 0%, #130808 68%)'
          : mode === 'relax'
          ? 'radial-gradient(ellipse at 50% 45%, #0A2220 0%, #071518 68%)'
          : 'radial-gradient(ellipse at 50% 45%, #14143A 0%, #080815 68%)',
      }})
    }}>

      {/* ── Timer vignette (TIME BLAST) — pulses faster as time runs out ─── */}
      {mode === 'mayhem' && (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, {
            zIndex: 5,
            opacity: vignetteAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [
                (state.timeLeft ?? 61) <= 10 ? 0.12 : (state.timeLeft ?? 61) <= 30 ? 0.04 : 0,
                (state.timeLeft ?? 61) <= 10 ? 0.72 : (state.timeLeft ?? 61) <= 20 ? 0.52 : (state.timeLeft ?? 61) <= 30 ? 0.38 : 0.22,
              ],
            }),
            ...Platform.select({ web: {
              background: 'radial-gradient(ellipse at 50% 50%, transparent 28%, rgba(210,15,0,0.88) 100%)',
            }}),
          }]}
        />
      )}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.root,
          { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) },
        ]}
        bounces={false}
        keyboardShouldPersistTaps="always"
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => { sfx.playClick(); navigation.goBack(); }} style={styles.headerBtn}>
            <Text style={styles.headerBtnTxt}>◀</Text>
          </TouchableOpacity>

          {isSolo ? (
            <>
              <View style={styles.scoreBlock}>
                <Text style={styles.scoreLabel}>SCORE</Text>
                <Animated.Text style={[styles.scoreVal, { transform: [{ scale: scorePop }] }]}>{displayedScore}</Animated.Text>
              </View>


              {(mode === 'solo-time' || mode === 'mayhem') && (
                <View style={styles.scoreBlock}>
                  <Text style={[styles.scoreLabel, freezeLeft > 0 && styles.freezeLabel]}>
                    {freezeLeft > 0 ? '❄ FROZEN' : 'TIME'}
                  </Text>
                  <Text style={[
                    styles.scoreVal,
                    timeLeft <= 10 && styles.timeWarning,
                    freezeLeft > 0 && styles.freezeVal,
                  ]}>
                    {formatTime(timeLeft)}
                  </Text>
                  {mode === 'mayhem' && multiplierLeft > 0 && (
                    <View style={styles.multBarOuter}>
                      <View style={[styles.multBarInner, { width: `${(multiplierLeft / 8) * 100}%` }]} />
                      <Text style={styles.multBarLabel}>×2</Text>
                    </View>
                  )}
                </View>
              )}
            </>
          ) : (
            <>
              <View style={styles.scoreBlock}>
                <Text style={styles.scoreLabel}>P1</Text>
                <Text style={styles.scoreVal}>{scores[0]}</Text>
              </View>

              <Text style={styles.vsText}>VS</Text>

              <View style={styles.scoreBlock}>
                <Text style={styles.scoreLabel}>{p2Label}</Text>
                <Text style={styles.scoreVal}>{scores[1]}</Text>
              </View>
            </>
          )}

          {/* Pause button */}
          <TouchableOpacity
            onPress={() => { sfx.playClick(); dispatch({ type: 'TOGGLE_PAUSE' }); }}
            style={styles.headerBtn}
            disabled={gameOver}
          >
            <Text style={styles.headerBtnTxt}>{paused ? '▶' : '⏸'}</Text>
          </TouchableOpacity>

          {/* Reset button */}
          <TouchableOpacity
            onPress={() => {
              sfx.playClick();
              if (mode === 'relax') AsyncStorage.removeItem(`savedRelaxGame_${ballCount}`).catch(() => {});
              dispatch({ type: 'RESET' });
            }}
            style={styles.headerBtn}
          >
            <Text style={styles.headerBtnTxt}>↺</Text>
          </TouchableOpacity>
        </View>

        {/* Ball-add timer indicator — thin line that fills up over
            BALL_ADD_INTERVAL ms, then resets when new balls drop in.
            Not shown in Zen Mode/Time Attack, which have no such timer. */}
        {isSolo && !usesRelaxMechanics(mode) && (
          <View style={styles.ballAddTrack}>
            <Animated.View
              style={[
                styles.ballAddFill,
                { width: ballAddAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
              ]}
            />
          </View>
        )}

        {mode === 'relax' && (
          <View style={styles.zenProgressRow}>
            <Text style={styles.zenLevelTxt}>LEVEL {zenLevel}</Text>
            <View style={styles.zenBarTrack}>
              <View style={[styles.zenBarFill, { width: `${Math.round((zenXP / zenXPRequired) * 100)}%` }]} />
            </View>
          </View>
        )}

        {/* Streak / combo indicator — shown when the player has a consecutive matching streak */}
        {isSolo && streakCombo >= 2 && (
          <View style={styles.streakRow}>
            <Text style={styles.streakTxt}>🔥 ×{streakCombo} STREAK</Text>
          </View>
        )}

        {/* Boards */}
        {isSolo ? (
          <View style={styles.soloRow}>
            <BoardWithControls
              board={boards[0]}
              label={mode === 'solo-time' ? 'TIME ATTACK' : mode === 'relax' ? 'RELAX' : mode === 'mayhem' ? 'TIME BLAST' : 'CHALLENGE'}
              onColSlide={handleP1ColSlide}
              onRowSlide={handleP1RowSlide}
              onCenterTap={handleP1CenterTap}
              disabled={gameOver || paused || !!showTutorial}
              selectedCol={isMobile ? -1 : selectedCol}
              cellSize={cellSize}
              boardPx={boardPx}
              tapToMove={tapToMove}
              lastMatch={lastMatch}
              colWrap={usesRelaxMechanics(mode)}
              powerUps={powerUps}
              freezeActive={freezeLeft > 0}
              lastBombBlast={lastBombBlast}
              isRelaxMode={mode === 'relax'}
              lastMatchId={lastMatch?.id ?? 0}
            />
          </View>
        ) : (
          <View style={styles.boardsRow}>
            <BoardWithControls
              board={boards[0]}
              label="P1"
              onColSlide={handleP1ColSlide}
              onRowSlide={handleP1RowSlide}
              onCenterTap={handleP1CenterTap}
              disabled={gameOver || paused || !!showTutorial}
              selectedCol={isMobile ? -1 : selectedCol}
              cellSize={cellSize}
              boardPx={boardPx}
              tapToMove={tapToMove}
              lastMatch={lastMatch}
              colWrap={false}
            />

            <View style={styles.divider} />

            <BoardWithControls
              board={boards[1]}
              label={p2Label}
              onColSlide={handleP2ColSlide}
              onRowSlide={handleP2RowSlide}
              onCenterTap={handleP2CenterTap}
              disabled={gameOver || paused || mode === 'ai' || !!showTutorial}
              selectedCol={-1}
              cellSize={cellSize}
              boardPx={boardPx}
              tapToMove={tapToMove}
              lastMatch={lastMatch}
              colWrap={false}
            />
          </View>
        )}

      </ScrollView>

      {/* Chain popup overlay — appears briefly above board on multi-chain matches */}
      {isSolo && (
        <Animated.View
          pointerEvents="none"
          style={[styles.chainPopOverlay, { opacity: chainPopOpacity }]}
        >
          <Animated.Text
            style={[styles.chainPopText, { transform: [{ scale: chainPopScale }] }]}
          >
            {chainPopLabel}
          </Animated.Text>
        </Animated.View>
      )}

      {/* Mayhem danger border — full-screen pulsing red ring when a timed bomb is active */}
      {mode === 'mayhem' && (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.dangerBorder, { opacity: dangerGlowAnim }]}
        />
      )}

      {/* Pause overlay */}
      {paused && !gameOver && !showLeaveConfirm && (
        <View style={styles.overlay}>
          <Text style={styles.goTitle}>⏸  PAUSED</Text>

          <TouchableOpacity style={styles.goBtn} onPress={() => { sfx.playClick(); dispatch({ type: 'TOGGLE_PAUSE' }); }}>
            <Text style={styles.goBtnTxt}>▶  Resume</Text>
          </TouchableOpacity>
          {mode === 'relax' && (
            <TouchableOpacity
              style={[styles.goBtn, styles.goBtnEndSession]}
              onPress={() => { sfx.playClick(); dispatch({ type: 'ZEN_END_SESSION' }); }}
            >
              <Text style={[styles.goBtnTxt, styles.goBtnTxtSecondary]}>⏹  End Session</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.goBtn, styles.goBtnSecondary]}
            onPress={() => { sfx.playClick(); navigation.navigate('Menu'); }}
          >
            <Text style={[styles.goBtnTxt, styles.goBtnTxtSecondary]}>Main Menu</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Leave-game confirmation (triggered by phone/browser back gesture) */}
      {showLeaveConfirm && (
        <View style={styles.overlay}>
          <Text style={styles.goTitle}>Leave Game?</Text>
          <Text style={styles.leaveMsg}>Your progress in this match will be lost.</Text>

          <TouchableOpacity style={styles.goBtn} onPress={handleConfirmLeave}>
            <Text style={styles.goBtnTxt}>Leave to Menu</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.goBtn, styles.goBtnSecondary]} onPress={handleCancelLeave}>
            <Text style={[styles.goBtnTxt, styles.goBtnTxtSecondary]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Game over overlay */}
      {gameOver && (
        <View style={styles.overlay}>
          {isSolo ? (
            <>
              <Text style={styles.goTitle}>
                {mode === 'relax'
                ? '✅  SESSION ENDED'
                : (mode === 'solo-time' || mode === 'mayhem')
                ? (mayhemOverReason === 'bomb' ? '💀  BOMB EXPLODED!' : "⏰  TIME'S UP!")
                : '🔒  STUCK!'}
              </Text>

              <View style={styles.goScores}>
                <View style={styles.goScoreCol}>
                  <Text style={styles.goScoreLabel}>SCORE</Text>
                  <Text style={styles.goScoreVal}>{scores[0]}</Text>
                </View>
                <Text style={styles.goScoreSep}>—</Text>
                <View style={styles.goScoreCol}>
                  <Text style={[styles.goScoreLabel, isNewBest && styles.newBestLabel]}>
                    {isNewBest ? '🏆 NEW BEST' : 'BEST'}
                  </Text>
                  <Text style={[styles.goScoreVal, isNewBest && styles.newBestVal]}>{bestScore}</Text>
                </View>
              </View>
              {mode === 'relax' && zenLevel > 1 && (
                <Text style={styles.zenLevelReached}>Level {zenLevel} reached</Text>
              )}
            </>
          ) : (
            <>
              <Text style={styles.goTitle}>
                {winner === 0 ? '🏆  P1 WINS' :
                 winner === 1 ? (mode === 'ai' ? '🤖  CPU WINS' : '🏆  P2 WINS') :
                 'DRAW'}
              </Text>

              <View style={styles.goScores}>
                <View style={styles.goScoreCol}>
                  <Text style={styles.goScoreLabel}>P1</Text>
                  <Text style={styles.goScoreVal}>{scores[0]}</Text>
                </View>
                <Text style={styles.goScoreSep}>—</Text>
                <View style={styles.goScoreCol}>
                  <Text style={styles.goScoreLabel}>{p2Label}</Text>
                  <Text style={styles.goScoreVal}>{scores[1]}</Text>
                </View>
              </View>
            </>
          )}

          {/* Leaderboard name-entry: shown on qualifying score OR first-time player */}
          {isSolo && showNameEntry && !lbSaved && (
            <View style={styles.nameEntryBox}>
              <Text style={styles.nameEntryTitle}>
                {isNewBest ? '🏆 Enter your name' : '👤 Set your player name'}
              </Text>
              {!isNewBest && (
                <Text style={styles.nameEntryHint}>Save your name for the leaderboard</Text>
              )}
              <TextInput
                style={styles.nameEntryInput}
                value={lbName}
                onChangeText={setLbName}
                placeholder="Your name"
                placeholderTextColor="#444"
                maxLength={20}
                returnKeyType="done"
                onSubmitEditing={saveToLeaderboard}
                autoFocus
              />
              <TouchableOpacity style={styles.nameSaveBtn} onPress={saveToLeaderboard}>
                <Text style={styles.nameSaveBtnTxt}>
                  {isNewBest ? 'Save to Leaderboard' : 'Save Name'}
                </Text>
              </TouchableOpacity>
              {lbSaveError && (
                <Text style={styles.lbSaveErrorTxt}>{lbSaveError}</Text>
              )}
              <TouchableOpacity onPress={() => { sfx.playClick(); setShowNameEntry(false); }}>
                <Text style={styles.nameSkipTxt}>Skip</Text>
              </TouchableOpacity>
            </View>
          )}
          {isSolo && lbSaved && (
            <Text style={styles.lbSavedTxt}>✓ Score saved to leaderboard!</Text>
          )}

          <TouchableOpacity style={styles.goBtn} onPress={() => { sfx.playClick(); dispatch({ type: 'RESET' }); }}>
            <Text style={styles.goBtnTxt}>▶  Play Again</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.goBtn, styles.goBtnSecondary]}
            onPress={() => { sfx.playClick(); navigation.navigate('Menu'); }}
          >
            <Text style={[styles.goBtnTxt, styles.goBtnTxtSecondary]}>Main Menu</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* First-run tutorial — animated step-by-step */}
      <TutorialModal
        visible={showTutorial === true}
        showDismiss
        onClose={(dontShow) => {
          if (dontShow) AsyncStorage.setItem('tutorialDismissed', 'true');
          setShowTutorial(false);
        }}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flexGrow: 1,
    alignItems: 'center',
    paddingVertical: 4,
  },

  // Header
  header: {
    flexDirection: 'row',
    width: '100%',
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerBtn:    { width: 36, alignItems: 'center' },
  headerBtnTxt: { color: '#666', fontSize: 20 },
  scoreBlock:   { alignItems: 'center' },
  scoreLabel:   { color: '#555', fontSize: 10, letterSpacing: 1 },
  scoreVal:     { color: '#FFF', fontSize: 24, fontWeight: 'bold' },

  // 2× multiplier countdown bar (shown under TIME block in Mayhem)
  // ── Zen Mode progress bar ──────────────────────────────────────────────────
  zenProgressRow:  { flexDirection: 'column', paddingHorizontal: 12, paddingTop: 4, paddingBottom: 6, gap: 4, borderBottomWidth: 1, borderBottomColor: '#0D0D22' },
  zenLevelTxt:     { color: '#2ED573', fontSize: 14, fontWeight: 'bold', letterSpacing: 1 },
  zenBarTrack:     { width: '100%', height: 10, backgroundColor: '#1A1A38', borderRadius: 5, overflow: 'hidden' },
  zenBarFill:      { height: '100%', backgroundColor: '#2ED573', borderRadius: 5 },
  zenLevelReached: { color: '#2ED573', fontSize: 14, fontWeight: 'bold', textAlign: 'center', marginTop: 8, letterSpacing: 1 },
  goBtnEndSession: { borderColor: '#FF6B35', borderWidth: 1.5, backgroundColor: 'transparent' },

  multBarOuter: {
    position: 'relative', marginTop: 3,
    width: 64, height: 6, borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden',
  },
  multBarInner: {
    position: 'absolute', left: 0, top: 0, bottom: 0,
    backgroundColor: '#FFD700', borderRadius: 3,
  },
  multBarLabel: {
    position: 'absolute', left: 0, right: 0, top: -14,
    textAlign: 'center', fontSize: 10, fontWeight: 'bold',
    color: '#FFD700',
    ...Platform.select({ web: { textShadow: '0 0 4px rgba(255,215,0,0.8)' } }),
  },
  timeWarning:  { color: '#FF4757' },
  vsText:       { color: '#333', fontSize: 14, fontWeight: 'bold' },

  // Ball-add timer indicator — thin transparent line below the header that
  // fills up over BALL_ADD_INTERVAL ms, then resets when new balls drop in.
  ballAddTrack: {
    width: '100%',
    height: 2,
    marginTop: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  ballAddFill: {
    height: '100%',
    backgroundColor: 'rgba(30,144,255,0.45)',
  },

  // Floating match-score popup — rendered over the matched balls' centroid,
  // enlarging and fading out (see useBallAnimations()). Variants below give
  // 4-matches, 5-matches, and chain matches their own celebration styling.
  popup: {
    position: 'absolute',
    alignItems: 'center',
    zIndex: 10,
  },
  popupText: {
    fontWeight: 'bold',
    color: '#FFD700',
    fontSize: 18,
    letterSpacing: 1,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  popupText_normal: {},
  popupText_big4: { color: '#FFA500', fontSize: 22 },
  popupText_big5: { color: '#FF4D6D', fontSize: 26 },
  popupText_chain: { color: '#5FE0FF', fontSize: 24 },
  popupSubText: {
    fontWeight: 'bold',
    color: '#FFD700',
    fontSize: 12,
    letterSpacing: 1,
    marginTop: 1,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  popupSubText_normal: {},
  popupSubText_big4: { color: '#FFA500' },
  popupSubText_big5: { color: '#FF4D6D' },
  popupSubText_chain: { color: '#5FE0FF' },

  // Boards container
  boardsRow: { flexDirection: 'row', alignItems: 'flex-start' },
  soloRow:   { alignItems: 'center', width: '100%' },
  divider:   { width: 6 },

  // Board + controls wrapper
  boardCtrl:  { alignItems: 'center' },
  boardLabel: { color: '#444', fontSize: 10, letterSpacing: 2, marginBottom: 4 },

  // Gesture overlay over the board grid. `touchAction: 'none'` (web only)
  // stops the browser from treating vertical drags as page-scroll gestures
  // so the PanResponder gets them instead.
  gestureOverlay: Platform.select({
    web: { touchAction: 'none' },
    default: {},
  }),

  // Board grid
  boardGrid: {
    backgroundColor: '#0D0D22',
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1E1E44',
  },
  boardRow: { flexDirection: 'row' },

  // Highlight bar for the keyboard-selected column (P1/solo board).
  selectedColHighlight: {
    position: 'absolute',
    top: 1,
    backgroundColor: 'rgba(30,144,255,0.10)',
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(30,144,255,0.30)',
  },

  // Ball layer — absolutely positioned overlay on top of the (now empty)
  // grid cells. Each ball is an Animated.View positioned via top/left so it
  // can slide smoothly between cells (gravity / clears).
  ballLayer: {
    position: 'absolute',
    top: 1,
    left: 1,
    overflow: 'hidden',
  },
  ballSlot: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // White flash rendered behind a matched ball during its "pop" before it
  // shrinks/fades out — see useBallAnimations().
  ghostGlow: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
  },

  // Main row — gold frame lines top + bottom, brightened background, and a
  // soft outer glow so it visually reads as "the active row where matches
  // happen" at a glance.
  mainRowBg: {
    backgroundColor: 'rgba(255,215,0,0.20)',
    borderTopWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: '#FFD700',
    zIndex: 1,
    ...Platform.select({
      web: { boxShadow: '0 0 10px 1px rgba(255,215,0,0.35)' },
      default: {
        shadowColor: '#FFD700',
        shadowOpacity: 0.5,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 0 },
        elevation: 4,
      },
    }),
  },

  // Cells
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0C0C24',
    borderWidth: 0.5,
    borderColor: '#1E1E42',
  },
  mainCell: {
    borderColor: '#3A2000',
  },

  // Row slide buttons
  rowSlideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  rowSlideBtn: {
    width: 36,
    height: 32,
    backgroundColor: '#1E3060',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowSlideBtnDim: { backgroundColor: '#0D0D1A' },
  rowSlideTxt:    { color: '#6688CC', fontSize: 16, fontWeight: 'bold' },
  rowSlideTxtDim: { color: '#2A2A44' },
  matchLabel:     { color: '#5A3A00', fontSize: 9, letterSpacing: 1 },

  // Keyboard hint
  kbHint: {
    color: '#2A2A44',
    fontSize: 10,
    letterSpacing: 0.5,
    marginTop: 12,
  },

  // Game over overlay
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  goTitle:      { color: '#FFD700', fontSize: 32, fontWeight: 'bold', letterSpacing: 2, marginBottom: 20 },
  leaveMsg:     { color: '#999', fontSize: 14, textAlign: 'center', marginBottom: 28, marginTop: -8 },

  // Power-up overlay on balls (Mayhem mode)
  puOverlay: {
    position: 'absolute',
    top: 0, bottom: 0, left: 0, right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  puSymbol: {
    fontWeight: 'bold',
    color: '#FFF',
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 4,
  },

  // Timed-bomb badge: 💀 emoji with countdown number overlaid
  tbombBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  tbombCount: {
    position: 'absolute',
    color: '#FFFFFF',
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,1)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
    ...Platform.select({
      web: { WebkitTextStroke: '1.5px #000', paintOrder: 'stroke fill' },
    }),
  },
  tbombCountWarn:   { color: '#FFAA00' },  // 4-6 s remaining
  tbombCountUrgent: { color: '#FF2222' },  // 1-3 s remaining

  // Coloured glow ring around power-up balls (visible at a glance)
  puGlowRing: {
    position: 'absolute',
    borderWidth: 2.5,
    borderColor: 'transparent',
  },
  puGlowFreeze: {
    borderColor: '#7DF9FF',
    ...Platform.select({
      web: { boxShadow: '0 0 8px 2px rgba(125,249,255,0.7)' },
      default: { shadowColor: '#7DF9FF', shadowOpacity: 0.8, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
    }),
  },
  puGlowBomb: {
    borderColor: '#FF9900',
    ...Platform.select({
      web: { boxShadow: '0 0 8px 2px rgba(255,153,0,0.7)' },
      default: { shadowColor: '#FF9900', shadowOpacity: 0.8, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
    }),
  },
  puGlowTbomb: {
    borderColor: '#FF2222',
    ...Platform.select({
      web: { boxShadow: '0 0 10px 3px rgba(255,34,34,0.8)' },
      default: { shadowColor: '#FF2222', shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
    }),
  },
  puGlowWild: {
    borderColor: '#FFFFFF',
    ...Platform.select({
      web: { boxShadow: '0 0 8px 2px rgba(255,255,255,0.75)' },
      default: { shadowColor: '#FFFFFF', shadowOpacity: 0.9, shadowRadius: 7, shadowOffset: { width: 0, height: 0 } },
    }),
  },
  puGlowLightning: {
    borderColor: '#FFE033',
    ...Platform.select({
      web: { boxShadow: '0 0 8px 2px rgba(255,224,51,0.8)' },
      default: { shadowColor: '#FFE033', shadowOpacity: 0.9, shadowRadius: 7, shadowOffset: { width: 0, height: 0 } },
    }),
  },
  puGlowMultiplier: {
    borderColor: '#FFD700',
    ...Platform.select({
      web: { boxShadow: '0 0 10px 3px rgba(255,215,0,0.85)' },
      default: { shadowColor: '#FFD700', shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
    }),
  },
  puGlowColorbomb: {
    borderColor: '#E040FB',
    ...Platform.select({
      web: { boxShadow: '0 0 10px 3px rgba(224,64,251,0.8)' },
      default: { shadowColor: '#E040FB', shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
    }),
  },

  // Full-screen pulsing red border rendered when a timed bomb is active (Mayhem)
  dangerBorder: {
    borderWidth: 6,
    borderColor: '#FF2020',
    zIndex: 50,
  },

  // Glowing ice border around the board while a freeze power-up is active
  freezeBorder: {
    borderRadius: 6,
    borderWidth: 3,
    borderColor: '#7DF9FF',
    backgroundColor: 'transparent',
    zIndex: 5,
    ...Platform.select({
      web: { boxShadow: '0 0 18px 4px rgba(125,249,255,0.55), inset 0 0 10px 1px rgba(125,249,255,0.15)' },
      default: {},
    }),
  },
  // Corner ❄ snowflakes positioned at board corners
  freezeCorner: {
    position: 'absolute',
    fontSize: 16,
    color: '#7DF9FF',
    zIndex: 6,
    ...Platform.select({
      web: { textShadow: '0 0 8px rgba(125,249,255,0.9)' },
      default: {},
    }),
  },

  // Streak/combo indicator row
  streakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 3,
  },
  streakTxt: {
    color: '#FF9B2E',
    fontSize: 13,
    fontWeight: 'bold',
    letterSpacing: 1.5,
    ...Platform.select({
      web: { textShadow: '0 0 10px rgba(255,155,46,0.7)' },
    }),
  },

  chainPopOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 60,
    pointerEvents: 'none',
  },
  chainPopText: {
    color: '#5FE0FF',
    fontSize: 42,
    fontWeight: 'bold',
    letterSpacing: 2,
    textShadowColor: 'rgba(95,224,255,0.9)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
    ...Platform.select({
      web: { textShadow: '0 0 24px rgba(95,224,255,0.95), 0 0 48px rgba(95,224,255,0.5)' },
    }),
  },

  // Frozen-timer display in header
  freezeLabel: { color: '#7DF9FF' },
  freezeVal:   { color: '#7DF9FF' },
  goScores:     { flexDirection: 'row', alignItems: 'center', marginBottom: 36 },
  goScoreCol:   { alignItems: 'center', minWidth: 80 },
  goScoreLabel: { color: '#666', fontSize: 12, letterSpacing: 1 },
  goScoreVal:   { color: '#FFF', fontSize: 40, fontWeight: 'bold' },
  goScoreSep:   { color: '#333', fontSize: 24, marginHorizontal: 16 },
  newBestLabel: { color: '#FFD700' },
  newBestVal:   { color: '#FFD700' },
  goBtn: {
    backgroundColor: '#1E90FF',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 48,
    marginBottom: 12,
    minWidth: 220,
    alignItems: 'center',
  },
  goBtnSecondary:    { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#333' },
  goBtnTxt:          { color: '#FFF', fontSize: 17, fontWeight: 'bold', letterSpacing: 1 },
  goBtnTxtSecondary: { color: '#666' },

  // Leaderboard name-entry (shown in game-over overlay)
  nameEntryBox: {
    backgroundColor: '#0D0D22',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FFD700',
    padding: 18,
    marginBottom: 20,
    width: '80%',
    maxWidth: 320,
    alignItems: 'center',
  },
  nameEntryTitle: {
    color: '#FFD700',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
    letterSpacing: 1,
  },
  nameEntryHint: {
    color: '#888',
    fontSize: 12,
    marginBottom: 12,
    textAlign: 'center',
  },
  nameEntryInput: {
    width: '100%',
    backgroundColor: '#13132B',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2A2A55',
    color: '#FFF',
    fontSize: 18,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 12,
    textAlign: 'center',
  },
  nameSaveBtn: {
    backgroundColor: '#1E90FF',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 24,
    marginBottom: 10,
    width: '100%',
    alignItems: 'center',
  },
  nameSaveBtnTxt: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: 'bold',
  },
  nameSkipTxt: {
    color: '#333',
    fontSize: 13,
    paddingVertical: 4,
  },
  lbSaveErrorTxt: {
    color: '#FF6B6B',
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },
  lbSavedTxt: {
    color: '#2ED573',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 16,
    letterSpacing: 0.5,
  },

});