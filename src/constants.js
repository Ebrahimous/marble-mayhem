import { Dimensions } from 'react-native';

const { width } = Dimensions.get('window');

// ── Board dimensions ──────────────────────────────────────────────────────────
export const COLS = 5;   // columns per player (matches original)
export const ROWS = 9;   // rows per board

/**
 * Compute board sizing for a given viewport width.
 *
 * `boardCount` is 1 for solo modes (single board gets nearly the full
 * screen width — much bigger cells) or 2 for head-to-head modes (each
 * board takes just under half the screen width, capped at 500px so
 * desktop browsers still render a phone-sized layout).
 *
 * Used reactively (via useWindowDimensions) so the layout adapts immediately
 * when the browser window is resized — handy for testing mobile sizes.
 */
export function getBoardMetrics(windowWidth, boardCount = 2) {
  const w = windowWidth || width;

  if (boardCount === 1) {
    const boardWidth = Math.min(w, 480) - 24;
    const cellSize   = Math.min(76, Math.floor(boardWidth / COLS));
    const boardPx    = cellSize * COLS;
    return { cellSize, boardPx };
  }

  const boardWidth = Math.floor((Math.min(w, 500) - 14) / 2);
  const cellSize   = Math.min(52, Math.floor(boardWidth / COLS));
  const boardPx    = cellSize * COLS;
  return { cellSize, boardPx };
}

// Static fallbacks (computed once at load) for any non-reactive usage
export const { cellSize: CELL_SIZE, boardPx: BOARD_PX } = getBoardMetrics(width);

// ── Ball types & colours ──────────────────────────────────────────────────────
// Flat colour palette (see marbles_template_1.svg). 5-ball mode drops "teal";
// 6-ball mode (Hard difficulty) uses all six.
export const BALL_COLORS = {
  red:    '#E24B4A',
  blue:   '#378ADD',
  green:  '#639922',
  amber:  '#EF9F27',
  purple: '#7F77DD',
  teal:   '#1D9E75',
};

export const BALL_TYPES_5 = ['red', 'blue', 'green', 'amber', 'purple'];
export const BALL_TYPES_6 = [...BALL_TYPES_5, 'teal'];
export const DEFAULT_BALL_TYPES = BALL_TYPES_5;

// ── Match row ────────────────────────────────────────────────────────────────
// Centre row — the only row where horizontal matches are checked.
export const MAIN_ROW = Math.floor(ROWS / 2);   // = 4 for ROWS=9

// ── Scoring ───────────────────────────────────────────────────────────────────
export const SCORE_PER_BALL = 10;
export const CHAIN_BONUS      = 50;   // bonus per extra chain (chains-1) * CHAIN_BONUS
export const MATCH_MIN        = 3;

// ── AI ────────────────────────────────────────────────────────────────────────
// How long (ms) the AI waits before making each move
export const AI_DELAY = {
  easy:   1600,
  normal:  900,
  hard:    350,
};
export const DEFAULT_AI_DIFFICULTY = 'normal';
