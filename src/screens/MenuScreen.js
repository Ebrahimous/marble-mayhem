import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity,
  StyleSheet, Modal, ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BallView from '../components/BallView';
import { CELL_SIZE, BALL_TYPES_5, BALL_TYPES_6, DEFAULT_AI_DIFFICULTY } from '../constants';
import * as sfx from '../sounds';

// VS COMPUTER and 2 PLAYERS modes are hidden for now — current work is
// focused entirely on solo mode. Flip to true to bring them back.
const SHOW_MULTIPLAYER_MODES = false;

// Solo modes each keep their own high score (AsyncStorage key
// `highScore_<mode>`), so a Zen Mode run doesn't overwrite a Time Attack or
// Challenge best.
const SOLO_MODES = ['solo-time', 'solo-normal', 'relax'];

export default function MenuScreen({ navigation }) {
  const insets    = useSafeAreaInsets();
  const [bestScores, setBestScores] = useState({});
  const [showHelp, setHelp]       = useState(false);
  const [showSolo, setSolo]       = useState(false);
  const [showAI, setShowAI]       = useState(false);
  const [showSettings, setSettings] = useState(false);
  const [ballCount, setBallCount] = useState(5);
  const [tapToMove, setTapToMove] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [aiDifficulty, setAiDifficulty] = useState(DEFAULT_AI_DIFFICULTY);

  useEffect(() => {
    AsyncStorage.getItem('ballCount').then(v => v && setBallCount(parseInt(v, 10)));
    AsyncStorage.getItem('tapToMove').then(v => setTapToMove(v === 'true'));
    AsyncStorage.getItem('soundMuted').then(v => setSoundOn(v !== 'true'));
    AsyncStorage.getItem('aiDifficulty').then(v => v && setAiDifficulty(v));
  }, []);

  // Re-read each solo mode's high score every time the menu regains focus
  // (e.g. coming back from a game that just set a new high score) — a plain
  // mount-only effect would keep showing stale values until a full refresh.
  useFocusEffect(
    useCallback(() => {
      Promise.all(SOLO_MODES.map(m => AsyncStorage.getItem(`highScore_${m}`))).then(vals => {
        const next = {};
        SOLO_MODES.forEach((m, i) => { next[m] = vals[i] ? parseInt(vals[i], 10) : 0; });
        setBestScores(next);
      });
    }, [])
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

  const play = (mode, extra = {}) => { sfx.playClick(); navigation.navigate('Game', { mode, ballCount, ...extra }); };

  const playAI = (difficulty) => {
    setAiDifficulty(difficulty);
    AsyncStorage.setItem('aiDifficulty', difficulty);
    setShowAI(false);
    play('ai', { aiDifficulty: difficulty });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>

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
        <Text style={styles.difficultyLabel}>BALLS</Text>
        <View style={styles.difficultyPill}>
          <View style={[styles.difficultyOption, ballCount === 5 && styles.difficultyOptionActive]}>
            <Text style={[styles.difficultyOptionTxt, ballCount === 5 && styles.difficultyOptionTxtActive]}>5</Text>
          </View>
          <View style={[styles.difficultyOption, ballCount === 6 && styles.difficultyOptionActive]}>
            <Text style={[styles.difficultyOptionTxt, ballCount === 6 && styles.difficultyOptionTxtActive]}>6</Text>
          </View>
        </View>
      </TouchableOpacity>

      {/* Title */}
      <View style={styles.titleBlock}>
        <Text style={styles.titleTop}>MARBLE</Text>
        <Text style={styles.titleBot}>MAYHEM</Text>
        <Text style={styles.subtitle}>Lose Your Marbles — reimagined</Text>
      </View>

      {/* Ball decoration */}
      <View style={styles.ballRow}>
        {(ballCount === 6 ? BALL_TYPES_6 : BALL_TYPES_5).map((t, i) => (
          <BallView key={i} type={t} size={44} />
        ))}
      </View>

      {/* High score — best across all solo modes (each mode also shows its
          own best in the Solo Mode picker below). */}
      {overallBest > 0 && (
        <View style={styles.highBox}>
          <Text style={styles.highLabel}>BEST SCORE</Text>
          <Text style={styles.highVal}>{overallBest.toLocaleString()}</Text>
        </View>
      )}

      {/* Mode buttons */}
      <View style={styles.btnGroup}>
        <Text style={styles.modeTitle}>SELECT MODE</Text>

        <TouchableOpacity
          style={[styles.modeBtn, styles.modeBtnSolo, styles.modeBtnCentered]}
          onPress={() => { sfx.playClick(); setSolo(true); }}
          activeOpacity={0.8}
        >
          <Text style={styles.modeBtnIcon}>🎯</Text>
          <View style={styles.modeBtnTextCentered}>
            <Text style={[styles.modeBtnLabel, styles.modeBtnTextCenter]}>START</Text>
            <Text style={[styles.modeBtnSub, styles.modeBtnTextCenter]}>Time Attack or Challenge</Text>
          </View>
        </TouchableOpacity>

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

      {/* How to play */}
      <TouchableOpacity onPress={() => { sfx.playClick(); setHelp(true); }} style={styles.helpLink}>
        <Text style={styles.helpLinkTxt}>How to Play</Text>
      </TouchableOpacity>

      {/* Help modal */}
      <Modal visible={showHelp} animationType="slide" transparent>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
            <Text style={styles.sheetTitle}>How to Play</Text>
            <ScrollView>
              <HelpRow icon="▼" title="Push from below">
                Tap a ▼ button (or tap the column) to push your ball in from the
                bottom. Every ball in that column shifts up one row.
              </HelpRow>
              <HelpRow icon="🌈" title="Match 3+">
                Line up 3 or more balls of the same colour — in a column, across a
                row, or diagonally — and they disappear. Remaining balls fall down.
              </HelpRow>
              <HelpRow icon="💥" title="Overflow">
                If the top of a column was already full when you push, the topmost
                ball flies across to a random column on your opponent's board.
                Fill up all their columns and you win!
              </HelpRow>
              <HelpRow icon="⚡" title="Chain reactions">
                Cleared balls can land and create new matches automatically.
                More chains = bigger score bonus.
              </HelpRow>
              <HelpRow icon="👥" title="2-Player mode">
                Each player controls their own half of the screen. P1 taps the left
                board columns, P2 taps the right board columns.
              </HelpRow>
            </ScrollView>
            <TouchableOpacity style={styles.sheetClose} onPress={() => { sfx.playClick(); setHelp(false); }}>
              <Text style={styles.sheetCloseTxt}>Got it!</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
            <Text style={styles.sheetTitle}>Solo Mode</Text>

            <TouchableOpacity
              style={[styles.modeBtn, styles.modeBtnAlt]}
              onPress={() => { setSolo(false); play('solo-time'); }}
              activeOpacity={0.8}
            >
              <Text style={styles.modeBtnIcon}>⏱️</Text>
              <View>
                <Text style={styles.modeBtnLabel}>TIME ATTACK</Text>
                <Text style={styles.modeBtnSub}>1 minute · score as much as you can</Text>
                {bestScores['solo-time'] > 0 && (
                  <Text style={styles.modeBtnBest}>Best: {bestScores['solo-time'].toLocaleString()}</Text>
                )}
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modeBtn, styles.modeBtnAlt]}
              onPress={() => { setSolo(false); play('solo-normal'); }}
              activeOpacity={0.8}
            >
              <Text style={styles.modeBtnIcon}>⚔️</Text>
              <View>
                <Text style={styles.modeBtnLabel}>CHALLENGE</Text>
                <Text style={styles.modeBtnSub}>No time limit · play until stuck</Text>
                {bestScores['solo-normal'] > 0 && (
                  <Text style={styles.modeBtnBest}>Best: {bestScores['solo-normal'].toLocaleString()}</Text>
                )}
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modeBtn, styles.modeBtnAlt]}
              onPress={() => { setSolo(false); play('relax'); }}
              activeOpacity={0.8}
            >
              <Text style={styles.modeBtnIcon}>♾️</Text>
              <View>
                <Text style={styles.modeBtnLabel}>ZEN MODE</Text>
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

function HelpRow({ icon, title, children }) {
  return (
    <View style={styles.helpRow}>
      <Text style={styles.helpIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.helpTitle}>{title}</Text>
        <Text style={styles.helpBody}>{children}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#080815',
    alignItems: 'center',
    justifyContent: 'space-evenly',
  },

  titleBlock: { alignItems: 'center' },
  titleTop: { color: '#1E90FF', fontSize: 52, fontWeight: 'bold', letterSpacing: 8, lineHeight: 58 },
  titleBot: { color: '#FF4757', fontSize: 52, fontWeight: 'bold', letterSpacing: 8, lineHeight: 58 },
  subtitle: { color: '#444', fontSize: 12, letterSpacing: 2, marginTop: 6 },

  ballRow: { flexDirection: 'row', gap: 8 },

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
  difficultyOption: {
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  difficultyOptionActive: {
    backgroundColor: '#1E90FF',
  },
  difficultyOptionTxt: { color: '#666', fontSize: 14, fontWeight: 'bold' },
  difficultyOptionTxtActive: { color: '#FFF' },

  highBox:   { alignItems: 'center' },
  highLabel: { color: '#444', fontSize: 10, letterSpacing: 2 },
  highVal:   { color: '#FFD700', fontSize: 34, fontWeight: 'bold' },

  btnGroup:  { alignItems: 'center', width: '88%' },
  modeTitle: { color: '#333', fontSize: 11, letterSpacing: 2, marginBottom: 12 },

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
  modeBtnSelected: {
    borderWidth: 2,
    borderColor: '#FFD700',
  },
  modeBtnIcon:  { fontSize: 28 },
  modeBtnLabel: { color: '#FFF', fontSize: 16, fontWeight: 'bold', letterSpacing: 1 },
  modeBtnSub:   { color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 2 },
  modeBtnBest:  { color: '#FFD700', fontSize: 11, fontWeight: 'bold', marginTop: 2 },
  modeBtnCentered:    { justifyContent: 'center' },
  modeBtnTextCentered: { alignItems: 'center' },
  modeBtnTextCenter:  { textAlign: 'center' },

  helpLink:    { paddingVertical: 8 },
  helpLinkTxt: { color: '#333', fontSize: 14 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#12122A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingHorizontal: 20,
    maxHeight: '80%',
  },
  sheetTitle: { color: '#FFF', fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 20 },
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
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 20,
  },
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
  toggleOption: {
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  toggleOptionActive: {
    backgroundColor: '#1E90FF',
  },
  toggleOptionTxt: { color: '#666', fontSize: 12, fontWeight: 'bold' },
  toggleOptionTxtActive: { color: '#FFF' },
});
