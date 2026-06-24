import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, Animated, Easing,
  StyleSheet, Modal, Platform, useWindowDimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BallView from '../components/BallView';
import { CELL_SIZE, BALL_TYPES_5, BALL_TYPES_6, DEFAULT_AI_DIFFICULTY } from '../constants';
import * as sfx from '../sounds';
import * as haptics from '../haptics';
import TutorialModal from '../components/TutorialModal';

// VS COMPUTER and 2 PLAYERS modes are hidden for now — current work is
// focused entirely on solo mode. Flip to true to bring them back.
const SHOW_MULTIPLAYER_MODES = false;

// Solo modes each keep their own high score (AsyncStorage key
// `highScore_<mode>`), so a Zen Mode run doesn't overwrite a Time Attack or
// Challenge best.
const SOLO_MODES = ['solo-time', 'relax', 'mayhem'];

// Background floating ball configuration — each drifts from bottom to top
const BG_BALLS = [
  { left: '8%',  type: 'red',    duration: 7000, delay: 0,    size: 32 },
  { left: '22%', type: 'blue',   duration: 9000, delay: 1400, size: 24 },
  { left: '38%', type: 'green',  duration: 6500, delay: 2800, size: 28 },
  { left: '55%', type: 'amber',  duration: 8200, delay: 700,  size: 20 },
  { left: '72%', type: 'purple', duration: 7800, delay: 3600, size: 36 },
  { left: '88%', type: 'red',    duration: 8800, delay: 1800, size: 22 },
  { left: '15%', type: 'amber',  duration: 6200, delay: 4400, size: 26 },
  { left: '65%', type: 'blue',   duration: 7400, delay: 2100, size: 30 },
  { left: '48%', type: 'purple', duration: 9200, delay: 500,  size: 18 },
];

export default function MenuScreen({ navigation }) {
  const insets    = useSafeAreaInsets();
  const { height: winHeight } = useWindowDimensions();
  const [bestScores, setBestScores] = useState({});
  const [showHelp, setHelp]       = useState(false);
  const [showSolo, setSolo]       = useState(false);
  const [showAI, setShowAI]       = useState(false);
  const [showSettings, setSettings] = useState(false);
  const [ballCount, setBallCount] = useState(5);
  const [tapToMove, setTapToMove] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [hapticsOn, setHapticsOn] = useState(true);
  const [aiDifficulty, setAiDifficulty] = useState(DEFAULT_AI_DIFFICULTY);

  // ── Floating background balls ─────────────────────────────────────────────
  const bgBallAnims = useRef(BG_BALLS.map(() => new Animated.Value(0))).current;
  useEffect(() => {
    const seqs = BG_BALLS.map((ball, i) => {
      bgBallAnims[i].setValue(0);
      const loop = Animated.loop(
        Animated.timing(bgBallAnims[i], {
          toValue: 1,
          duration: ball.duration,
          easing: Easing.linear,
          useNativeDriver: false,
        })
      );
      // Delay fires once, then the loop runs forever
      const seq = Animated.sequence([Animated.delay(ball.delay), loop]);
      seq.start();
      return seq;
    });
    return () => seqs.forEach(s => s.stop());
  }, []);

  // ── Title glow + scale breath ─────────────────────────────────────────────
  const titleGlow  = useRef(new Animated.Value(0)).current;
  const titleScale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const gAnim = Animated.loop(Animated.sequence([
      Animated.timing(titleGlow,  { toValue: 1,    duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      Animated.timing(titleGlow,  { toValue: 0,    duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
    ]));
    const sAnim = Animated.loop(Animated.sequence([
      Animated.timing(titleScale, { toValue: 1.04, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      Animated.timing(titleScale, { toValue: 1.0,  duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
    ]));
    gAnim.start(); sAnim.start();
    return () => { gAnim.stop(); sAnim.stop(); };
  }, []);

  // ── PLAY button: glow pulse + scale + shine sweep ─────────────────────────
  const playPulse = useRef(new Animated.Value(0)).current;
  const playScale = useRef(new Animated.Value(1)).current;
  const playShine = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const glowLoop = Animated.loop(Animated.sequence([
      Animated.timing(playPulse, { toValue: 1, duration: 900, useNativeDriver: false }),
      Animated.timing(playPulse, { toValue: 0, duration: 900, useNativeDriver: false }),
    ]));
    const scaleLoop = Animated.loop(Animated.sequence([
      Animated.timing(playScale, { toValue: 1.03, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      Animated.timing(playScale, { toValue: 1.0,  duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
    ]));
    // Shine sweeps across every ~3 seconds
    const shineLoop = Animated.loop(Animated.sequence([
      Animated.delay(2500),
      Animated.timing(playShine, { toValue: 1, duration: 500, easing: Easing.out(Easing.quad), useNativeDriver: false }),
      Animated.timing(playShine, { toValue: 0, duration: 0, useNativeDriver: false }),
    ]));
    glowLoop.start(); scaleLoop.start(); shineLoop.start();
    return () => { glowLoop.stop(); scaleLoop.stop(); shineLoop.stop(); };
  }, []);

  // ── Ball row staggered bounce ─────────────────────────────────────────────
  const ballBounce = useRef(Array.from({ length: 6 }, () => new Animated.Value(0))).current;
  useEffect(() => {
    const seqs = ballBounce.map((anim, i) => {
      const loop = Animated.loop(Animated.sequence([
        Animated.timing(anim, { toValue: -14, duration: 340, easing: Easing.out(Easing.quad), useNativeDriver: false }),
        Animated.timing(anim, { toValue: 0,   duration: 340, easing: Easing.bounce,           useNativeDriver: false }),
        Animated.delay(620), // pause at bottom before next bounce
      ]));
      // Initial stagger fires once, then loop runs with same period for all
      const seq = Animated.sequence([Animated.delay(i * 190), loop]);
      seq.start();
      return seq;
    });
    return () => seqs.forEach(s => s.stop());
  }, []);

  useEffect(() => {
    AsyncStorage.getItem('ballCount').then(v => v && setBallCount(parseInt(v, 10)));
    AsyncStorage.getItem('tapToMove').then(v => setTapToMove(v === 'true'));
    AsyncStorage.getItem('soundMuted').then(v => setSoundOn(v !== 'true'));
    AsyncStorage.getItem('hapticsEnabled').then(v => setHapticsOn(v !== 'false'));
    AsyncStorage.getItem('aiDifficulty').then(v => v && setAiDifficulty(v));
  }, []);

  // Re-read each solo mode's high score every time the menu regains focus
  // or the ball count changes — keyed per mode+ballCount so 5-ball and 6-ball
  // leaderboards stay separate.
  useFocusEffect(
    useCallback(() => {
      Promise.all(SOLO_MODES.map(m => AsyncStorage.getItem(`highScore_${m}_${ballCount}`))).then(vals => {
        const next = {};
        SOLO_MODES.forEach((m, i) => { next[m] = vals[i] ? parseInt(vals[i], 10) : 0; });
        setBestScores(next);
      });
    }, [ballCount])
  );

  const overallBest = Math.max(0, ...SOLO_MODES.map(m => bestScores[m] ?? 0));

  const toggleBallCount = () => {
    sfx.playClick();
    const next = ballCount === 5 ? 6 : 5;
    setBallCount(next);
    AsyncStorage.setItem('ballCount', String(next));
  };

  const toggleTapToMove = () => {
    sfx.playClick();
    const next = !tapToMove;
    setTapToMove(next);
    AsyncStorage.setItem('tapToMove', String(next));
  };

  const toggleSound = () => {
    const muted = sfx.toggleMuted();
    setSoundOn(!muted);
    sfx.playClick();
  };

  const toggleHaptics = () => {
    sfx.playClick();
    const next = !hapticsOn;
    setHapticsOn(next);
    haptics.setHapticsEnabled(next);
    if (next) haptics.vibrateClick();
  };

  const play = (mode, extra = {}) => { sfx.playClick(); navigation.navigate('Game', { mode, ballCount, ...extra }); };

  const playAI = (difficulty) => {
    setAiDifficulty(difficulty);
    AsyncStorage.setItem('aiDifficulty', difficulty);
    setShowAI(false);
    play('ai', { aiDifficulty: difficulty });
  };

  const activeBallTypes = ballCount === 6 ? BALL_TYPES_6 : BALL_TYPES_5;

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: ballCount === 6 ? '#0F0818' : '#080815' }]}>

      {/* ── Floating background balls ────────────────────────────────────── */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {BG_BALLS.map((ball, i) => (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: ball.left,
              top: 0,
              opacity: 0.14,
              transform: [{
                translateY: bgBallAnims[i].interpolate({
                  inputRange: [0, 1],
                  outputRange: [winHeight + ball.size, -(ball.size + 20)],
                }),
              }],
            }}
          >
            <BallView type={ball.type} size={ball.size} />
          </Animated.View>
        ))}
      </View>

      {/* Settings button */}
      <TouchableOpacity
        style={[styles.settingsBtn, { top: insets.top + 12 }]}
        onPress={() => { sfx.playClick(); setSettings(true); }}
        activeOpacity={0.8}
      >
        <Text style={styles.settingsBtnTxt}>⚙️</Text>
      </TouchableOpacity>

      {/* Difficulty toggle (5 vs 6 ball colours) */}
      <TouchableOpacity
        style={[styles.difficultyToggle, { top: insets.top + 12 }]}
        onPress={toggleBallCount}
        activeOpacity={0.8}
      >
        <Text style={styles.difficultyLabel}>DIFFICULTY</Text>
        <View style={styles.difficultyPill}>
          <View style={[styles.difficultyOption, ballCount === 5 && styles.difficultyOptionActive]}>
            <Text style={[styles.difficultyOptionTxt, ballCount === 5 && styles.difficultyOptionTxtActive]}>EASY</Text>
          </View>
          <View style={[styles.difficultyOption, ballCount === 6 && styles.difficultyOptionActive]}>
            <Text style={[styles.difficultyOptionTxt, ballCount === 6 && styles.difficultyOptionTxtActive]}>HARD</Text>
          </View>
        </View>
      </TouchableOpacity>

      {/* ── Title with glow layer + scale breath ────────────────────────── */}
      <Animated.View style={[styles.titleBlock, { transform: [{ scale: titleScale }] }]}>
        {/* Ambient glow behind title — opacity pulses with titleGlow */}
        <Animated.View
          style={[styles.titleGlowLayer, { opacity: titleGlow.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }) }]}
          pointerEvents="none"
        />
        <Text style={styles.titleTop}>MARBLE</Text>
        <Text style={styles.titleBot}>MAYHEM</Text>
      </Animated.View>

      {/* ── Animated ball decoration row ────────────────────────────────── */}
      <View style={styles.ballRow}>
        {activeBallTypes.map((t, i) => (
          <Animated.View key={t} style={{ transform: [{ translateY: ballBounce[i] }] }}>
            <BallView type={t} size={48} />
          </Animated.View>
        ))}
      </View>

      {/* High score — best across all solo modes */}
      {overallBest > 0 && (
        <View style={styles.highBox}>
          <Text style={styles.highLabel}>BEST SCORE</Text>
          <Text style={styles.highVal}>{overallBest.toLocaleString()}</Text>
        </View>
      )}

      {/* Mode buttons */}
      <View style={styles.btnGroup}>
        <Text style={styles.modeTitle}>SELECT MODE</Text>

        {/* PLAY button with scale pulse + shine sweep */}
        <Animated.View style={[styles.playBtnGlow, {
          transform: [{ scale: playScale }],
          shadowOpacity: playPulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.85] }),
          ...Platform.select({ web: {
            boxShadow: '0 0 24px 8px rgba(46,213,115,0.6)',
          }}),
        }]}>
          <TouchableOpacity
            style={styles.playBtn}
            onPress={() => { sfx.playClick(); setSolo(true); }}
            activeOpacity={0.75}
          >
            <Text style={styles.playBtnText}>▶  PLAY</Text>
            {/* Shine sweep stripe */}
            <Animated.View
              pointerEvents="none"
              style={[styles.playShine, {
                left: playShine.interpolate({ inputRange: [0, 1], outputRange: ['-30%', '120%'] }),
              }]}
            />
          </TouchableOpacity>
        </Animated.View>

        {/* VS COMPUTER and 2 PLAYERS modes are hidden for now — all work is
            focused on solo mode. Re-enable by flipping SHOW_MULTIPLAYER_MODES
            (the matching AI-difficulty modal below remains intact). */}
        {SHOW_MULTIPLAYER_MODES && (
          <>
            <TouchableOpacity
              style={styles.modeBtn}
              onPress={() => { sfx.playClick(); setShowAI(true); }}
              activeOpacity={0.8}
            >
              <Text style={styles.modeBtnIcon}>🤖</Text>
              <View>
                <Text style={styles.modeBtnLabel}>VS COMPUTER</Text>
                <Text style={styles.modeBtnSub}>1 player · compete against AI</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modeBtn, styles.modeBtnAlt]}
              onPress={() => play('pvp')}
              activeOpacity={0.8}
            >
              <Text style={styles.modeBtnIcon}>👥</Text>
              <View>
                <Text style={styles.modeBtnLabel}>2 PLAYERS</Text>
                <Text style={styles.modeBtnSub}>Same device · pass &amp; play</Text>
              </View>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Leaderboard + How to play */}
      <View style={styles.bottomLinks}>
        <TouchableOpacity
          onPress={() => { sfx.playClick(); navigation.navigate('Leaderboard'); }}
          style={styles.lbLink}
          activeOpacity={0.8}
        >
          <Text style={styles.lbLinkTxt}>🏆 Leaderboard</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { sfx.playClick(); setHelp(true); }} style={styles.helpLink}>
          <Text style={styles.helpLinkTxt}>How to Play</Text>
        </TouchableOpacity>
      </View>

      {/* Help modal — animated tutorial */}
      <TutorialModal
        visible={showHelp}
        onClose={() => { sfx.playClick(); setHelp(false); }}
      />

      {/* Settings modal */}
      <Modal visible={showSettings} animationType="slide" transparent onRequestClose={() => setSettings(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
            <Text style={styles.sheetTitle}>Settings</Text>

            <TouchableOpacity
              style={styles.settingRow}
              onPress={toggleSound}
              activeOpacity={0.8}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.settingLabel}>Sound Effects</Text>
                <Text style={styles.settingDesc}>
                  Marble clinks, match chimes, and other sound effects during
                  play.
                </Text>
              </View>
              <View style={styles.togglePill}>
                <View style={[styles.toggleOption, !soundOn && styles.toggleOptionActive]}>
                  <Text style={[styles.toggleOptionTxt, !soundOn && styles.toggleOptionTxtActive]}>OFF</Text>
                </View>
                <View style={[styles.toggleOption, soundOn && styles.toggleOptionActive]}>
                  <Text style={[styles.toggleOptionTxt, soundOn && styles.toggleOptionTxtActive]}>ON</Text>
                </View>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.settingRow}
              onPress={toggleTapToMove}
              activeOpacity={0.8}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.settingLabel}>Tap to Move</Text>
                <Text style={styles.settingDesc}>
                  Tap above the middle row to push that column up, below it to
                  push down, and tap the middle row's left/right side to slide
                  it that way.
                </Text>
              </View>
              <View style={styles.togglePill}>
                <View style={[styles.toggleOption, !tapToMove && styles.toggleOptionActive]}>
                  <Text style={[styles.toggleOptionTxt, !tapToMove && styles.toggleOptionTxtActive]}>OFF</Text>
                </View>
                <View style={[styles.toggleOption, tapToMove && styles.toggleOptionActive]}>
                  <Text style={[styles.toggleOptionTxt, tapToMove && styles.toggleOptionTxtActive]}>ON</Text>
                </View>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.settingRow}
              onPress={toggleHaptics}
              activeOpacity={0.8}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.settingLabel}>Haptic Feedback</Text>
                <Text style={styles.settingDesc}>
                  Vibration on matches, chains, and power-ups. Android only — not supported on iOS.
                </Text>
              </View>
              <View style={styles.togglePill}>
                <View style={[styles.toggleOption, !hapticsOn && styles.toggleOptionActive]}>
                  <Text style={[styles.toggleOptionTxt, !hapticsOn && styles.toggleOptionTxtActive]}>OFF</Text>
                </View>
                <View style={[styles.toggleOption, hapticsOn && styles.toggleOptionActive]}>
                  <Text style={[styles.toggleOptionTxt, hapticsOn && styles.toggleOptionTxtActive]}>ON</Text>
                </View>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.sheetClose} onPress={() => { sfx.playClick(); setSettings(false); }}>
              <Text style={styles.sheetCloseTxt}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Solo mode picker */}
      <Modal visible={showSolo} animationType="slide" transparent onRequestClose={() => setSolo(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
            <Text style={styles.sheetTitle}>Game Mode</Text>

            <TouchableOpacity
              style={[styles.modeBtn, styles.modeBtnAlt, styles.modeBtnMayhem]}
              onPress={() => { setSolo(false); play('mayhem'); }}
              activeOpacity={0.8}
            >
              <Text style={styles.modeBtnIcon}>💣⏱</Text>
              <View>
                <Text style={styles.modeBtnLabel}>TIME BLAST</Text>
                <Text style={styles.modeBtnSub}>1 minute · power-ups · timed bombs</Text>
                {bestScores['mayhem'] > 0 && (
                  <Text style={styles.modeBtnBest}>Best: {bestScores['mayhem'].toLocaleString()}</Text>
                )}
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modeBtn, styles.modeBtnAlt, styles.modeBtnRelax]}
              onPress={() => { setSolo(false); play('relax'); }}
              activeOpacity={0.8}
            >
              <Text style={styles.modeBtnIcon}>🌿</Text>
              <View>
                <Text style={styles.modeBtnLabel}>RELAX</Text>
                <Text style={styles.modeBtnSub}>Full board · no timer · just match</Text>
                {bestScores['relax'] > 0 && (
                  <Text style={styles.modeBtnBest}>Best: {bestScores['relax'].toLocaleString()}</Text>
                )}
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.sheetClose} onPress={() => { sfx.playClick(); setSolo(false); }}>
              <Text style={styles.sheetCloseTxt}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* AI difficulty picker */}
      <Modal visible={showAI} animationType="slide" transparent onRequestClose={() => setShowAI(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
            <Text style={styles.sheetTitle}>VS Computer</Text>
            <Text style={styles.sheetSubtitle}>Choose AI difficulty</Text>

            <TouchableOpacity
              style={[styles.modeBtn, aiDifficulty === 'easy' && styles.modeBtnSelected]}
              onPress={() => playAI('easy')}
              activeOpacity={0.8}
            >
              <Text style={styles.modeBtnIcon}>🙂</Text>
              <View>
                <Text style={styles.modeBtnLabel}>EASY</Text>
                <Text style={styles.modeBtnSub}>CPU reacts slowly</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modeBtn, styles.modeBtnAlt, aiDifficulty === 'normal' && styles.modeBtnSelected]}
              onPress={() => playAI('normal')}
              activeOpacity={0.8}
            >
              <Text style={styles.modeBtnIcon}>😐</Text>
              <View>
                <Text style={styles.modeBtnLabel}>NORMAL</Text>
                <Text style={styles.modeBtnSub}>Balanced challenge</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modeBtn, styles.modeBtnAlt, aiDifficulty === 'hard' && styles.modeBtnSelected]}
              onPress={() => playAI('hard')}
              activeOpacity={0.8}
            >
              <Text style={styles.modeBtnIcon}>😈</Text>
              <View>
                <Text style={styles.modeBtnLabel}>HARD</Text>
                <Text style={styles.modeBtnSub}>CPU reacts fast — tough!</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.sheetClose} onPress={() => { sfx.playClick(); setShowAI(false); }}>
              <Text style={styles.sheetCloseTxt}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}


const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-evenly',
  },

  // ── Title ──────────────────────────────────────────────────────────────────
  titleBlock: { alignItems: 'center', position: 'relative' },
  // Ambient glow layer sits behind the title text and pulses
  titleGlowLayer: {
    position: 'absolute',
    width: 340,
    height: 150,
    top: -24,
    borderRadius: 70,
    backgroundColor: 'transparent',
    ...Platform.select({
      web: {
        boxShadow: '0 0 70px 30px rgba(30,144,255,0.35), 0 30px 70px 20px rgba(255,71,87,0.3)',
        filter: 'blur(14px)',
      },
    }),
  },
  titleTop: {
    color: '#1E90FF',
    fontSize: 52,
    fontWeight: 'bold',
    letterSpacing: 8,
    lineHeight: 58,
    ...Platform.select({
      web: { textShadow: '0 0 18px rgba(30,144,255,0.75), 0 0 36px rgba(30,144,255,0.35)' },
    }),
  },
  titleBot: {
    color: '#FF4757',
    fontSize: 52,
    fontWeight: 'bold',
    letterSpacing: 8,
    lineHeight: 58,
    ...Platform.select({
      web: { textShadow: '0 0 18px rgba(255,71,87,0.75), 0 0 36px rgba(255,71,87,0.35)' },
    }),
  },
  subtitle: { color: '#444', fontSize: 12, letterSpacing: 2, marginTop: 6 },

  // ── Ball row ───────────────────────────────────────────────────────────────
  // Fixed height + bottom-align so bounce doesn't cause layout shift
  ballRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end', height: 64 },

  // ── Corner controls ────────────────────────────────────────────────────────
  settingsBtn: {
    position: 'absolute',
    left: 16,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#12122A',
    borderWidth: 1.5,
    borderColor: '#252545',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsBtnTxt: { fontSize: 16 },

  difficultyToggle: {
    position: 'absolute',
    right: 16,
    alignItems: 'center',
    zIndex: 10,
  },
  difficultyLabel: { color: '#444', fontSize: 9, letterSpacing: 2, marginBottom: 4 },
  difficultyPill: {
    flexDirection: 'row',
    backgroundColor: '#12122A',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#252545',
    overflow: 'hidden',
  },
  difficultyOption: { paddingVertical: 6, paddingHorizontal: 14 },
  difficultyOptionActive: { backgroundColor: '#1E90FF' },
  difficultyOptionTxt: { color: '#666', fontSize: 14, fontWeight: 'bold' },
  difficultyOptionTxtActive: { color: '#FFF' },

  // ── High score ─────────────────────────────────────────────────────────────
  highBox:   { alignItems: 'center' },
  highLabel: { color: '#444', fontSize: 10, letterSpacing: 2 },
  highVal:   {
    color: '#FFD700',
    fontSize: 34,
    fontWeight: 'bold',
    ...Platform.select({
      web: { textShadow: '0 0 14px rgba(255,215,0,0.6)' },
    }),
  },

  // ── Mode buttons ───────────────────────────────────────────────────────────
  btnGroup:  { alignItems: 'center', width: '88%' },
  modeTitle: { color: '#333', fontSize: 11, letterSpacing: 2, marginBottom: 12 },

  // PLAY button wrapper (carries shadow + scale transform)
  playBtnGlow: {
    width: '100%',
    borderRadius: 18,
    marginBottom: 16,
    shadowColor: '#2ED573',
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 18,
    elevation: 10,
    ...Platform.select({ web: { boxShadow: '0 0 28px 10px rgba(46,213,115,0.6)' } }),
  },
  playBtn: {
    backgroundColor: '#2ED573',
    borderRadius: 18,
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    overflow: 'hidden',
  },
  playBtnText: {
    color: '#0D1A12',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 6,
    ...Platform.select({ web: { textShadow: '0 1px 0 rgba(255,255,255,0.2)' } }),
  },
  // Diagonal shine stripe that sweeps across the PLAY button
  playShine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 55,
    backgroundColor: 'rgba(255,255,255,0.28)',
    transform: [{ skewX: '-20deg' }],
  },

  modeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E90FF',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 24,
    width: '100%',
    marginBottom: 12,
    gap: 16,
    shadowColor: '#1E90FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  modeBtnAlt: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: '#252545',
    shadowOpacity: 0,
    elevation: 0,
  },
  modeBtnSolo: {
    backgroundColor: '#2ED573',
    shadowColor: '#2ED573',
  },
  modeBtnSelected: { borderWidth: 2, borderColor: '#FFD700' },
  modeBtnMayhem:   { borderColor: '#FF6B35', borderWidth: 2, backgroundColor: '#1E0904' },
  modeBtnRelax:    { borderColor: '#2ED573', borderWidth: 2, backgroundColor: '#041A10' },
  modeBtnIcon:     { fontSize: 28 },
  modeBtnLabel:    { color: '#FFF', fontSize: 16, fontWeight: 'bold', letterSpacing: 1 },
  modeBtnSub:      { color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 2 },
  modeBtnBest:     { color: '#FFD700', fontSize: 11, fontWeight: 'bold', marginTop: 2 },
  modeBtnCentered:     { justifyContent: 'center' },
  modeBtnTextCentered: { alignItems: 'center' },
  modeBtnTextCenter:   { textAlign: 'center' },

  // ── Bottom links ───────────────────────────────────────────────────────────
  bottomLinks: { alignItems: 'center', gap: 2 },
  lbLink:      { paddingVertical: 8, paddingHorizontal: 16 },
  lbLinkTxt:   { color: '#FFD700', fontSize: 15, fontWeight: 'bold', letterSpacing: 0.5 },
  helpLink:    { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: '#2A2A50' },
  helpLinkTxt: { color: '#AAA', fontSize: 14 },

  // ── Modals ─────────────────────────────────────────────────────────────────
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#12122A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingHorizontal: 20,
    maxHeight: '80%',
  },
  sheetTitle:    { color: '#FFF', fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 20 },
  sheetSubtitle: { color: '#666', fontSize: 12, textAlign: 'center', marginTop: -12, marginBottom: 16, letterSpacing: 1 },
  sheetClose: {
    marginTop: 16,
    backgroundColor: '#1E90FF',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  sheetCloseTxt: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },

  helpRow:   { flexDirection: 'row', marginBottom: 18, alignItems: 'flex-start' },
  helpIcon:  { fontSize: 22, marginRight: 14, marginTop: 2 },
  helpTitle: { color: '#CCC', fontSize: 14, fontWeight: 'bold', marginBottom: 4 },
  helpBody:  { color: '#777', fontSize: 13, lineHeight: 19 },

  // Settings
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  settingLabel: { color: '#CCC', fontSize: 14, fontWeight: 'bold', marginBottom: 4 },
  settingDesc:  { color: '#777', fontSize: 13, lineHeight: 19 },
  togglePill: {
    flexDirection: 'row',
    backgroundColor: '#0D0D22',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#252545',
    overflow: 'hidden',
  },
  toggleOption:           { paddingVertical: 6, paddingHorizontal: 14 },
  toggleOptionActive:     { backgroundColor: '#1E90FF' },
  toggleOptionTxt:        { color: '#666', fontSize: 12, fontWeight: 'bold' },
  toggleOptionTxtActive:  { color: '#FFF' },
});
