/**
 * TutorialModal.js — animated 5-step game tutorial
 * Used in MenuScreen (How to Play) and GameScreen (first-run).
 *
 * Props:
 *   visible      {boolean}
 *   onClose      {(dontShow: boolean) => void}
 *   showDismiss  {boolean}  show "don't show again" checkbox (pre-game use)
 */

import React, { useRef, useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
  Animated, Easing, Platform,
} from 'react-native';

// ── Board constants ────────────────────────────────────────────────────────────
const CELL = 36;
const GAP  = 3;
const PAD  = 6;
const CS   = CELL + GAP;   // cell step (px per column/row)
const COLS = 5;
const ROWS = 7;
const MR   = 3;            // main row index

const BOARD_W = PAD * 2 + COLS * CS - GAP;
const BOARD_H = PAD * 2 + ROWS * CS - GAP;

// Game-accurate ball colours
const CLR = {
  R: '#E24B4A',
  Y: '#EF9F27',
  G: '#4CAF28',
  B: '#378ADD',
  P: '#9B2FCF',
};

// 7-row × 5-col board states, one per step
const BOARDS = [
  [['B','G','Y','P','R'],['G','Y','P','B','Y'],['Y','B','G','G','P'],['B','R','G','Y','P'],['P','Y','G','R','B'],['B','P','Y','G','R'],['G','R','B','Y','P']],
  [['B','G','Y','P','R'],['G','Y','P','B','Y'],['Y','B','G','G','P'],['B','R','G','Y','P'],['P','Y','G','R','B'],['B','P','Y','G','R'],['G','R','B','Y','P']],
  [['B','G','Y','P','R'],['G','Y','P','B','Y'],['Y','B','G','G','P'],['B','R','G','Y','P'],['P','Y','G','R','B'],['B','P','Y','G','R'],['G','R','B','Y','P']],
  [['B','G','Y','P','R'],['G','Y','P','B','Y'],['Y','B','G','G','P'],['R','R','R','Y','P'],['P','Y','G','R','B'],['B','P','Y','G','R'],['G','R','B','Y','P']],
  [[null,null,null,'P','R'],['B','G','Y','B','Y'],['G','Y','P','G','P'],['Y','Y','B','G','P'],['P','B','G','R','B'],['B','P','Y','G','R'],['G','R','B','Y','P']],
];

const STEPS = [
  {
    title: 'The board',
    body:  'A 5-column grid of colored marbles. The golden row in the middle is the match row — this is where everything happens.',
  },
  {
    title: 'Push a column',
    body:  'Swipe up or down on any column to shift all its marbles by one row. This moves marbles into and out of the match row.',
  },
  {
    title: 'Slide the match row',
    body:  'Swipe left or right on the middle row to slide all its marbles. The marble at the end wraps around. Line up same colors!',
  },
  {
    title: 'Match 3 or more!',
    body:  'When 3 or more same-colored marbles line up in the match row, they clear and you score. Bigger matches earn even more.',
  },
  {
    title: 'Mayhem power-ups',
    body:  'Mayhem spawns special balls: ❄ freezes the timer, 💥 blasts a 3×3 area, ⚡ clears a whole column, ×2 doubles your score, 🪨 blocks a slot until destroyed.',
  },
];

// ── Single marble ─────────────────────────────────────────────────────────────
function TBall({ color }) {
  if (!color) return <View style={st.emptyBall} />;
  return (
    <View style={[st.ball, { backgroundColor: CLR[color] || color }]}>
      <View style={st.shine} />
    </View>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function TutorialModal({ visible, onClose, showDismiss = false }) {
  const [step,     setStep]     = useState(0);
  const [board,    setBoard]    = useState(BOARDS[0]);
  const [dontShow, setDontShow] = useState(false);
  const mounted  = useRef(true);
  const busyRef  = useRef(false);
  const pulseRef = useRef(null);

  // Animated values ─────────────────────────────────────────────────────────
  const hlOp    = useRef(new Animated.Value(0)).current;   // row highlight opacity
  const hlPulse = useRef(new Animated.Value(0)).current;   // row border pulse (0→1)
  const colHlOp = useRef(new Animated.Value(0)).current;   // col highlight opacity
  const handOp  = useRef(new Animated.Value(0)).current;   // swipe indicator opacity
  const handX   = useRef(new Animated.Value(0)).current;   // swipe indicator X offset
  const handY   = useRef(new Animated.Value(0)).current;   // swipe indicator Y offset
  const colY    = useRef(new Animated.Value(0)).current;   // col-2 overlay Y offset
  const rowX    = useRef(new Animated.Value(0)).current;   // row overlay X offset
  const rowOp   = useRef(new Animated.Value(1)).current;   // row overlay opacity
  const matchOp = useRef(new Animated.Value(1)).current;   // match overlay opacity
  const matchSc = useRef(new Animated.Value(1)).current;   // match overlay scale
  const scoreOp = useRef(new Animated.Value(0)).current;   // "+150" opacity
  const scoreY  = useRef(new Animated.Value(0)).current;   // "+150" Y offset

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function resetAnims() {
    pulseRef.current?.stop();
    hlOp.setValue(0);   hlPulse.setValue(0); colHlOp.setValue(0);
    handOp.setValue(0); handX.setValue(0);   handY.setValue(0);
    colY.setValue(0);
    rowX.setValue(0);   rowOp.setValue(1);
    matchOp.setValue(1); matchSc.setValue(1);
    scoreOp.setValue(0); scoreY.setValue(0);
  }

  const anim = (animation) => new Promise(res => animation.start(() => res()));
  const wait = (ms)        => new Promise(res => setTimeout(res, ms));

  async function goStep(ns) {
    if (busyRef.current) return;
    busyRef.current = true;
    resetAnims();
    ns = Math.max(0, Math.min(STEPS.length - 1, ns));
    setStep(ns);
    setBoard(BOARDS[Math.min(ns, BOARDS.length - 1)]);
    await wait(60);
    if (!mounted.current) { busyRef.current = false; return; }

    // ── Step 0: overview — main row pulses ──────────────────────────────────
    if (ns === 0) {
      hlOp.setValue(1);
      pulseRef.current = Animated.loop(Animated.sequence([
        Animated.timing(hlPulse, { toValue: 1, duration: 700, useNativeDriver: false }),
        Animated.timing(hlPulse, { toValue: 0, duration: 700, useNativeDriver: false }),
      ]));
      pulseRef.current.start();
      busyRef.current = false;

    // ── Step 1: push column 2 down ──────────────────────────────────────────
    } else if (ns === 1) {
      colHlOp.setValue(1);
      handY.setValue(-30);
      await wait(200);
      if (!mounted.current) { busyRef.current = false; return; }
      await anim(Animated.parallel([
        // hand sweeps down
        Animated.sequence([
          Animated.timing(handOp, { toValue: 1, duration: 150, useNativeDriver: true }),
          Animated.timing(handY, { toValue: ROWS * CS + 20, duration: 900,
            useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(handOp, { toValue: 0, duration: 200, useNativeDriver: true }),
        ]),
        // column cells follow 350 ms later
        Animated.sequence([
          Animated.delay(350),
          Animated.timing(colY, { toValue: CS, duration: 350,
            useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        ]),
      ]));
      if (!mounted.current) { busyRef.current = false; return; }
      // Commit shifted board: last row of col2 wraps to top
      const col2   = BOARDS[1].map(row => row[2]);
      const pushed = [col2[6], ...col2.slice(0, 6)];
      setBoard(BOARDS[1].map((row, r) => row.map((c, ci) => (ci === 2 ? pushed[r] : c))));
      colY.setValue(0);
      colHlOp.setValue(0);
      busyRef.current = false;

    // ── Step 2: slide main row right ────────────────────────────────────────
    } else if (ns === 2) {
      hlOp.setValue(1);
      handX.setValue(-20);
      await wait(200);
      if (!mounted.current) { busyRef.current = false; return; }
      await anim(Animated.parallel([
        // hand sweeps right
        Animated.sequence([
          Animated.timing(handOp, { toValue: 1, duration: 150, useNativeDriver: true }),
          Animated.timing(handX, { toValue: COLS * CS + 20, duration: 800,
            useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(handOp, { toValue: 0, duration: 200, useNativeDriver: true }),
        ]),
        // row slides out to right
        Animated.sequence([
          Animated.delay(250),
          Animated.parallel([
            Animated.timing(rowX,  { toValue: CS,  duration: 280, useNativeDriver: true }),
            Animated.timing(rowOp, { toValue: 0,   duration: 200, useNativeDriver: true }),
          ]),
        ]),
      ]));
      if (!mounted.current) { busyRef.current = false; return; }
      // Slide-right: last cell wraps to position 0; slide in from left
      const row  = BOARDS[2][MR];
      const slid = [row[4], ...row.slice(0, 4)];
      setBoard(BOARDS[2].map((r, ri) => (ri === MR ? slid : r)));
      rowX.setValue(-CS);
      await anim(Animated.parallel([
        Animated.timing(rowX,  { toValue: 0, duration: 280, useNativeDriver: true }),
        Animated.timing(rowOp, { toValue: 1, duration: 250, useNativeDriver: true }),
      ]));
      if (!mounted.current) { busyRef.current = false; return; }
      rowX.setValue(0); rowOp.setValue(1);
      busyRef.current = false;

    // ── Step 3: match + score ────────────────────────────────────────────────
    } else if (ns === 3) {
      hlOp.setValue(1);
      await wait(300);
      if (!mounted.current) { busyRef.current = false; return; }
      // Flash 3 reds, 3 times
      await anim(Animated.loop(Animated.sequence([
        Animated.timing(matchOp, { toValue: 0.08, duration: 200, useNativeDriver: true }),
        Animated.timing(matchOp, { toValue: 1.0,  duration: 200, useNativeDriver: true }),
      ]), { iterations: 3 }));
      if (!mounted.current) { busyRef.current = false; return; }
      // Shrink away + score pops
      await anim(Animated.parallel([
        Animated.timing(matchSc, { toValue: 0, duration: 280, useNativeDriver: true }),
        Animated.timing(matchOp, { toValue: 0, duration: 280, useNativeDriver: true }),
        Animated.sequence([
          Animated.delay(80),
          Animated.timing(scoreOp, { toValue: 1, duration: 200, useNativeDriver: true }),
        ]),
      ]));
      if (!mounted.current) { busyRef.current = false; return; }
      // Clear the matched cells from board
      setBoard(BOARDS[3].map((row, r) =>
        r === MR ? row.map((c, ci) => (ci < 3 ? null : c)) : row
      ));
      matchSc.setValue(1); matchOp.setValue(0);
      await wait(500);
      await anim(Animated.parallel([
        Animated.timing(scoreOp, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.timing(scoreY,  { toValue: -20, duration: 300, useNativeDriver: true }),
      ]));
      if (!mounted.current) { busyRef.current = false; return; }
      busyRef.current = false;

    // ── Step 4: power-ups — static ──────────────────────────────────────────
    } else {
      busyRef.current = false;
    }
  }

  // Trigger step 0 whenever modal opens
  useEffect(() => {
    if (visible) {
      busyRef.current = false;
      setStep(0);
      setDontShow(false);
      setBoard(BOARDS[0]);
      resetAnims();
      const t = setTimeout(() => { if (mounted.current) goStep(0); }, 150);
      return () => clearTimeout(t);
    }
  }, [visible]);

  // Interpolate row-highlight border colour
  const hlBorderColor = hlPulse.interpolate({
    inputRange:  [0, 1],
    outputRange: ['#FFD700', '#FFFDE7'],
  });

  // Cell visibility: hide cells covered by animated overlays
  const isCovered = (r, c) =>
    (step === 1 && c === 2) ||
    (step === 2 && r === MR) ||
    (step === 3 && r === MR && c < 3 && matchOp.__getValue() > 0);

  return (
    <Modal visible={visible} animationType="fade" transparent
      onRequestClose={() => { if (!busyRef.current) onClose(dontShow); }}>
      <View style={st.backdrop}>
        <View style={st.sheet}>
          <Text style={st.title}>{STEPS[step]?.title}</Text>

          {/* ── Board ────────────────────────────────────────────────────── */}
          <View style={[st.boardWrap, { width: BOARD_W, height: BOARD_H }]}>

            {/* Static cells */}
            {board.map((row, r) => row.map((col, c) => (
              <View
                key={`${r}-${c}`}
                style={[st.cellPos, {
                  left: PAD + c * CS,
                  top:  PAD + r * CS,
                  opacity: isCovered(r, c) ? 0 : 1,
                }]}
              >
                <TBall color={col} />
              </View>
            )))}

            {/* Main row gold highlight */}
            <Animated.View
              pointerEvents="none"
              style={[st.hlRow, {
                top: PAD + MR * CS - 1,
                opacity: hlOp,
                borderColor: hlBorderColor,
              }]}
            />

            {/* Column 2 green highlight */}
            <Animated.View
              pointerEvents="none"
              style={[st.hlCol, {
                left: PAD + 2 * CS - 1,
                opacity: colHlOp,
              }]}
            />

            {/* Column 2 overlay (push animation) */}
            {step === 1 && (
              <Animated.View style={[st.colOverlay, {
                left: PAD + 2 * CS,
                top:  PAD,
                transform: [{ translateY: colY }],
              }]}>
                {BOARDS[1].map((row, r) => (
                  <View key={r} style={{ marginBottom: r < ROWS - 1 ? GAP : 0 }}>
                    <TBall color={row[2]} />
                  </View>
                ))}
              </Animated.View>
            )}

            {/* Main row overlay (slide animation) */}
            {step === 2 && (
              <Animated.View style={[st.rowOverlay, {
                left:      PAD,
                top:       PAD + MR * CS,
                opacity:   rowOp,
                transform: [{ translateX: rowX }],
              }]}>
                {board[MR].map((col, c) => (
                  <View key={c} style={{ marginRight: c < COLS - 1 ? GAP : 0 }}>
                    <TBall color={col} />
                  </View>
                ))}
              </Animated.View>
            )}

            {/* Match overlay — 3 red balls that flash then shrink */}
            {step === 3 && [0, 1, 2].map(c => (
              <Animated.View key={c} style={[st.cellPos, {
                left:      PAD + c * CS,
                top:       PAD + MR * CS,
                opacity:   matchOp,
                transform: [{ scale: matchSc }],
              }]}>
                <TBall color="R" />
              </Animated.View>
            ))}

            {/* "+150" score popup */}
            <Animated.Text style={[st.scorePop, {
              opacity:   scoreOp,
              transform: [{ translateY: scoreY }],
            }]}>
              +150
            </Animated.Text>

            {/* Swipe gesture indicator (white pill) */}
            {(step === 1 || step === 2) && (
              <Animated.View style={[
                st.swipePill,
                step === 1
                  ? { left: PAD + 2 * CS + CELL / 2 - 8, top: PAD,
                      transform: [{ translateY: handY }] }
                  : { left: PAD, top: PAD + MR * CS + CELL / 2 - 12,
                      transform: [{ translateX: handX }] },
                { opacity: handOp },
              ]} />
            )}
          </View>

          {/* Description */}
          <Text style={st.body}>{STEPS[step]?.body}</Text>

          {/* Step dots */}
          <View style={st.dots}>
            {STEPS.map((_, i) => (
              <View key={i} style={[st.dot, i === step && st.dotOn]} />
            ))}
          </View>

          {/* Navigation */}
          <View style={st.nav}>
            <TouchableOpacity
              style={[st.navBtn, step === 0 && st.navBtnDim]}
              disabled={step === 0 || busyRef.current}
              onPress={() => goStep(step - 1)}
            >
              <Text style={st.navBtnTxt}>← Back</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[st.navBtn, st.navBtnPrimary]}
              onPress={() => {
                if (step < STEPS.length - 1) goStep(step + 1);
                else onClose(dontShow);
              }}
            >
              <Text style={[st.navBtnTxt, { color: '#0D1A12', fontWeight: 'bold' }]}>
                {step < STEPS.length - 1 ? 'Next →' : 'Got it!'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* "Don't show again" — only for pre-game use */}
          {showDismiss && (
            <TouchableOpacity style={st.checkRow} onPress={() => setDontShow(d => !d)} activeOpacity={0.7}>
              <View style={[st.checkbox, dontShow && st.checkboxOn]}>
                {dontShow && <Text style={st.checkmark}>✓</Text>}
              </View>
              <Text style={st.checkLabel}>Don't show this again</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  sheet: {
    backgroundColor: '#13132B',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1E1E44',
    padding: 20,
    alignItems: 'center',
    maxWidth: 380,
    width: '100%',
  },
  title: {
    color: '#FFD700',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 14,
  },

  // Board
  boardWrap: {
    position: 'relative',
    backgroundColor: '#0D0D22',
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: '#1A1A38',
    overflow: 'hidden',
    marginBottom: 14,
  },
  cellPos: { position: 'absolute' },
  colOverlay: { position: 'absolute' },
  rowOverlay: { position: 'absolute', flexDirection: 'row' },

  // Individual marble
  ball: {
    width: CELL, height: CELL, borderRadius: CELL / 2,
    overflow: 'hidden',
  },
  emptyBall: {
    width: CELL, height: CELL, borderRadius: CELL / 2,
    backgroundColor: '#0A0A1E',
    borderWidth: 0.5, borderColor: '#1A1A38',
  },
  shine: {
    position: 'absolute',
    top: '11%', left: '12%',
    width: '28%', height: '17%',
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.6)',
    transform: [{ rotate: '-35deg' }],
  },

  // Highlights
  hlRow: {
    position: 'absolute',
    left: 3, right: 3,
    height: CELL + 2,
    borderWidth: 2.5,
    borderRadius: CELL,
    pointerEvents: 'none',
  },
  hlCol: {
    position: 'absolute',
    top: 3, bottom: 3,
    width: CELL + 2,
    borderWidth: 2.5,
    borderColor: '#4ADE80',
    borderRadius: CELL,
    pointerEvents: 'none',
  },

  // Swipe indicator
  swipePill: {
    position: 'absolute',
    width: 16, height: 26,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.88)',
    ...Platform.select({ web: { boxShadow: '0 2px 8px rgba(255,255,255,0.35)' } }),
  },

  // Score popup
  scorePop: {
    position: 'absolute',
    top: '40%', left: 0, right: 0,
    textAlign: 'center',
    color: '#FFD700',
    fontSize: 20,
    fontWeight: 'bold',
    letterSpacing: 1,
  },

  // Description
  body: {
    color: '#999',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 14,
    paddingHorizontal: 4,
  },

  // Step dots
  dots: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  dot:  { width: 7, height: 7, borderRadius: 4, backgroundColor: '#1E1E44' },
  dotOn: { backgroundColor: '#FFD700' },

  // Nav buttons
  nav: { flexDirection: 'row', gap: 10, width: '100%', marginBottom: 4 },
  navBtn: {
    flex: 1, paddingVertical: 11,
    borderRadius: 10, alignItems: 'center',
    backgroundColor: '#1A1A38',
    borderWidth: 1, borderColor: '#252555',
  },
  navBtnPrimary: { backgroundColor: '#2ED573', borderColor: '#2ED573' },
  navBtnDim: { opacity: 0.3 },
  navBtnTxt: { color: '#CCC', fontSize: 14 },

  // Don't-show checkbox
  checkRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 10, marginTop: 10,
  },
  checkbox: {
    width: 20, height: 20, borderRadius: 4,
    borderWidth: 1.5, borderColor: '#333',
    backgroundColor: '#0D0D22',
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: '#1E90FF', borderColor: '#1E90FF' },
  checkmark: { color: '#FFF', fontSize: 12, fontWeight: 'bold' },
  checkLabel: { color: '#666', fontSize: 13 },
});
