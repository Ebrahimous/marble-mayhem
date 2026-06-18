/**
 * engine.js v2 — Marble Mayhem (Prototype 2.0)
 *
 * Board coordinate system:
 *   board[row][col]
 *   row 0      = TOP of screen
 *   row ROWS-1 = BOTTOM of screen
 *   MAIN_ROW   = centre row (row 4 of 9) — the only match row
 *
 * Initial setup:
 *   25 random balls fill the 5 middle rows (2–6 for ROWS=9).
 *   Top 2 and bottom 2 rows start empty, giving room to slide.
 *
 * Player moves:
 *   slideColumnUp(board, col)    — shift whole column up one row
 *                                  (blocked if top cell is occupied)
 *   slideColumnDown(board, col)  — shift whole column down one row
 *                                  (blocked if bottom cell is occupied)
 *   slideMainRowLeft(board)      — shift MAIN_ROW one step left (wraps)
 *   slideMainRowRight(board)     — shift MAIN_ROW one step right (wraps)
 *
 * Matching (horizontal only, MAIN_ROW only):
 *   Runs of 3–5 same-colour balls in MAIN_ROW are cleared.
 *   Gravity pulls remaining balls down. Chain reactions loop.
 *
 * Competition:
 *   Each chain-clear sends one penalty ball to the opponent.
 *   Win condition: opponent's board becomes completely full.
 */

import { COLS, ROWS, MAIN_ROW, DEFAULT_BALL_TYPES, MATCH_MIN, SCORE_PER_BALL, MATCH_SIZE_BONUS } from './constants';

// ── Internal helpers ──────────────────────────────────────────────────────────

let _id = 1;
const newId = () => _id++;

// Active colour palette for spawning new balls — set via setBallTypes().
// Defaults to the 5-colour set; MenuScreen's difficulty toggle can switch to
// the 6-colour set before a new game starts.
let activeTypes = DEFAULT_BALL_TYPES;

/** Switch the active ball-colour palette (e.g. BALL_TYPES_5 / BALL_TYPES_6). */
export function setBallTypes(types) {
  activeTypes = types;
}

export function randomType() {
  return activeTypes[Math.floor(Math.random() * activeTypes.length)];
}

export function makeBall(type) {
  return { id: newId(), type: type ?? randomType() };
}

export function createBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

export function cloneBoard(board) {
  return board.map(row => [...row]);
}

/** True when the top cell of a column is occupied (can't slide up). */
export function isColumnTopFull(board, col) {
  return board[0][col] !== null;
}

/** True when the bottom cell of a column is occupied (can't slide down). */
export function isColumnBottomFull(board, col) {
  return board[ROWS - 1][col] !== null;
}

/** True when every cell on the board is occupied. */
export function isBoardFull(board) {
  return board.every(row => row.every(cell => cell !== null));
}

// ── Initial board ─────────────────────────────────────────────────────────────

/**
 * Returns a board with COLS×5 shuffled random balls filling the 5 middle rows.
 * Initial matches in the main row are pre-resolved so the game starts clean.
 */
export function createInitialBoard() {
  const board = createBoard();

  // Build 25 balls and Fisher-Yates shuffle
  const balls = Array.from({ length: COLS * 5 }, () => makeBall());
  for (let i = balls.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [balls[i], balls[j]] = [balls[j], balls[i]];
  }

  // Fill rows MAIN_ROW-2 to MAIN_ROW+2  (rows 2–6 for 9-row board)
  const startRow = MAIN_ROW - 2;
  let k = 0;
  for (let r = startRow; r <= startRow + 4; r++) {
    for (let c = 0; c < COLS; c++) {
      board[r][c] = balls[k++];
    }
  }

  // Pre-resolve accidental matches, top up the main row, and keep settling
  // until the board is stable (handles any new matches created by topping up).
  const { board: settled } = settleBoard(board);
  return settled;
}

/**
 * Returns a board completely filled (every cell, all ROWS×COLS) with random
 * balls — the starting layout for Zen Mode. Any accidental matches in
 * MAIN_ROW are pre-resolved via resolveMatchesRelax() so the game starts
 * clean (and stays completely full, per Zen Mode refill rules).
 */
export function createFullBoard() {
  const board = createBoard();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      board[r][c] = makeBall();
    }
  }
  const { board: settled } = resolveMatchesRelax(board);
  return settled;
}

// ── Column slides ─────────────────────────────────────────────────────────────

/** Shift every ball in `col` up one row. Returns { board, moved }. */
export function slideColumnUp(board, col) {
  if (board[0][col] !== null) return { board, moved: false };
  const next = cloneBoard(board);
  for (let r = 0; r < ROWS - 1; r++) next[r][col] = next[r + 1][col];
  next[ROWS - 1][col] = null;
  return { board: next, moved: true };
}

/** True when the main-row ball in `col` is the column's topmost ball
 *  (nothing occupies the rows above it). */
function isMainRowTopmost(board, col) {
  if (!board[MAIN_ROW][col]) return false;
  for (let r = 0; r < MAIN_ROW; r++) {
    if (board[r][col]) return false;
  }
  return true;
}

/**
 * True when sliding `col` down would actually change the board.
 * False if the bottom cell is occupied (no room to shift into), or if the
 * main-row ball is the column's topmost ball — with nothing above it
 * to take its place, it has nowhere to go.
 */
export function canSlideDown(board, col) {
  if (board[ROWS - 1][col] !== null) return false;
  return !isMainRowTopmost(board, col);
}

/** Shift every ball in `col` down one row. Returns { board, moved }. */
export function slideColumnDown(board, col) {
  if (board[ROWS - 1][col] !== null) return { board, moved: false };

  // If the main-row ball is the topmost ball in this column, it has
  // nothing resting above it to take its place — leave it in the main row
  // instead of pushing it down past it.
  if (isMainRowTopmost(board, col)) return { board, moved: false };

  const next = cloneBoard(board);
  for (let r = ROWS - 1; r > 0; r--) next[r][col] = next[r - 1][col];
  next[0][col] = null;
  return { board: next, moved: true };
}

// ── Column slides (wrap — Zen Mode) ───────────────────────────────────────────
// Zen Mode's board is always completely full, so there's never an empty
// cell to shift into — instead, the ball at one end wraps around to the
// other end, just like the main row's left/right wrap.

/** Shift every ball in `col` up one row; the top ball wraps to the bottom. */
export function slideColumnUpWrap(board, col) {
  const next = cloneBoard(board);
  const first = next[0][col];
  for (let r = 0; r < ROWS - 1; r++) next[r][col] = next[r + 1][col];
  next[ROWS - 1][col] = first;
  return { board: next, moved: true };
}

/** Shift every ball in `col` down one row; the bottom ball wraps to the top. */
export function slideColumnDownWrap(board, col) {
  const next = cloneBoard(board);
  const last = next[ROWS - 1][col];
  for (let r = ROWS - 1; r > 0; r--) next[r][col] = next[r - 1][col];
  next[0][col] = last;
  return { board: next, moved: true };
}

// ── Main-row slides ───────────────────────────────────────────────────────────

/** Shift MAIN_ROW one step left; leftmost ball wraps to the right end. */
export function slideMainRowLeft(board) {
  const next = cloneBoard(board);
  const first = next[MAIN_ROW][0];
  for (let c = 0; c < COLS - 1; c++) next[MAIN_ROW][c] = next[MAIN_ROW][c + 1];
  next[MAIN_ROW][COLS - 1] = first;
  return next;
}

/** Shift MAIN_ROW one step right; rightmost ball wraps to the left end. */
export function slideMainRowRight(board) {
  const next = cloneBoard(board);
  const last = next[MAIN_ROW][COLS - 1];
  for (let c = COLS - 1; c > 0; c--) next[MAIN_ROW][c] = next[MAIN_ROW][c - 1];
  next[MAIN_ROW][0] = last;
  return next;
}

// ── Gravity ───────────────────────────────────────────────────────────────────

/**
 * Pack each column's balls toward the main row from both sides.
 *
 * Upper zone (rows 0..MAIN_ROW):  balls fall DOWN — rest on MAIN_ROW from above.
 * Lower zone (rows MAIN_ROW+1..): balls float UP  — rest on MAIN_ROW from below.
 *
 * Empty space accumulates at the top/bottom extremes, never near the centre.
 */
export function applyGravity(board) {
  const next = cloneBoard(board);
  for (let c = 0; c < COLS; c++) {
    // Upper zone: rows 0..MAIN_ROW — pack to the bottom of this zone (toward MAIN_ROW)
    const up = [];
    for (let r = 0; r <= MAIN_ROW; r++) {
      if (next[r][c]) up.push(next[r][c]);
    }
    for (let r = 0; r <= MAIN_ROW; r++) {
      const i = up.length - (MAIN_ROW + 1 - r);
      next[r][c] = i >= 0 ? up[i] : null;
    }

    // Lower zone: rows MAIN_ROW+1..ROWS-1 — pack to the top of this zone (toward MAIN_ROW)
    const lo = [];
    for (let r = MAIN_ROW + 1; r < ROWS; r++) {
      if (next[r][c]) lo.push(next[r][c]);
    }
    for (let r = MAIN_ROW + 1; r < ROWS; r++) {
      next[r][c] = (r - MAIN_ROW - 1) < lo.length ? lo[r - MAIN_ROW - 1] : null;
    }
  }
  return next;
}

// ── Match resolution ──────────────────────────────────────────────────────────

/**
 * Repeatedly find and clear horizontal runs of MATCH_MIN+ same-colour balls
 * in MAIN_ROW, apply gravity, then loop until no matches remain.
 *
 * Returns { board, cleared, chains, rawScore, sizes }.
 *   cleared  — total balls removed
 *   chains   — number of separate clear rounds (1 = single, 2+ = chain reaction)
 *   rawScore — score earned from match sizes (size * SCORE_PER_BALL +
 *              MATCH_SIZE_BONUS[size]), summed across every match cleared.
 *              Larger matches are worth disproportionately more, since
 *              they're harder to set up than smaller ones.
 *   sizes    — array of each individual match run's size (3/4/5/...), one
 *              entry per match cleared across every round — used to drive
 *              "big match" celebration effects (e.g. 4/5-matches).
 */
export function resolveMatches(board) {
  // Always apply gravity first so balls cluster around MAIN_ROW before matching
  let current = applyGravity(board);
  let totalCleared = 0;
  let chains = 0;
  let rawScore = 0;
  const sizes = [];

  while (true) {
    let roundCleared = 0;
    let roundScore = 0;

    let c = 0;
    while (c < COLS) {
      const cell = current[MAIN_ROW][c];
      if (!cell) { c++; continue; }
      // Cursed balls can never be part of a match — they act as walls.
      if (cell.type === 'cursed') { c++; continue; }

      // Wild balls match any colour — find the effective type from the first
      // non-wild ball in the run, then extend through any cell that is either
      // that type or wild.
      let effectiveType = cell.type === 'wild' ? null : cell.type;
      let end = c + 1;
      while (end < COLS) {
        const next = current[MAIN_ROW][end];
        if (!next) break;
        if (next.type === 'cursed') break; // cursed walls break any run
        if (next.type === 'wild') { end++; continue; }
        if (effectiveType === null) { effectiveType = next.type; end++; continue; }
        if (next.type === effectiveType) { end++; continue; }
        break;
      }

      const size = end - c;
      if (size >= MATCH_MIN) {
        for (let i = c; i < end; i++) current[MAIN_ROW][i] = null;
        roundCleared += size;
        roundScore += size * SCORE_PER_BALL + (MATCH_SIZE_BONUS[size] ?? 0);
        sizes.push(size);
      }
      c = end;
    }

    if (roundCleared === 0) break;

    totalCleared += roundCleared;
    rawScore += roundScore;
    chains++;
    current = applyGravity(current);
  }

  return { board: current, cleared: totalCleared, chains, rawScore, sizes };
}

/**
 * Zen Mode match resolution. The board is always completely full, so
 * there's no gravity step and no "ensure main row full" top-up — instead,
 * whenever a MAIN_ROW run of MATCH_MIN+ same-colour balls is cleared, every
 * column involved drops its above-MAIN_ROW balls down by one and a fresh
 * ball enters at the very top of the column (row 0), keeping the board full.
 * Loops until no matches remain (chain reactions included).
 *
 * Returns { board, cleared, chains, rawScore, sizes } — same shape as
 * resolveMatches().
 */
export function resolveMatchesRelax(board) {
  let current = cloneBoard(board);
  let totalCleared = 0;
  let chains = 0;
  let rawScore = 0;
  const sizes = [];

  while (true) {
    let roundCleared = 0;
    let roundScore = 0;
    const clearedCols = [];

    let c = 0;
    while (c < COLS) {
      const cell = current[MAIN_ROW][c];
      if (!cell) { c++; continue; }
      if (cell.type === 'cursed') { c++; continue; }

      let effectiveType = cell.type === 'wild' ? null : cell.type;
      let end = c + 1;
      while (end < COLS) {
        const next = current[MAIN_ROW][end];
        if (!next) break;
        if (next.type === 'cursed') break;
        if (next.type === 'wild') { end++; continue; }
        if (effectiveType === null) { effectiveType = next.type; end++; continue; }
        if (next.type === effectiveType) { end++; continue; }
        break;
      }

      const size = end - c;
      if (size >= MATCH_MIN) {
        for (let i = c; i < end; i++) {
          current[MAIN_ROW][i] = null;
          clearedCols.push(i);
        }
        roundCleared += size;
        roundScore += size * SCORE_PER_BALL + (MATCH_SIZE_BONUS[size] ?? 0);
        sizes.push(size);
      }
      c = end;
    }

    if (roundCleared === 0) break;

    totalCleared += roundCleared;
    rawScore += roundScore;
    chains++;

    // Drop each cleared column's above-MAIN_ROW balls down by one, then
    // spawn a fresh ball at row 0 (top of the column).
    for (const col of clearedCols) {
      for (let r = MAIN_ROW; r > 0; r--) current[r][col] = current[r - 1][col];
      const ball = makeBall();
      ball.spawnSide = 'top';
      current[0][col] = ball;
    }
  }

  return { board: current, cleared: totalCleared, chains, rawScore, sizes };
}

// ── Main-row guarantee ────────────────────────────────────────────────────────

/** Number of balls currently sitting anywhere in `col`. */
function columnCount(board, col) {
  let n = 0;
  for (let r = 0; r < ROWS; r++) {
    if (board[r][col]) n++;
  }
  return n;
}

/** Columns at or below this many balls get topped up. */
const LOW_COLUMN_COUNT = 3;

/**
 * Pick which end of column `c` a new ball should enter from — 'top',
 * 'bottom', or null if both ends are already occupied. If both ends are
 * open, choose randomly so new balls visibly enter from either side of the
 * board.
 */
function pickSpawnSide(board, c) {
  const topOpen = !board[0][c];
  const botOpen = !board[ROWS - 1][c];
  if (topOpen && botOpen) return Math.random() < 0.5 ? 'top' : 'bottom';
  if (topOpen) return 'top';
  if (botOpen) return 'bottom';
  return null;
}

/**
 * Ensure every cell in MAIN_ROW is occupied, and top up any column that has
 * run low (LOW_COLUMN_COUNT balls or fewer).
 *
 * Each new ball enters from a random open end of its column — either
 * dropping in from the top (row 0) and falling toward MAIN_ROW, or rising in
 * from the bottom (row ROWS-1) and floating up toward MAIN_ROW. The chosen
 * entry side is recorded on the ball as `spawnSide` so the UI can animate it
 * sliding in from that edge. Gravity is re-applied afterwards so every ball
 * settles into its resting place.
 */
export function ensureMainRowFull(board) {
  let next = cloneBoard(board);
  let spawned = false;

  for (let c = 0; c < COLS; c++) {
    const needsMainRow = !next[MAIN_ROW][c];
    const needsTopUp   = columnCount(next, c) <= LOW_COLUMN_COUNT;
    if (!needsMainRow && !needsTopUp) continue;

    const side = pickSpawnSide(next, c);
    if (!side) continue;

    const ball = makeBall();
    ball.spawnSide = side;
    next[side === 'top' ? 0 : ROWS - 1][c] = ball;
    spawned = true;
  }

  return spawned ? applyGravity(next) : next;
}

/**
 * Spawn one new ball in every column, each entering from a random open end
 * (top or bottom) of its column — like ensureMainRowFull(), but unconditional
 * per column. Used by the "tap to move" mid-row centre action to throw a
 * fresh wave of balls onto the board. Columns with no open end are skipped.
 *
 * Returns the resulting (un-settled) board — the caller should run
 * settleBoard() afterwards to resolve any matches the new balls create.
 */
export function spawnBallWave(board) {
  let next = cloneBoard(board);

  for (let c = 0; c < COLS; c++) {
    const side = pickSpawnSide(next, c);
    if (!side) continue;

    const ball = makeBall();
    ball.spawnSide = side;
    next[side === 'top' ? 0 : ROWS - 1][c] = ball;
  }

  return applyGravity(next);
}

/**
 * Drop `count` new balls into random columns, each entering from a random
 * open end (top or bottom) — used by the solo-mode automatic ball-add
 * timer. Columns are chosen at random each time from those that still have
 * an open end, so the same column can receive more than one ball (as long
 * as it has room). If no column has room, spawning stops early.
 *
 * Returns the resulting (un-settled) board — the caller should run
 * settleBoard() afterwards to resolve any matches the new balls create.
 */
export function addRandomBalls(board, count) {
  let next = cloneBoard(board);

  for (let i = 0; i < count; i++) {
    const candidates = [];
    for (let c = 0; c < COLS; c++) {
      if (pickSpawnSide(next, c)) candidates.push(c);
    }
    if (candidates.length === 0) break;

    const c = candidates[Math.floor(Math.random() * candidates.length)];
    const side = pickSpawnSide(next, c);
    const ball = makeBall();
    ball.spawnSide = side;
    next[side === 'top' ? 0 : ROWS - 1][c] = ball;
  }

  return applyGravity(next);
}

// ── Settling ──────────────────────────────────────────────────────────────────

/** Cheap fingerprint of a board's ball identities + positions. */
function boardSnapshot(board) {
  let s = '';
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      s += (board[r][c] ? board[r][c].id : '_') + ',';
    }
  }
  return s;
}

const MAX_SETTLE_ROUNDS = 25;

/**
 * Fully settle a board after a move: repeatedly resolve MAIN_ROW matches +
 * gravity, then top up the main row / low columns with new balls — looping
 * as long as either step changes the board.
 *
 * This catches matches formed by newly-spawned top-up balls landing in
 * MAIN_ROW (which a single resolveMatches() + ensureMainRowFull() pass would
 * miss, leaving an un-cleared match sitting in the main row).
 *
 * Returns { board, cleared, chains, rawScore, sizes } — totals across every round.
 */
export function settleBoard(board) {
  let current = board;
  let totalCleared = 0;
  let totalChains  = 0;
  let totalRawScore = 0;
  const sizes = [];

  for (let round = 0; round < MAX_SETTLE_ROUNDS; round++) {
    const before = boardSnapshot(current);

    const { board: resolved, cleared, chains, rawScore, sizes: roundSizes } = resolveMatches(current);
    totalCleared += cleared;
    totalChains  += chains;
    totalRawScore += rawScore;
    sizes.push(...roundSizes);

    current = ensureMainRowFull(resolved);

    if (boardSnapshot(current) === before) break; // stable — nothing changed
  }

  return { board: current, cleared: totalCleared, chains: totalChains, rawScore: totalRawScore, sizes };
}

// ── Penalty system ────────────────────────────────────────────────────────────

/**
 * Add one random penalty ball to `board`.
 * Prefers to fill the top half (rows 0 to MAIN_ROW-1) first for maximum pressure.
 * Returns { board, gameOver } — gameOver is true when the board was already full.
 */
export function addPenaltyBall(board) {
  if (isBoardFull(board)) return { board, gameOver: true };

  const topEmpty = [];
  const botEmpty = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!board[r][c]) {
        (r < MAIN_ROW ? topEmpty : botEmpty).push([r, c]);
      }
    }
  }

  const choices = topEmpty.length > 0 ? topEmpty : botEmpty;
  const [r, c] = choices[Math.floor(Math.random() * choices.length)];

  const next = cloneBoard(board);
  next[r][c] = makeBall();
  return { board: next, gameOver: false };
}

// ── AI ────────────────────────────────────────────────────────────────────────

function scoreBoard(board) {
  const { cleared, chains } = resolveMatches(board);
  let score = cleared * 20 + (chains > 1 ? chains * 15 : 0);

  // Penalise balls crowding the top rows
  for (let r = 0; r < MAIN_ROW; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c]) score -= (MAIN_ROW - r) * 4;
    }
  }

  // Reward adjacent same-colour pairs in main row (one step from a match)
  const mainRow = board[MAIN_ROW];
  for (let c = 0; c < COLS - 1; c++) {
    if (mainRow[c] && mainRow[c + 1] && mainRow[c].type === mainRow[c + 1].type) {
      score += 6;
    }
  }

  return score;
}

/**
 * Pick the best move for the AI.
 * Returns { type: 'col', col, dir: 'up'|'down' }
 *      or { type: 'row', dir: 'left'|'right' }
 */
export function getAIMove(board) {
  let bestScore = -Infinity;
  let bestMove  = { type: 'row', dir: 'left' };

  const tryMove = (move, result) => {
    const s = scoreBoard(result);
    if (s > bestScore) { bestScore = s; bestMove = move; }
  };

  for (let col = 0; col < COLS; col++) {
    const { board: up,   moved: canUp   } = slideColumnUp(board, col);
    if (canUp)   tryMove({ type: 'col', col, dir: 'up'   }, up);

    const { board: down, moved: canDown } = slideColumnDown(board, col);
    if (canDown) tryMove({ type: 'col', col, dir: 'down' }, down);
  }

  tryMove({ type: 'row', dir: 'left'  }, slideMainRowLeft(board));
  tryMove({ type: 'row', dir: 'right' }, slideMainRowRight(board));

  return bestMove;
}
