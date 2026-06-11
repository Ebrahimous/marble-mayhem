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

import { COLS, ROWS, MAIN_ROW, DEFAULT_BALL_TYPES, MATCH_MIN } from './constants';

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

  // Pre-resolve accidental matches, then guarantee main row is full
  const { board: clean } = resolveMatches(board);
  return ensureMainRowFull(clean);
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
 * Returns { board, cleared, chains }.
 *   cleared — total balls removed
 *   chains  — number of separate clear rounds (1 = single, 2+ = chain reaction)
 */
export function resolveMatches(board) {
  // Always apply gravity first so balls cluster around MAIN_ROW before matching
  let current = applyGravity(board);
  let totalCleared = 0;
  let chains = 0;

  while (true) {
    let roundCleared = 0;

    let c = 0;
    while (c < COLS) {
      const cell = current[MAIN_ROW][c];
      if (!cell) { c++; continue; }

      let end = c + 1;
      while (end < COLS && current[MAIN_ROW][end]?.type === cell.type) end++;

      if (end - c >= MATCH_MIN) {
        for (let i = c; i < end; i++) current[MAIN_ROW][i] = null;
        roundCleared += end - c;
      }
      c = end;
    }

    if (roundCleared === 0) break;

    totalCleared += roundCleared;
    chains++;
    current = applyGravity(current);
  }

  return { board: current, cleared: totalCleared, chains };
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
 * Ensure every cell in MAIN_ROW is occupied, and top up any column that has
 * run low (LOW_COLUMN_COUNT balls or fewer).
 *
 * New balls are dropped in from the top of the column (row 0) and gravity
 * is re-applied so they fall down to their resting place — toward MAIN_ROW
 * if it's empty, or settling lower in the column otherwise — rather than
 * materialising directly in the slot they end up filling.
 */
export function ensureMainRowFull(board) {
  let next = cloneBoard(board);
  let spawned = false;

  for (let c = 0; c < COLS; c++) {
    const needsMainRow = !next[MAIN_ROW][c];
    const needsTopUp   = columnCount(next, c) <= LOW_COLUMN_COUNT;

    if ((needsMainRow || needsTopUp) && !next[0][c]) {
      next[0][c] = makeBall();
      spawned = true;
    }
  }

  return spawned ? applyGravity(next) : next;
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
