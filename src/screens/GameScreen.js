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
  StyleSheet, PanResponder, ScrollView, useWindowDimensions, Platform, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  COLS, ROWS, MAIN_ROW,
  CHAIN_BONUS,
  AI_DELAY, DEFAULT_AI_DIFFICULTY,
  BALL_TYPES_5, BALL_TYPES_6,
  BALL_ADD_INTERVAL, BALL_ADD_COUNT,
  getBoardMetrics,
} from '../constants';

import {
  createInitialBoard,
  createFullBoard,
  cloneBoard,
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
import * as sfx from '../sounds';

// ── Initial state ─────────────────────────────────────────────────────────────

function createInitialState(mode, ballCount = 5) {
  setBallTypes(ballCount === 6 ? BALL_TYPES_6 : BALL_TYPES_5);
  const isSolo = mode === 'solo-time' || mode === 'solo-normal' || mode === 'relax';
  return {
    mode,
    ballCount,
    boards:      mode === 'relax' ? [createFullBoard()]
                : isSolo ? [createInitialBoard()] : [createInitialBoard(), createInitialBoard()],
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
    timeLeft:    mode === 'solo-time' ? 60 : null,
  };
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
  // (catches chain matches formed by newly-spawned balls). Relax mode uses
  // its own resolver — the board is always full, so cleared balls are
  // replaced by a fresh ball dropping in from the top of the column instead
  // of the usual gravity + main-row top-up.
  const { board: settled, cleared, chains, rawScore, sizes } =
    state.mode === 'relax' ? resolveMatchesRelax(slidedBoard) : settleBoard(slidedBoard);
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
    const gain = Math.round(rawGain * multiplier);
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

  // Solo "Endless" mode ends once the board is completely full — stuck
  if (state.mode === 'solo-normal' && isBoardFull(boards[playerIdx])) {
    gameOver = true;
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
      // Relax mode: the board is always full, so a column slide wraps the
      // end ball around to the other side instead of shifting into empty
      // space (same idea as the main row's left/right wrap).
      const slideFns = state.mode === 'relax'
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

    case 'TICK': {
      if (state.paused || state.timeLeft == null) return state;
      const timeLeft = Math.max(0, state.timeLeft - 1);
      return timeLeft === 0
        ? { ...state, timeLeft, gameOver: true }
        : { ...state, timeLeft };
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

// Size of the little balls used in the first-run tutorial's illustrations.
const TUT_BALL = 18;

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
function useBallAnimations(board, cellSize, dragInfo, lastMatch) {
  const animsRef = useRef(new Map()); // id -> { top, left, scaleY, opacity, type, row, col }
  const prevRef  = useRef(null);
  const [ghosts, setGhosts] = useState([]);
  const [popups, setPopups] = useState([]);
  // Tracks the id of the last lastMatch we already spawned a popup for, so a
  // re-render with the same lastMatch (e.g. a resize) doesn't duplicate it.
  const lastPopupIdRef = useRef(null);

  // Full board width — used to slide wrapped main-row balls in from the
  // opposite edge instead of sliding them across the whole board.
  const boardWidth = cellSize * COLS;

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
        // e.g. the initial board fill), fading in as it arrives.
        const startTop = ball.spawnSide === 'bottom'
          ? targetTop + cellSize
          : targetTop - cellSize;
        entry = {
          top: new Animated.Value(startTop),
          left: new Animated.Value(targetLeft),
          scaleY: new Animated.Value(1),
          opacity: new Animated.Value(0),
          type: ball.type,
          row, col,
        };
        animsRef.current.set(ball.id, entry);
        sfx.playSpawn(ball.spawnSide);
        moves.push(Animated.parallel([
          Animated.timing(entry.top,     { toValue: targetTop, duration: FALL_DURATION, easing: SLIDE_EASING, useNativeDriver: false }),
          Animated.timing(entry.opacity, { toValue: 1,         duration: FALL_DURATION, easing: SLIDE_EASING, useNativeDriver: false }),
        ]));
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
          const isWrap = old && row === MAIN_ROW && old.row === MAIN_ROW
            && COLS > 2 && Math.abs(col - old.col) === COLS - 1;

          if (isWrap) {
            const enteringFromRight = col > old.col;
            entry.top.setValue(targetTop);
            entry.left.setValue(enteringFromRight ? boardWidth : -cellSize);
            moves.push(
              Animated.timing(entry.left, { toValue: targetLeft, duration: FALL_DURATION, easing: SLIDE_EASING, useNativeDriver: false })
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

    if (moves.length) Animated.parallel(moves).start();
    // Landing bounces start once the fall/slide tween finishes.
    if (bounces.length) {
      setTimeout(() => bounces.forEach(landingBounce), FALL_DURATION);
    }
  }, [board, cellSize, lastMatch]);

  const elements = [];

  forEachCell(board, (ball, row, col) => {
    const a = animsRef.current.get(ball.id);
    if (!a) return;
    const transform = [{ scaleY: a.scaleY }];
    // Live touch-drag preview: while the player is dragging, offset every
    // ball in the dragged column (vertical drag) or the whole main row
    // (horizontal drag) by the live finger-tracking Animated.Value. Match
    // resolution is untouched — it only runs once the real board state
    // changes on release.
    if (dragInfo && dragInfo.axis === 'col' && col === dragInfo.index) {
      transform.push({ translateY: dragInfo.offset });
    } else if (dragInfo && dragInfo.axis === 'row' && row === MAIN_ROW) {
      transform.push({ translateX: dragInfo.offset });
    }
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
      </Animated.View>
    );
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
  board, label, onColSlide, onRowSlide, onCenterTap, disabled, selectedCol, cellSize, boardPx, tapToMove, lastMatch,
}) => {
  const swipeThreshold = cellSize * 0.45;

  // Always-fresh callbacks/values without stale closure
  const cbRef = useRef({ onColSlide, onRowSlide, onCenterTap, disabled, cellSize, boardPx, swipeThreshold, tapToMove });
  cbRef.current = { onColSlide, onRowSlide, onCenterTap, disabled, cellSize, boardPx, swipeThreshold, tapToMove };

  const gestureStart   = useRef({ col: 0, row: 0, x: 0 });
  const gestureHandled = useRef(false);

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
      },

      // Live-follow: as the finger moves, translate the dragged column (or
      // main row) so it visually tracks the touch. No match resolution or
      // dispatch happens here — that only occurs on release.
      onPanResponderMove: (_, g) => {
        if (cbRef.current.disabled) return;
        const cs = cbRef.current.cellSize;
        const { col, row } = gestureStart.current;
        const absX = Math.abs(g.dx);
        const absY = Math.abs(g.dy);

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

  const ballElements = useBallAnimations(board, cellSize, dragInfo, lastMatch);

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
      </View>
    </View>
  );
});

// ── Main screen ───────────────────────────────────────────────────────────────

export default function GameScreen({ navigation, route }) {
  const mode        = route?.params?.mode ?? 'ai';
  const ballCount   = route?.params?.ballCount ?? 5;
  const aiDifficulty = route?.params?.aiDifficulty ?? DEFAULT_AI_DIFFICULTY;
  const insets = useSafeAreaInsets();
  const isSolo  = mode === 'solo-time' || mode === 'solo-normal' || mode === 'relax';

  // Recompute board sizing whenever the viewport changes (resize/orientation).
  // Solo modes render a single board, so it can use nearly the full width.
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const { cellSize, boardPx } = getBoardMetrics(winWidth, isSolo ? 1 : 2, winHeight);

  // The keyboard-selected-column highlight only makes sense on desktop
  // (where arrow keys drive column selection) — hide it on narrow/mobile
  // viewports where it just shows as a stray blue line.
  const isMobile = winWidth < 768;

  const [state, dispatch] = useReducer(gameReducer, undefined, () =>
    createInitialState(mode, ballCount)
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
  const [dontShowTutorial, setDontShowTutorial] = useState(false);
  const showTutorialRef = useRef(false);
  useEffect(() => {
    AsyncStorage.getItem('tutorialDismissed').then(v => setShowTutorial(v !== 'true'));
  }, []);
  showTutorialRef.current = showTutorial === true;

  const closeTutorial = useCallback(() => {
    if (dontShowTutorial) AsyncStorage.setItem('tutorialDismissed', 'true');
    setShowTutorial(false);
  }, [dontShowTutorial]);

  // ── AI timer ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'ai' || state.gameOver || state.paused || showTutorial) return;
    const delay = AI_DELAY[aiDifficulty] ?? AI_DELAY[DEFAULT_AI_DIFFICULTY];
    const t = setTimeout(() => dispatch({ type: 'AI_MOVE' }), delay);
    return () => clearTimeout(t);
  }, [state.aiTick, state.gameOver, state.paused, mode, aiDifficulty, showTutorial]);

  // ── Solo Time Attack countdown ────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'solo-time' || state.gameOver || state.paused || showTutorial) return;
    const t = setInterval(() => dispatch({ type: 'TICK' }), 1000);
    return () => clearInterval(t);
  }, [mode, state.gameOver, state.paused, showTutorial]);

  // ── Automatic ball-add timer (solo modes) ─────────────────────────────────────
  // Every BALL_ADD_INTERVAL ms, BALL_ADD_COUNT balls drop into random columns.
  // ballAddAnim animates 0→1 over that interval to drive the thin progress
  // line below the header; it restarts whenever the timer fires (ballAddTick)
  // or pause state changes.
  const ballAddAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // Relax mode has no global ball-add timer — balls only enter via the
    // top-of-column refill when a match clears.
    if (!isSolo || mode === 'relax' || state.gameOver || state.paused || showTutorial) return;
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
  // AsyncStorage key, so a Relax high score doesn't overwrite/compete with
  // a Time Attack or Endless one. `bestScore` mirrors the stored value for
  // display in the game-over overlay.
  const [bestScore, setBestScore] = useState(0);

  // Load this mode's current best once on mount.
  useEffect(() => {
    if (!isSolo) return;
    AsyncStorage.getItem(`highScore_${mode}`).then(v => setBestScore(v ? parseInt(v, 10) : 0));
  }, [isSolo, mode]);

  // Relax mode has no game-over state, so the high score is checked as the
  // score updates rather than only once at the end of a run.
  useEffect(() => {
    if (!isSolo) return;
    const score = state.scores[0];
    if (score <= 0) return;
    const key = `highScore_${mode}`;
    AsyncStorage.getItem(key).then(v => {
      const prevBest = v ? parseInt(v, 10) : 0;
      if (score > prevBest) {
        AsyncStorage.setItem(key, String(score));
        setBestScore(score);
      }
    });
  }, [isSolo, mode, state.scores[0]]);

  // ── Keyboard controls (web) ───────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onKey = (e) => {
      const s = stateRef.current;
      if (s.gameOver || showTutorialRef.current) return;

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

  // ── Sound effects: matches, chains, penalties, game over ─────────────────────
  useEffect(() => {
    if (!state.lastMatch) return;
    if (state.lastMatch.chains > 1) {
      sfx.playChain(state.lastMatch.chains);
    } else {
      sfx.playMatch();
    }
    if (!isSolo) sfx.playPenalty();
  }, [state.lastMatch]);

  useEffect(() => {
    if (!state.gameOver) return;
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
  const p2Label = mode === 'ai' ? 'CPU' : 'P2';

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: '#080815' }}>
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
                <Text style={styles.scoreVal}>{scores[0]}</Text>
              </View>

              {mode === 'solo-time' && (
                <View style={styles.scoreBlock}>
                  <Text style={styles.scoreLabel}>TIME</Text>
                  <Text style={[styles.scoreVal, timeLeft <= 10 && styles.timeWarning]}>
                    {formatTime(timeLeft)}
                  </Text>
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
            onPress={() => { sfx.playClick(); dispatch({ type: 'RESET' }); }}
            style={styles.headerBtn}
          >
            <Text style={styles.headerBtnTxt}>↺</Text>
          </TouchableOpacity>
        </View>

        {/* Ball-add timer indicator — thin line that fills up over
            BALL_ADD_INTERVAL ms, then resets when new balls drop in.
            Not shown in Relax mode, which has no such timer. */}
        {isSolo && mode !== 'relax' && (
          <View style={styles.ballAddTrack}>
            <Animated.View
              style={[
                styles.ballAddFill,
                { width: ballAddAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
              ]}
            />
          </View>
        )}

        {/* Boards */}
        {isSolo ? (
          <View style={styles.soloRow}>
            <BoardWithControls
              board={boards[0]}
              label={mode === 'solo-time' ? 'TIME ATTACK' : mode === 'relax' ? 'RELAX' : 'ENDLESS'}
              onColSlide={handleP1ColSlide}
              onRowSlide={handleP1RowSlide}
              onCenterTap={handleP1CenterTap}
              disabled={gameOver || paused || !!showTutorial}
              selectedCol={isMobile ? -1 : selectedCol}
              cellSize={cellSize}
              boardPx={boardPx}
              tapToMove={tapToMove}
              lastMatch={lastMatch}
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
            />
          </View>
        )}

      </ScrollView>

      {/* Pause overlay */}
      {paused && !gameOver && (
        <View style={styles.overlay}>
          <Text style={styles.goTitle}>⏸  PAUSED</Text>

          <TouchableOpacity style={styles.goBtn} onPress={() => { sfx.playClick(); dispatch({ type: 'TOGGLE_PAUSE' }); }}>
            <Text style={styles.goBtnTxt}>▶  Resume</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.goBtn, styles.goBtnSecondary]}
            onPress={() => { sfx.playClick(); navigation.navigate('Menu'); }}
          >
            <Text style={[styles.goBtnTxt, styles.goBtnTxtSecondary]}>Main Menu</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Game over overlay */}
      {gameOver && (
        <View style={styles.overlay}>
          {isSolo ? (
            <>
              <Text style={styles.goTitle}>
                {mode === 'solo-time' ? "⏰  TIME'S UP!" : '🔒  STUCK!'}
              </Text>

              <View style={styles.goScores}>
                <View style={styles.goScoreCol}>
                  <Text style={styles.goScoreLabel}>SCORE</Text>
                  <Text style={styles.goScoreVal}>{scores[0]}</Text>
                </View>
                <Text style={styles.goScoreSep}>—</Text>
                <View style={styles.goScoreCol}>
                  <Text style={styles.goScoreLabel}>BEST</Text>
                  <Text style={styles.goScoreVal}>{bestScore}</Text>
                </View>
              </View>
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

      {/* First-run tutorial — minimal-word, illustration-led */}
      <Modal visible={showTutorial === true} animationType="fade" transparent onRequestClose={closeTutorial}>
        <View style={styles.tutBackdrop}>
          <View style={styles.tutSheet}>
            <Text style={styles.tutTitle}>How to Play</Text>

            <View style={styles.tutGrid}>
              {/* Drag a column up/down */}
              <View style={styles.tutCell}>
                <View style={styles.tutIllusBox}>
                  <Text style={styles.tutArrow}>▲</Text>
                  <View style={styles.tutColStack}>
                    <BallView type="blue" size={TUT_BALL} />
                    <BallView type="green" size={TUT_BALL} />
                    <BallView type="purple" size={TUT_BALL} />
                  </View>
                  <Text style={styles.tutArrow}>▼</Text>
                </View>
                <Text style={styles.tutCaption}>Drag columns</Text>
              </View>

              {/* Swipe the main row left/right */}
              <View style={styles.tutCell}>
                <View style={[styles.tutIllusBox, styles.tutIllusRow]}>
                  <Text style={styles.tutArrow}>◀</Text>
                  <View style={styles.tutRowBar}>
                    <BallView type="amber" size={TUT_BALL} />
                    <BallView type="red" size={TUT_BALL} />
                    <BallView type="blue" size={TUT_BALL} />
                  </View>
                  <Text style={styles.tutArrow}>▶</Text>
                </View>
                <Text style={styles.tutCaption}>Swipe gold row</Text>
              </View>

              {/* Match 3+ same-colour balls */}
              <View style={styles.tutCell}>
                <View style={[styles.tutIllusBox, styles.tutIllusRow]}>
                  <Text style={styles.tutSparkle}>✨</Text>
                  <View style={styles.tutMatchRow}>
                    <BallView type="red" size={TUT_BALL} />
                    <BallView type="red" size={TUT_BALL} />
                    <BallView type="red" size={TUT_BALL} />
                  </View>
                </View>
                <Text style={styles.tutCaption}>Match 3+ to clear</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.tutCheckRow}
              activeOpacity={0.7}
              onPress={() => setDontShowTutorial(d => !d)}
            >
              <View style={[styles.tutCheckbox, dontShowTutorial && styles.tutCheckboxChecked]}>
                {dontShowTutorial && <Text style={styles.tutCheckmark}>✓</Text>}
              </View>
              <Text style={styles.tutCheckLabel}>Don't show this again</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.goBtn} onPress={() => { sfx.playClick(); closeTutorial(); }}>
              <Text style={styles.goBtnTxt}>Got it!</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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

  // Main row — gold frame lines top + bottom
  mainRowBg: {
    backgroundColor: '#160D00',
    borderTopWidth: 2,
    borderBottomWidth: 2,
    borderColor: '#FFCC00',
  },

  // Cells
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 0.5,
    borderColor: '#171730',
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
  goScores:     { flexDirection: 'row', alignItems: 'center', marginBottom: 36 },
  goScoreCol:   { alignItems: 'center', minWidth: 80 },
  goScoreLabel: { color: '#666', fontSize: 12, letterSpacing: 1 },
  goScoreVal:   { color: '#FFF', fontSize: 40, fontWeight: 'bold' },
  goScoreSep:   { color: '#333', fontSize: 24, marginHorizontal: 16 },
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

  // First-run tutorial modal
  tutBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  tutSheet: {
    backgroundColor: '#13132B',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E1E44',
    padding: 24,
    maxWidth: 360,
    width: '100%',
    alignItems: 'center',
  },
  tutTitle: { color: '#FFD700', fontSize: 22, fontWeight: 'bold', letterSpacing: 1, marginBottom: 16 },

  // Illustration grid — cards, each a tiny diagram + 2-4 word caption.
  tutGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    width: '100%',
  },
  tutCell: {
    width: '48%',
    alignItems: 'center',
    marginBottom: 16,
  },
  tutIllusBox: {
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  tutIllusRow: { flexDirection: 'row' },
  tutColStack: {
    flexDirection: 'column',
    alignItems: 'center',
  },
  tutRowBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,215,0,0.15)',
    borderRadius: 6,
    paddingHorizontal: 2,
  },
  tutMatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#FFD700',
    borderRadius: 6,
    paddingHorizontal: 2,
  },
  tutArrow: { color: '#FFD700', fontSize: 16, fontWeight: 'bold' },
  tutSparkle: { fontSize: 16, position: 'absolute', top: -2 },
  tutCaption: { color: '#CCC', fontSize: 13, textAlign: 'center' },

  tutCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: 14,
    marginBottom: 18,
  },
  tutCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#555',
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tutCheckboxChecked: { backgroundColor: '#1E90FF', borderColor: '#1E90FF' },
  tutCheckmark: { color: '#FFF', fontSize: 13, fontWeight: 'bold' },
  tutCheckLabel: { color: '#999', fontSize: 13 },
});
