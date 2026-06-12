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
  View, Text, TouchableOpacity, Animated,
  StyleSheet, PanResponder, ScrollView, useWindowDimensions, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  COLS, ROWS, MAIN_ROW,
  SCORE_PER_BALL, CHAIN_BONUS,
  AI_DELAY, DEFAULT_AI_DIFFICULTY,
  BALL_TYPES_5, BALL_TYPES_6,
  getBoardMetrics,
} from '../constants';

import {
  createInitialBoard,
  cloneBoard,
  slideColumnUp,
  slideColumnDown,
  slideMainRowLeft,
  slideMainRowRight,
  isBoardFull,
  settleBoard,
  addPenaltyBall,
  spawnBallWave,
  setBallTypes,
  getAIMove,
} from '../engine';

import BallView from '../components/BallView';
import * as sfx from '../sounds';

// ── Initial state ─────────────────────────────────────────────────────────────

function createInitialState(mode, ballCount = 5) {
  setBallTypes(ballCount === 6 ? BALL_TYPES_6 : BALL_TYPES_5);
  const isSolo = mode === 'solo-time' || mode === 'solo-normal';
  return {
    mode,
    ballCount,
    boards:      isSolo ? [createInitialBoard()] : [createInitialBoard(), createInitialBoard()],
    scores:      isSolo ? [0] : [0, 0],
    gameOver:    false,
    winner:      null,
    message:     '',
    aiTick:      0,
    selectedCol: 0,   // keyboard-selected column on P1's board
    paused:      false,
    timeLeft:    mode === 'solo-time' ? 60 : null,
  };
}

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
  let gameOver   = false;
  let winner     = null;
  let message    = '';

  // Resolve matches, top up the main row, and keep settling until stable
  // (catches chain matches formed by newly-spawned balls).
  const { board: settled, cleared, chains } = settleBoard(slidedBoard);
  boards[playerIdx] = settled;

  if (cleared > 0) {
    const gain = cleared * SCORE_PER_BALL + (chains > 1 ? (chains - 1) * CHAIN_BONUS : 0);
    scores[playerIdx] += gain;
    message = chains > 1 ? `${chains}× CHAIN! +${gain}` : `+${gain}`;

    // One penalty ball per chain-round (head-to-head modes only)
    if (boards.length > 1) {
      const opponent = 1 - playerIdx;
      for (let i = 0; i < chains && !gameOver; i++) {
        const { board: penBoard, gameOver: lost } = addPenaltyBall(boards[opponent]);
        boards[opponent] = penBoard;
        if (lost) { gameOver = true; winner = playerIdx; }
      }
    }
  }

  // Solo "Endless" mode ends once the board is completely full — stuck
  if (state.mode === 'solo-normal' && isBoardFull(boards[playerIdx])) {
    gameOver = true;
  }

  return {
    ...state,
    boards,
    scores,
    gameOver,
    winner,
    message,
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
      const { board, moved } = (dir === 'up' ? slideColumnUp : slideColumnDown)(
        state.boards[player], col
      );
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

const FALL_DURATION  = 220;  // ms — gravity slide into new position
const CLEAR_DURATION = 180;  // ms — matched balls shrinking/fading out

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
function useBallAnimations(board, cellSize) {
  const animsRef = useRef(new Map()); // id -> { top, left, opacity, type, row, col }
  const prevRef  = useRef(null);
  const [ghosts, setGhosts] = useState([]);

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

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = board;

    if (!prev) {
      // First render: place every ball at its resting position, no animation.
      forEachCell(board, (ball, row, col) => {
        animsRef.current.set(ball.id, {
          top: new Animated.Value(row * cellSize),
          left: new Animated.Value(col * cellSize),
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
          opacity: new Animated.Value(0),
          type: ball.type,
          row, col,
        };
        animsRef.current.set(ball.id, entry);
        sfx.playSpawn(ball.spawnSide);
        moves.push(Animated.parallel([
          Animated.timing(entry.top,     { toValue: targetTop, duration: FALL_DURATION, useNativeDriver: false }),
          Animated.timing(entry.opacity, { toValue: 1,         duration: FALL_DURATION, useNativeDriver: false }),
        ]));
      } else {
        entry.type = ball.type;
        entry.row = row;
        entry.col = col;
        if (!old || old.row !== row || old.col !== col) {
          // Existing ball moved (gravity / slide) — slide to its new cell.
          moves.push(Animated.parallel([
            Animated.timing(entry.top,  { toValue: targetTop,  duration: FALL_DURATION, useNativeDriver: false }),
            Animated.timing(entry.left, { toValue: targetLeft, duration: FALL_DURATION, useNativeDriver: false }),
          ]));
        }
      }
    });

    // Balls present before but gone now were matched — shrink/fade them out
    // in place rather than letting them vanish instantly.
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
      });
    });

    if (removed.length) {
      setGhosts(g => [...g, ...removed]);
      removed.forEach((gh) => {
        Animated.parallel([
          Animated.timing(gh.opacity, { toValue: 0,   duration: CLEAR_DURATION, useNativeDriver: false }),
          Animated.timing(gh.scale,   { toValue: 0.25, duration: CLEAR_DURATION, useNativeDriver: false }),
        ]).start(() => {
          setGhosts(g => g.filter(x => x.id !== gh.id));
        });
      });
    }

    if (moves.length) Animated.parallel(moves).start();
  }, [board, cellSize]);

  const elements = [];

  forEachCell(board, (ball) => {
    const a = animsRef.current.get(ball.id);
    if (!a) return;
    elements.push(
      <Animated.View
        key={ball.id}
        style={[
          styles.ballSlot,
          { width: cellSize, height: cellSize, top: a.top, left: a.left, opacity: a.opacity },
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
        <BallView type={gh.type} size={cellSize} />
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
  board, label, onColSlide, onRowSlide, onCenterTap, disabled, selectedCol, cellSize, boardPx, tapToMove,
}) => {
  const swipeThreshold = cellSize * 0.45;

  // Always-fresh callbacks/values without stale closure
  const cbRef = useRef({ onColSlide, onRowSlide, onCenterTap, disabled, cellSize, boardPx, swipeThreshold, tapToMove });
  cbRef.current = { onColSlide, onRowSlide, onCenterTap, disabled, cellSize, boardPx, swipeThreshold, tapToMove };

  const gestureStart   = useRef({ col: 0, row: 0, x: 0 });
  const gestureHandled = useRef(false);

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

      onPanResponderGrant: (e) => {
        const cs = cbRef.current.cellSize;
        const x = e.nativeEvent.locationX ?? 0;
        gestureStart.current = {
          col: Math.min(COLS - 1, Math.max(0, Math.floor(x / cs))),
          row: Math.min(ROWS - 1, Math.max(0, Math.floor((e.nativeEvent.locationY ?? 0) / cs))),
          x,
        };
        gestureHandled.current = false;
      },

      onPanResponderRelease: (_, g) => {
        if (gestureHandled.current || cbRef.current.disabled) return;
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
      },
    })
  ).current;

  const ballElements = useBallAnimations(board, cellSize);

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
  const mode      = route?.params?.mode ?? 'ai';
  const ballCount = route?.params?.ballCount ?? 5;
  const insets = useSafeAreaInsets();
  const isSolo  = mode === 'solo-time' || mode === 'solo-normal';

  // Recompute board sizing whenever the viewport changes (resize/orientation).
  // Solo modes render a single board, so it can use nearly the full width.
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const { cellSize, boardPx } = getBoardMetrics(winWidth, isSolo ? 1 : 2, winHeight);

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

  // ── AI timer ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'ai' || state.gameOver || state.paused) return;
    const delay = AI_DELAY[DEFAULT_AI_DIFFICULTY];
    const t = setTimeout(() => dispatch({ type: 'AI_MOVE' }), delay);
    return () => clearTimeout(t);
  }, [state.aiTick, state.gameOver, state.paused, mode]);

  // ── Solo Time Attack countdown ────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'solo-time' || state.gameOver || state.paused) return;
    const t = setInterval(() => dispatch({ type: 'TICK' }), 1000);
    return () => clearInterval(t);
  }, [mode, state.gameOver, state.paused]);

  // ── Message auto-clear ────────────────────────────────────────────────────────
  const msgTimer = useRef(null);
  useEffect(() => {
    if (!state.message) return;
    clearTimeout(msgTimer.current);
    msgTimer.current = setTimeout(() => dispatch({ type: 'CLEAR_MESSAGE' }), 1600);
    return () => clearTimeout(msgTimer.current);
  }, [state.message]);

  // ── Save high score ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!state.gameOver) return;
    const best = Math.max(...state.scores);
    AsyncStorage.getItem('highScore').then(v => {
      if (best > parseInt(v ?? '0', 10)) AsyncStorage.setItem('highScore', String(best));
    });
  }, [state.gameOver]);

  // ── Keyboard controls (web) ───────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onKey = (e) => {
      const s = stateRef.current;
      if (s.gameOver) return;

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
    if (!state.message) return;
    const isChain = state.message.includes('CHAIN');
    if (isChain) {
      const chains = parseInt(state.message, 10) || 2;
      sfx.playChain(chains);
    } else {
      sfx.playMatch();
    }
    if (!isSolo) sfx.playPenalty();
  }, [state.message]);

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

  const { boards, scores, gameOver, winner, message, selectedCol, paused, timeLeft } = state;
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

        {/* Message */}
        <View style={styles.msgRow}>
          {!!message && <Text style={styles.message}>{message}</Text>}
        </View>

        {/* Boards */}
        {isSolo ? (
          <View style={styles.soloRow}>
            <BoardWithControls
              board={boards[0]}
              label={mode === 'solo-time' ? 'TIME ATTACK' : 'ENDLESS'}
              onColSlide={handleP1ColSlide}
              onRowSlide={handleP1RowSlide}
              onCenterTap={handleP1CenterTap}
              disabled={gameOver || paused}
              selectedCol={selectedCol}
              cellSize={cellSize}
              boardPx={boardPx}
              tapToMove={tapToMove}
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
              disabled={gameOver || paused}
              selectedCol={selectedCol}
              cellSize={cellSize}
              boardPx={boardPx}
              tapToMove={tapToMove}
            />

            <View style={styles.divider} />

            <BoardWithControls
              board={boards[1]}
              label={p2Label}
              onColSlide={handleP2ColSlide}
              onRowSlide={handleP2RowSlide}
              onCenterTap={handleP2CenterTap}
              disabled={gameOver || paused || mode === 'ai'}
              selectedCol={-1}
              cellSize={cellSize}
              boardPx={boardPx}
              tapToMove={tapToMove}
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

  // Message
  msgRow:  { height: 26, justifyContent: 'center' },
  message: { color: '#FFD700', fontSize: 17, fontWeight: 'bold', letterSpacing: 1 },

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
});
