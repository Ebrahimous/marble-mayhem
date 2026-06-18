/**
 * TutorialModal.js — animated 5-step game tutorial
 * Props: visible, onClose(dontShow), showDismiss
 */

import React, { useRef, useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
  Animated, Easing, Platform,
} from 'react-native';

const CELL = 36;
const GAP  = 3;
const PAD  = 6;
const CS   = CELL + GAP;
const COLS = 5;
const ROWS = 7;
const MR   = 3;
const BOARD_W = PAD * 2 + COLS * CS - GAP;
const BOARD_H = PAD * 2 + ROWS * CS - GAP;

const CLR = {
  R: '#F03333', Y: '#EF9F27', G: '#4CAF28', B: '#378ADD', P: '#9B2FCF',
};

// Power-ups shown in step 4 — one per column of the main row
const PU4 = [
  { icon: '❄',  glow: '#60CFFF' },
  { icon: '💥', glow: '#FF6B35' },
  { icon: '🌈', glow: '#FFFFFF' },
  { icon: '⚡',  glow: '#FFE040' },
  { icon: '×2', glow: '#FF69B4' },
];
const PU4_DESCS = [
  '❄ Freeze — stops the timer for a few seconds.',
  '💥 Bomb — blasts away all marbles in a 3×3 area.',
  '🌈 Wild — matches any color in a run.',
  '⚡ Lightning — clears an entire column instantly.',
  '×2 Multiplier — doubles your score for several matches.',
];

const BOARDS = [
  [['B','G','Y','P','R'],['G','Y','P','B','Y'],['Y','B','G','G','P'],['B','R','G','Y','P'],['P','Y','G','R','B'],['B','P','Y','G','R'],['G','R','B','Y','P']],
  [['B','G','Y','P','R'],['G','Y','P','B','Y'],['Y','B','G','G','P'],['B','R','G','Y','P'],['P','Y','G','R','B'],['B','P','Y','G','R'],['G','R','B','Y','P']],
  [['B','G','Y','P','R'],['G','Y','P','B','Y'],['Y','B','G','G','P'],['B','R','G','Y','P'],['P','Y','G','R','B'],['B','P','Y','G','R'],['G','R','B','Y','P']],
  [['B','G','Y','P','R'],['G','Y','P','B','Y'],['Y','B','G','G','P'],['R','R','R','Y','P'],['P','Y','G','R','B'],['B','P','Y','G','R'],['G','R','B','Y','P']],
  [['B','G','Y','P','R'],['G','Y','P','B','Y'],['Y','B','G','G','P'],['B','R','G','Y','P'],['P','Y','G','R','B'],['B','P','Y','G','R'],['G','R','B','Y','P']],
];

const STEPS = [
  { title: 'The board',           body: 'A 5-column grid of colored marbles. The golden row in the middle is the match row — this is where everything happens.' },
  { title: 'Push a column',       body: 'Swipe up or down on any column to shift all its marbles by one row, moving marbles into or out of the match row.' },
  { title: 'Slide the match row', body: 'Swipe left or right to slide the match row. The marble at the end wraps around to the other side.' },
  { title: 'Match 3 or more!',    body: 'When 3+ same-colored marbles line up in the match row, they clear and you score. Marbles above fall down to fill the gap.' },
  { title: 'Mayhem power-ups',    body: '' },
];

function TBall({ color, puIcon, puGlow, puActive }) {
  if (!color) return <View style={st.emptyBall} />;
  return (
    <View style={{ width: CELL, height: CELL }}>
      <View style={[st.ball, { backgroundColor: CLR[color] || color }]}>
        <View style={st.shine} />
        {puIcon ? (
          <View style={st.puIconWrap} pointerEvents="none">
            <Text style={st.puIconTxt}>{puIcon}</Text>
          </View>
        ) : null}
      </View>
      {puGlow ? (
        <View style={[st.puRing, { borderColor: puGlow, borderWidth: puActive ? 3 : 2 }]}
          pointerEvents="none" />
      ) : null}
    </View>
  );
}

export default function TutorialModal({ visible, onClose, showDismiss = false }) {
  const [step,         setStep]         = useState(0);
  const [board,        setBoard]        = useState(BOARDS[0]);
  const [dontShow,     setDontShow]     = useState(false);
  const [matchVisible, setMatchVisible] = useState(false);
  const [falling,      setFalling]      = useState(false);
  const [puIndex,      setPuIndex]      = useState(0);
  const mounted  = useRef(true);
  const genRef   = useRef(0);
  const pulseRef = useRef(null);
  const puTimer  = useRef(null);

  const hlOp    = useRef(new Animated.Value(0)).current;
  const hlPulse = useRef(new Animated.Value(0)).current;
  const colHlOp = useRef(new Animated.Value(0)).current;
  const handOp  = useRef(new Animated.Value(0)).current;
  const handX   = useRef(new Animated.Value(0)).current;
  const handY   = useRef(new Animated.Value(0)).current;
  const colY    = useRef(new Animated.Value(0)).current;
  const rowX    = useRef(new Animated.Value(0)).current;
  const matchOp = useRef(new Animated.Value(1)).current;
  const matchSc = useRef(new Animated.Value(1)).current;
  const scoreOp = useRef(new Animated.Value(0)).current;
  const scoreY  = useRef(new Animated.Value(0)).current;
  const fallY   = [
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
  ];

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function resetAnims() {
    pulseRef.current?.stop();
    clearInterval(puTimer.current);
    hlOp.setValue(0); hlPulse.setValue(0); colHlOp.setValue(0);
    handOp.setValue(0); handX.setValue(0); handY.setValue(0);
    colY.setValue(0); rowX.setValue(0);
    matchOp.setValue(1); matchSc.setValue(1);
    scoreOp.setValue(0); scoreY.setValue(0);
    fallY[0].setValue(0); fallY[1].setValue(0); fallY[2].setValue(0);
    setMatchVisible(false);
    setFalling(false);
    setPuIndex(0);
  }

  const anim = (a) => new Promise(res => a.start(() => res()));
  const wait = (ms) => new Promise(res => setTimeout(res, ms));

  async function goStep(ns) {
    const gen = ++genRef.current;
    resetAnims();
    ns = Math.max(0, Math.min(STEPS.length - 1, ns));
    setStep(ns);
    setBoard(BOARDS[Math.min(ns, BOARDS.length - 1)]);
    await wait(80);
    if (!mounted.current || genRef.current !== gen) return;

    if (ns === 0) {
      hlOp.setValue(1);
      pulseRef.current = Animated.loop(Animated.sequence([
        Animated.timing(hlPulse, { toValue: 1, duration: 700, useNativeDriver: false }),
        Animated.timing(hlPulse, { toValue: 0, duration: 700, useNativeDriver: false }),
      ]));
      pulseRef.current.start();

    } else if (ns === 1) {
      colHlOp.setValue(1);
      handY.setValue(-30);
      await wait(200);
      if (!mounted.current || genRef.current !== gen) return;
      await anim(Animated.parallel([
        Animated.sequence([
          Animated.timing(handOp, { toValue: 1, duration: 150, useNativeDriver: true }),
          Animated.timing(handY, { toValue: ROWS * CS + 20, duration: 900,
            useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(handOp, { toValue: 0, duration: 200, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.delay(350),
          Animated.timing(colY, { toValue: CS, duration: 350,
            useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        ]),
      ]));
      if (!mounted.current || genRef.current !== gen) return;
      const col2 = BOARDS[1].map(row => row[2]);
      const pushed = [col2[6], ...col2.slice(0, 6)];
      setBoard(BOARDS[1].map((row, r) => row.map((c, ci) => (ci === 2 ? pushed[r] : c))));
      colY.setValue(0);
      colHlOp.setValue(0);

    } else if (ns === 2) {
      hlOp.setValue(1);
      handX.setValue(-20);
      await wait(200);
      if (!mounted.current || genRef.current !== gen) return;
      await anim(Animated.parallel([
        Animated.sequence([
          Animated.timing(handOp, { toValue: 1, duration: 150, useNativeDriver: true }),
          Animated.timing(handX, { toValue: BOARD_W + 20, duration: 800,
            useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(handOp, { toValue: 0, duration: 200, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.delay(250),
          Animated.timing(rowX, { toValue: BOARD_W + CELL, duration: 680,
            useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        ]),
      ]));
      if (!mounted.current || genRef.current !== gen) return;
      const row = BOARDS[2][MR];
      const slid = [row[4], ...row.slice(0, 4)];
      setBoard(BOARDS[2].map((r, ri) => (ri === MR ? slid : r)));
      rowX.setValue(-(BOARD_W + CELL));
      await wait(16);
      if (!mounted.current || genRef.current !== gen) return;
      await anim(Animated.timing(rowX, { toValue: 0, duration: 500,
        useNativeDriver: true, easing: Easing.out(Easing.ease) }));
      if (!mounted.current || genRef.current !== gen) return;
      rowX.setValue(0);

    } else if (ns === 3) {
      hlOp.setValue(1);
      setMatchVisible(true);
      await wait(350);
      if (!mounted.current || genRef.current !== gen) return;
      await anim(Animated.loop(Animated.sequence([
        Animated.timing(matchOp, { toValue: 0.08, duration: 200, useNativeDriver: true }),
        Animated.timing(matchOp, { toValue: 1.0,  duration: 200, useNativeDriver: true }),
      ]), { iterations: 3 }));
      if (!mounted.current || genRef.current !== gen) return;
      await anim(Animated.parallel([
        Animated.timing(matchSc, { toValue: 0, duration: 260, useNativeDriver: true }),
        Animated.timing(matchOp, { toValue: 0, duration: 260, useNativeDriver: true }),
        Animated.sequence([
          Animated.delay(60),
          Animated.timing(scoreOp, { toValue: 1, duration: 180, useNativeDriver: true }),
        ]),
      ]));
      if (!mounted.current || genRef.current !== gen) return;
      setMatchVisible(false);
      setBoard(BOARDS[3].map((row, r) =>
        r === MR ? row.map((c, ci) => (ci < 3 ? null : c)) : row
      ));
      matchSc.setValue(1); matchOp.setValue(0);
      setFalling(true);
      await wait(80);
      if (!mounted.current || genRef.current !== gen) return;
      await anim(Animated.parallel(
        fallY.map(fy => Animated.timing(fy, {
          toValue: CS, duration: 320,
          useNativeDriver: true, easing: Easing.in(Easing.quad),
        }))
      ));
      if (!mounted.current || genRef.current !== gen) return;
      const b = BOARDS[3];
      setBoard(b.map((row, r) => {
        if (r === MR)     return [b[MR-1][0], b[MR-1][1], b[MR-1][2], row[3], row[4]];
        if (r === MR - 1) return [b[MR-2][0], b[MR-2][1], b[MR-2][2], row[3], row[4]];
        if (r === MR - 2) return [b[MR-3][0], b[MR-3][1], b[MR-3][2], row[3], row[4]];
        if (r === MR - 3) return [null, null, null, row[3], row[4]];
        return row;
      }));
      fallY[0].setValue(0); fallY[1].setValue(0); fallY[2].setValue(0);
      setFalling(false);
      await wait(400);
      if (!mounted.current || genRef.current !== gen) return;
      await anim(Animated.parallel([
        Animated.timing(scoreOp, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.timing(scoreY,  { toValue: -20, duration: 300, useNativeDriver: true }),
      ]));

    } else if (ns === 4) {
      const localGen = gen;
      puTimer.current = setInterval(() => {
        if (genRef.current !== localGen || !mounted.current) {
          clearInterval(puTimer.current); return;
        }
        setPuIndex(i => (i + 1) % PU4.length);
      }, 1800);
    }
  }

  useEffect(() => {
    if (visible) {
      genRef.current = 0;
      setStep(0); setDontShow(false); setBoard(BOARDS[0]); resetAnims();
      const t = setTimeout(() => { if (mounted.current) goStep(0); }, 150);
      return () => clearTimeout(t);
    }
  }, [visible]);

  const hlBorderColor = hlPulse.interpolate({
    inputRange: [0, 1], outputRange: ['#FFD700', '#FFFDE7'],
  });

  const isCovered = (r, c) =>
    (step === 1 && c === 2) ||
    (step === 2 && r === MR) ||
    (step === 3 && matchVisible && r === MR && c < 3) ||
    (step === 3 && falling && r === MR - 1 && c < 3);

  return (
    <Modal visible={visible} animationType="fade" transparent
      onRequestClose={() => onClose(dontShow)}>
      <View style={st.backdrop}>
        <View style={st.sheet}>

          {/* X close button */}
          <TouchableOpacity style={st.closeBtn} onPress={() => onClose(dontShow)} activeOpacity={0.7}>
            <Text style={st.closeBtnTxt}>{'×'}</Text>
          </TouchableOpacity>

          <Text style={st.title}>{STEPS[step]?.title}</Text>

          <View style={[st.boardWrap, { width: BOARD_W, height: BOARD_H }]}>

            {/* Static cells */}
            {(step === 4 ? BOARDS[4] : board).map((row, r) => row.map((col, c) => (
              <View key={`${r}-${c}`} style={[st.cellPos, {
                left: PAD + c * CS, top: PAD + r * CS,
                opacity: isCovered(r, c) ? 0 : 1,
              }]}>
                <TBall
                  color={col}
                  puIcon={step === 4 && r === MR ? PU4[c]?.icon : undefined}
                  puGlow={step === 4 && r === MR ? PU4[c]?.glow : undefined}
                  puActive={step === 4 && r === MR && c === puIndex}
                />
              </View>
            )))}

            {/* Main row gold highlight */}
            <Animated.View pointerEvents="none" style={[st.hlRow, {
              top: PAD + MR * CS - 1, opacity: hlOp, borderColor: hlBorderColor,
            }]} />

            {/* Column 2 highlight + overlay */}
            <Animated.View pointerEvents="none" style={[st.hlCol, {
              left: PAD + 2 * CS - 1, opacity: colHlOp,
            }]} />
            {step === 1 && (
              <Animated.View style={[st.colOverlay, {
                left: PAD + 2 * CS, top: PAD, transform: [{ translateY: colY }],
              }]}>
                {BOARDS[1].map((row, r) => (
                  <View key={r} style={{ marginBottom: r < ROWS - 1 ? GAP : 0 }}>
                    <TBall color={row[2]} />
                  </View>
                ))}
              </Animated.View>
            )}

            {/* Row overlay — pure slide, no fade */}
            {step === 2 && (
              <Animated.View style={[st.rowOverlay, {
                left: PAD, top: PAD + MR * CS, transform: [{ translateX: rowX }],
              }]}>
                {BOARDS[2][MR].map((col, c) => (
                  <View key={c} style={{ marginRight: c < COLS - 1 ? GAP : 0 }}>
                    <TBall color={col} />
                  </View>
                ))}
              </Animated.View>
            )}

            {/* Match overlay — 3 reds that flash then shrink */}
            {step === 3 && [0, 1, 2].map(c => (
              <Animated.View key={`m${c}`} style={[st.cellPos, {
                left: PAD + c * CS, top: PAD + MR * CS,
                opacity: matchOp, transform: [{ scale: matchSc }],
              }]}>
                <TBall color="R" />
              </Animated.View>
            ))}

            {/* Falling balls — row MR-1 cols 0-2 animate down by CS */}
            {step === 3 && falling && [0, 1, 2].map(c => (
              <Animated.View key={`f${c}`} style={[st.cellPos, {
                left: PAD + c * CS, top: PAD + (MR - 1) * CS,
                transform: [{ translateY: fallY[c] }],
              }]}>
                <TBall color={BOARDS[3][MR - 1][c]} />
              </Animated.View>
            ))}

            {/* Score popup */}
            <Animated.Text style={[st.scorePop, {
              opacity: scoreOp, transform: [{ translateY: scoreY }],
            }]}>+150</Animated.Text>

            {/* Swipe hand indicator */}
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

          {/* Description — step 4 shows cycling power-up text */}
          <Text style={st.body}>
            {step === 4 ? PU4_DESCS[puIndex] : STEPS[step]?.body}
          </Text>

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
              disabled={step === 0}
              onPress={() => goStep(step - 1)}
            >
              <Text style={st.navBtnTxt}>{'←'} Back</Text>
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

          {showDismiss && (
            <TouchableOpacity style={st.checkRow} onPress={() => setDontShow(d => !d)} activeOpacity={0.7}>
              <View style={[st.checkbox, dontShow && st.checkboxOn]}>
                {dontShow && <Text style={st.checkmark}>{'✓'}</Text>}
              </View>
              <Text style={st.checkLabel}>{"Don't show this again"}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.78)',
    alignItems: 'center', justifyContent: 'center', padding: 16,
  },
  sheet: {
    backgroundColor: '#13132B', borderRadius: 18,
    borderWidth: 1, borderColor: '#1E1E44',
    padding: 20, paddingTop: 38,
    alignItems: 'center', maxWidth: 380, width: '100%',
  },
  closeBtn:    { position: 'absolute', top: 8, right: 12, padding: 8 },
  closeBtnTxt: { color: '#555', fontSize: 24, lineHeight: 26, fontWeight: '300' },
  title: {
    color: '#FFD700', fontSize: 18, fontWeight: 'bold',
    letterSpacing: 1, marginBottom: 14,
  },
  boardWrap: {
    position: 'relative', backgroundColor: '#0D0D22',
    borderRadius: 10, borderWidth: 0.5, borderColor: '#1A1A38',
    overflow: 'hidden', marginBottom: 14,
  },
  cellPos:    { position: 'absolute' },
  colOverlay: { position: 'absolute' },
  rowOverlay: { position: 'absolute', flexDirection: 'row' },
  ball: {
    width: CELL, height: CELL, borderRadius: CELL / 2, overflow: 'hidden',
  },
  emptyBall: {
    width: CELL, height: CELL, borderRadius: CELL / 2,
    backgroundColor: '#0A0A1E', borderWidth: 0.5, borderColor: '#1A1A38',
  },
  shine: {
    position: 'absolute', top: '11%', left: '12%',
    width: '28%', height: '17%', borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.6)',
    transform: [{ rotate: '-35deg' }],
  },
  puRing: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: CELL / 2,
  },
  puIconWrap: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  puIconTxt: { fontSize: 13 },
  hlRow: {
    position: 'absolute', left: 3, right: 3, height: CELL + 2,
    borderWidth: 2.5, borderRadius: CELL,
  },
  hlCol: {
    position: 'absolute', top: 3, bottom: 3, width: CELL + 2,
    borderWidth: 2.5, borderColor: '#4ADE80', borderRadius: CELL,
  },
  swipePill: {
    position: 'absolute', width: 16, height: 26, borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.88)',
    ...Platform.select({ web: { boxShadow: '0 2px 8px rgba(255,255,255,0.35)' } }),
  },
  scorePop: {
    position: 'absolute', top: '40%', left: 0, right: 0,
    textAlign: 'center', color: '#FFD700',
    fontSize: 20, fontWeight: 'bold', letterSpacing: 1,
  },
  body: {
    color: '#999', fontSize: 13, lineHeight: 19,
    textAlign: 'center', marginBottom: 14, paddingHorizontal: 4, minHeight: 40,
  },
  dots:  { flexDirection: 'row', gap: 6, marginBottom: 16 },
  dot:   { width: 7, height: 7, borderRadius: 4, backgroundColor: '#1E1E44' },
  dotOn: { backgroundColor: '#FFD700' },
  nav:   { flexDirection: 'row', gap: 10, width: '100%', marginBottom: 4 },
  navBtn: {
    flex: 1, paddingVertical: 11, borderRadius: 10, alignItems: 'center',
    backgroundColor: '#1A1A38', borderWidth: 1, borderColor: '#252555',
  },
  navBtnPrimary: { backgroundColor: '#2ED573', borderColor: '#2ED573' },
  navBtnDim:     { opacity: 0.3 },
  navBtnTxt:     { color: '#CCC', fontSize: 14 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  checkbox: {
    width: 20, height: 20, borderRadius: 4,
    borderWidth: 1.5, borderColor: '#333', backgroundColor: '#0D0D22',
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: '#1E90FF', borderColor: '#1E90FF' },
  checkmark:  { color: '#FFF', fontSize: 12, fontWeight: 'bold' },
  checkLabel: { color: '#666', fontSize: 13 },
});
