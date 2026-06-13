# Handoff — Marble Mayhem

_Last updated: 2026-06-13 (solo-mode focus session)_

## Current state

Single Expo + React Native + react-native-web codebase at this folder, on
"Prototype 2.0" mechanics (25 marbles/player, 5 middle rows, MAIN_ROW
horizontal-match-only, columns slide up/down, main row slides left/right
with wrap, penalty marbles on chain clears in head-to-head modes,
bidirectional gravity centered on MAIN_ROW).

Test with `npm install --legacy-peer-deps` then `npm run web`
(`expo start --web`). Board sizing is reactive via `getBoardMetrics(width)` +
`useWindowDimensions`, so resizing the browser updates layout live.

## What's done

**Mobile-web optimization** (earlier session)
- `src/constants.js`: `getBoardMetrics(windowWidth)` for responsive
  `cellSize`/`boardPx`.
- `App.js`: `useMobileWebSetup()` injects mobile viewport meta tags + touch
  CSS (web-only).
- `app.json`: added `expo.web` block (themeColor, backgroundColor,
  display: standalone).
- `package.json`: added `"web": "expo start --web"` script.
- `src/screens/GameScreen.js`: board sizing prop-drilled into
  `BoardWithControls` (incl. PanResponder gesture math).

**Pause + Single-player mode** (this session — complete)
- `src/screens/GameScreen.js`:
  - New `paused` state + `TOGGLE_PAUSE` action; gates `COL_SLIDE`,
    `ROW_SLIDE`, `AI_MOVE`, `SELECT_COL`, AI timer, and Time Attack timer.
  - Header pause button (⏸/▶), keyboard 'P'/'Escape' toggles pause.
  - New "Paused" full-screen overlay (Resume / Main Menu).
  - New modes `'solo-time'` (60s countdown via `TICK` action,
    `formatTime()` helper, header TIME display turns red at ≤10s) and
    `'solo-normal'` (Endless — ends via `isBoardFull()` from `engine.js`).
  - `createInitialState(mode)` branches for solo (single board/score,
    `timeLeft: 60` for solo-time).
  - `applySlide`: penalty-marble logic now wrapped in
    `if (boards.length > 1)`; added solo-normal stuck check.
  - Header and Boards JSX have `isSolo` branches (single board in new
    `soloRow` style vs. two-board `boardsRow`).
  - Game-over overlay has solo-aware branch ("⏰ TIME'S UP!" / "🔒 STUCK!"
    + single SCORE) vs. existing P1/P2/CPU winner logic.
  - New styles: `soloRow`, `timeWarning`.
- `src/screens/MenuScreen.js`:
  - New green "SOLO" mode button opens a picker modal (Time Attack /
    Endless), navigating to `play('solo-time')` / `play('solo-normal')`.
  - New `modeBtnSolo` style.

Both files verified to parse cleanly (Babel/JSX).

## Session 2026-06-10 (verification only)

No code changes. Verified the codebase matches this handoff:
`GameScreen.js` (794 lines) contains `TOGGLE_PAUSE` / `solo-time` /
`solo-normal` logic; `MenuScreen.js` (256 lines) has the SOLO picker.
File layout: `src/{constants.js, engine.js, screens/{GameScreen.js,
MenuScreen.js}, components/}`.

## Session 2026-06-10 (build verification)

`npx expo export --platform web` succeeds — 377 modules bundle cleanly
(665 kB), no module/syntax errors. Sandbox can't run a live browser, so this
is as far as automated checks go; a real-device/browser playtest is still
needed.

## Session 2026-06-11 (engine fix — column-down / spawn behavior)

Fixed a bug where sliding a column down when its only/topmost marble sat in
MAIN_ROW would push that marble below MAIN_ROW, leaving MAIN_ROW empty;
`ensureMainRowFull` then spawned a replacement directly in place, looking
like a marble appearing out of nowhere.

- `src/engine.js`:
  - New helper `isMainRowTopmost(board, col)` — true if the MAIN_ROW marble
    in `col` has nothing above it.
  - New exported `canSlideDown(board, col)` — false if the column's bottom
    cell is full, or if its MAIN_ROW marble is topmost (nothing to take its
    place). Centralizes the down-button enabled/disabled check.
  - `slideColumnDown` now no-ops (`moved: false`) in the topmost-marble case
    instead of emptying MAIN_ROW.
  - `ensureMainRowFull` now spawns new marbles at row 0 (top of column) and
    re-runs `applyGravity`, so they fall down to MAIN_ROW realistically
    instead of materializing in place.
  - Follow-up: `ensureMainRowFull` also tops up any column with
    `LOW_COLUMN_COUNT` (2) or fewer marbles total — one new marble per call,
    dropped at row 0 and settled by gravity, until the column climbs back
    above the threshold.
- `src/screens/GameScreen.js`: column-down buttons use `canSlideDown` (was
  `!isColumnBottomFull`) for the disabled state; import updated accordingly.

Also (smaller fixes from same session):
- `src/screens/MenuScreen.js`: Solo picker (Time Attack / Endless) buttons now
  call `setSolo(false)` before navigating, so the modal closes immediately on
  selection instead of staying open until Cancel.
- `src/screens/GameScreen.js`: WASD now mirrors arrow keys (A/D select
  column, W/S slide column up/down); `kbHint` text updated.

Verified by direct code review (Read tool) — the project's mount inside the
sandbox shell is currently serving a stale/cached snapshot of these files (a
303-line version of `engine.js`, vs. the real 345-line file), so
`npx expo export`/Babel checks via the sandbox shell are not trustworthy this
session and were skipped. All edited files read back correctly via the file
tools and are syntactically valid JS/JSX. **Manual browser playtest is still
the next real verification step.**

## Session 2026-06-11 (ball redesign + 5/6 difficulty toggle)

Reskinned game pieces from the glossy "marble" look to a flat "ball" look
using `marbles_template_1.svg` (6 flat hex colours), and renamed game-piece
terminology from "marble" to "ball" throughout the codebase. The project
title "Marble Mayhem" and the "Lose Your Marbles" homage subtitle are
unchanged — those refer to the original game's name, not the pieces.

- `src/constants.js`:
  - Replaced `MARBLE_TYPES`/`MARBLE_COLORS` with `BALL_COLORS` (flat hex:
    red `#E24B4A`, blue `#378ADD`, green `#639922`, amber `#EF9F27`, purple
    `#7F77DD`, teal `#1D9E75`), `BALL_TYPES_5` (drops teal), `BALL_TYPES_6`
    (all six), `DEFAULT_BALL_TYPES = BALL_TYPES_5`.
  - Renamed `SCORE_PER_MARBLE` → `SCORE_PER_BALL`.
- `src/engine.js`:
  - New module-level `activeTypes` (defaults to `DEFAULT_BALL_TYPES`) +
    exported `setBallTypes(types)` setter — lets `GameScreen` pick the
    5- or 6-colour palette before building a board.
  - `randomType()` now draws from `activeTypes`.
  - Renamed `makeMarble` → `makeBall`, `addPenaltyMarble` → `addPenaltyBall`.
  - Renamed "marble"/"marbles" → "ball"/"balls" in comments throughout
    (doc header, gravity, matching, column slides, main-row guarantee,
    penalty system, AI scoring).
- `src/components/BallView.js` (new): flat solid-colour circle, no
  border/glow/highlight — uses `BALL_COLORS`.
- `src/components/MarbleView.js`: now a 1-line re-export redirect to
  `BallView` (kept instead of deleted — file deletion isn't reliable in
  this environment; see `check.js` note below).
- `src/screens/MenuScreen.js`:
  - New top-right "BALLS 5/6" toggle (pill switch), persisted via
    `AsyncStorage` key `'ballCount'`. Tapping flips between 5 and 6.
  - `play(mode)` now navigates with `{ mode, ballCount }`.
  - Ball decoration row renders `BALL_TYPES_5`/`BALL_TYPES_6` via
    `BallView` depending on the current toggle state.
  - Help-modal copy: "marble"/"marbles" → "ball"/"balls". Title
    ("MARBLE MAYHEM") and subtitle ("Lose Your Marbles — reimagined")
    left as-is (game-name homage).
  - Style `marbleRow` → `ballRow`; new `difficultyToggle`/`difficultyPill`/
    `difficultyOption*` styles.
- `src/screens/GameScreen.js`:
  - Reads `ballCount = route?.params?.ballCount ?? 5`.
  - `createInitialState(mode, ballCount = 5)` calls
    `setBallTypes(ballCount === 6 ? BALL_TYPES_6 : BALL_TYPES_5)` before
    building boards, and stores `ballCount` in state for `RESET`.
  - `RESET` now calls `createInitialState(state.mode, state.ballCount)`.
  - Renamed `SCORE_PER_MARBLE`→`SCORE_PER_BALL`, `addPenaltyMarble`→
    `addPenaltyBall`, `MarbleView`→`BallView` (import + board-cell usage).

Verified via Read tool (sandbox bash mount is still stale this session —
see prior session's note). No `npm run web` playtest done yet for this
change; recommend testing both the 5- and 6-ball toggle states, and
confirming the toggle persists across app restarts.

Also note: `check.js` (stray debug file from an earlier session) still
can't be deleted (`EPERM`); its contents remain a single harmless comment.

## Session 2026-06-13 (animation polish + AI difficulty + combo mechanic)

Six improvements to ball-movement feel and gameplay depth:

- `src/screens/GameScreen.js`:
  - **Main-row wrap fix**: when a ball moves between col 0 and col
    `COLS-1` in MAIN_ROW (a row-slide wrap), it now slides in from the
    correct off-screen edge (`boardWidth` or `-cellSize`) instead of
    sliding the long way across the board.
  - **Easing + landing bounce**: added `Easing` import, new timing
    constants (`FALL_DURATION`, `CLEAR_DURATION`, `POP_DURATION`,
    `SQUASH_DURATION`, `RECOVER_DURATION`) and `SLIDE_EASING` /
    `SQUASH_EASING` / `RECOVER_EASING`. Falls/slides use
    `Easing.out(Easing.cubic)`; any ball that changes row now plays a
    squash-and-recover (`landingBounce`) via a new per-ball `scaleY`
    Animated.Value, rendered as `transform: [{ scaleY }]`.
  - **Match-highlight pop**: matched balls ("ghosts") now pop
    (scale 1 → 1.3 with a white `ghostGlow` overlay fading in) before
    shrinking/fading out, instead of fading immediately. New `glow`
    Animated.Value + `ghostGlow` style.
  - **Selected-column highlight**: the keyboard-selected column (P1/solo
    board) now renders a translucent blue overlay (`selectedColHighlight`
    style) spanning the full board height.
  - **AI difficulty selector**: `GameScreen` now reads
    `route.params.aiDifficulty` (falls back to `DEFAULT_AI_DIFFICULTY`)
    and uses it to pick the AI move delay from the existing `AI_DELAY`
    map (easy/normal/hard, already defined in `constants.js` but
    previously unreachable).
  - **Combo multiplier**: new `combos` array in state (per-player streak
    count). Each consecutive clearing move increments the streak and adds
    +25% score per step (capped at +100% from combo 5+); a non-clearing
    move resets the streak to 0. Score message shows `×N COMBO` when
    `N > 1`.
- `src/screens/MenuScreen.js`:
  - "VS COMPUTER" button now opens a new AI-difficulty picker modal
    (Easy 🙂 / Normal 😐 / Hard 😈), styled like the existing Solo picker.
    Selecting a difficulty persists it to `AsyncStorage` (`aiDifficulty`)
    and navigates with `{ mode: 'ai', aiDifficulty }`. New `playAI()`
    helper, `sheetSubtitle` and `modeBtnSelected` (gold border on the
    current difficulty) styles.

Verified via Read tool — the sandbox bash mount is still serving a stale
snapshot of these files (confirmed again this session: `wc -l` reports far
fewer lines than the real files), so Babel/`expo export` checks via the
sandbox shell remain untrustworthy and were skipped per the established
practice from the 2026-06-11 sessions. All edits applied cleanly (no Edit
tool mismatches) and every changed region was re-read in full and is
syntactically valid JS/JSX. **Manual browser playtest is still the next
real verification step** — in particular, check the main-row wrap slide
direction in both directions, the landing-bounce on column slides, the
match pop-glow timing, the selected-column highlight on a non-default
column, all three AI difficulties feel distinct, and that combo messages
(`×2 COMBO`, `×3 COMBO`, ...) appear on consecutive clears and reset after
a non-clearing move.

## Session 2026-06-13 (solo-mode focus: hide multiplayer, auto ball-add timer, match-size scoring)

Per user request, **all future work targets solo mode only** for now.
VS Computer / 2-Player are hidden (not deleted) and the SOLO button is
renamed START.

- `src/screens/MenuScreen.js`:
  - New `SHOW_MULTIPLAYER_MODES = false` flag — VS COMPUTER and 2 PLAYERS
    mode buttons (and their handlers) are wrapped in
    `{SHOW_MULTIPLAYER_MODES && (...)}`. Flip to `true` to restore them; the
    AI-difficulty modal and `playAI`/`setShowAI` code are untouched.
  - "SOLO" mode button label renamed to "START" (still opens the existing
    Time Attack / Endless picker — that picker was left as-is).
- `src/constants.js`:
  - New `MATCH_SIZE_BONUS = { 3: 0, 4: 20, 5: 50 }` — flat bonus added on
    top of `size * SCORE_PER_BALL` per match, so 3/4/5-matches score
    30/60/100 (10/15/20 per ball) instead of a flat 10/ball. Reflects that
    longer runs are harder to set up than their ball count alone implies.
  - New `BALL_ADD_INTERVAL = 5000` (ms) and `BALL_ADD_COUNT = 3` for the
    automatic ball-add timer below.
- `src/engine.js`:
  - `resolveMatches` now tracks match size per cleared run and returns
    `rawScore` (sum of `size * SCORE_PER_BALL + MATCH_SIZE_BONUS[size]`
    across all matches that round), alongside the existing `cleared`/
    `chains`. `settleBoard` aggregates `rawScore` across settle rounds and
    returns it too.
  - New `addRandomBalls(board, count)` — drops `count` balls into randomly
    chosen columns (each via the existing `pickSpawnSide` top/bottom entry
    logic used by `spawnBallWave`), then applies gravity. Returns an
    un-settled board (caller runs `settleBoard`).
- `src/screens/GameScreen.js`:
  - `applySlide` now computes `rawGain` from `rawScore` (match-size aware)
    instead of `cleared * SCORE_PER_BALL`; combo multiplier still applies
    on top as before. Removed now-unused `SCORE_PER_BALL` import.
  - New state field `ballAddTick` (starts at 0, incremented by the new
    action below) and new reducer case `AUTO_BALL_ADD`: clones
    `boards[0]`, calls `addRandomBalls(board, BALL_ADD_COUNT)` →
    `settleBoard`, adds any `rawScore` (+ chain bonus) to `scores[0]`
    without touching the combo streak (the player didn't act), sets the
    score-popup `message`, and checks the solo-normal stuck condition.
  - New effect: every `BALL_ADD_INTERVAL` ms (solo modes only, paused by
    `state.paused`/`state.gameOver`), animates `ballAddAnim` (0→1, linear)
    and dispatches `AUTO_BALL_ADD` when it completes; restarts on
    `ballAddTick` changes or pause toggles.
  - New UI: a 2px-tall, semi-transparent (`rgba(255,255,255,0.06)` track /
    `rgba(30,144,255,0.45)` fill) horizontal bar directly below the header,
    solo modes only (`isSolo`), whose width animates with `ballAddAnim` —
    visualizes the 5s countdown to the next automatic ball drop. New
    styles `ballAddTrack`, `ballAddFill`.

Verified via Read tool — all edited regions re-read in full and are
syntactically valid JS/JSX; no Edit-tool mismatches.
**Manual browser playtest is still the next real verification step**, in
particular:
- Menu shows only the START button (no VS COMPUTER / 2 PLAYERS).
- START still opens the Time Attack / Endless picker as before.
- In a solo game, the thin blue line below the header fills up over ~5s,
  then resets as 3 new balls drop into random columns (possibly causing a
  match/chain — watch for the score popup and that it doesn't show a combo
  multiplier).
- Pausing freezes the line and stops new balls from being added; resuming
  restarts the 5s cycle.
- 3-ball matches now score 30, 4-ball matches 60, 5-ball matches 100 (before
  chain bonus / combo multiplier) — confirm via the score popup after each
  match size.

## Session 2026-06-13 (UI polish + live drag preview + tuning)

- `src/screens/MenuScreen.js`:
  - START button content (`modeBtnSolo`) is now centered as a group within
    the button box: added `modeBtnCentered` (`justifyContent: 'center'`) to
    the button, wrapped the label/sub in `modeBtnTextCentered`
    (`alignItems: 'center'`), and added `modeBtnTextCenter`
    (`textAlign: 'center'`) to both `Text` elements.
  - Solo picker's TIME ATTACK button now uses `[styles.modeBtn,
    styles.modeBtnAlt]` (same transparent/bordered style as ENDLESS) instead
    of the solid blue `modeBtn` — both buttons match visually now.
- `src/constants.js`: `BALL_ADD_COUNT` 3 → 2 (automatic ball-add drops 2
  balls per cycle instead of 3).
- `src/screens/GameScreen.js`:
  - New `isMobile` flag (`winWidth < 768`) — the keyboard-selected-column
    highlight (`selectedColHighlight`, the thin blue vertical line) is now
    only 