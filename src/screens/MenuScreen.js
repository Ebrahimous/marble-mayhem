import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity,
  StyleSheet, Modal, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BallView from '../components/BallView';
import { CELL_SIZE, BALL_TYPES_5, BALL_TYPES_6 } from '../constants';

export default function MenuScreen({ navigation }) {
  const insets    = useSafeAreaInsets();
  const [high, setHigh]           = useState(0);
  const [showHelp, setHelp]       = useState(false);
  const [showSolo, setSolo]       = useState(false);
  const [ballCount, setBallCount] = useState(5);

  useEffect(() => {
    AsyncStorage.getItem('highScore').then(v => v && setHigh(parseInt(v, 10)));
    AsyncStorage.getItem('ballCount').then(v => v && setBallCount(parseInt(v, 10)));
  }, []);

  const toggleBallCount = () => {
    const next = ballCount === 5 ? 6 : 5;
    setBallCount(next);
    AsyncStorage.setItem('ballCount', String(next));
  };

  const play = (mode) => navigation.navigate('Game', { mode, ballCount });

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>

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

      {/* High score */}
      {high > 0 && (
        <View style={styles.highBox}>
          <Text style={styles.highLabel}>BEST SCORE</Text>
          <Text style={styles.highVal}>{high.toLocaleString()}</Text>
        </View>
      )}

      {/* Mode buttons */}
      <View style={styles.btnGroup}>
        <Text style={styles.modeTitle}>SELECT MODE</Text>

        <TouchableOpacity
          style={[styles.modeBtn, styles.modeBtnSolo]}
          onPress={() => setSolo(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.modeBtnIcon}>🎯</Text>
          <View>
            <Text style={styles.modeBtnLabel}>SOLO</Text>
            <Text style={styles.modeBtnSub}>Time Attack or Endless</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.modeBtn} onPress={() => play('ai')} activeOpacity={0.8}>
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
      </View>

      {/* How to play */}
      <TouchableOpacity onPress={() => setHelp(true)} style={styles.helpLink}>
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
            <TouchableOpacity style={styles.sheetClose} onPress={() => setHelp(false)}>
              <Text style={styles.sheetCloseTxt}>Got it!</Text>
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
              style={styles.modeBtn}
              onPress={() => { setSolo(false); play('solo-time'); }}
              activeOpacity={0.8}
            >
              <Text style={styles.modeBtnIcon}>⏱️</Text>
              <View>
                <Text style={styles.modeBtnLabel}>TIME ATTACK</Text>
                <Text style={styles.modeBtnSub}>1 minute · score as much as you can</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modeBtn, styles.modeBtnAlt]}
              onPress={() => { setSolo(false); play('solo-normal'); }}
              activeOpacity={0.8}
            >
              <Text style={styles.modeBtnIcon}>♾️</Text>
              <View>
                <Text style={styles.modeBtnLabel}>ENDLESS</Text>
                <Text style={styles.modeBtnSub}>No time limit · play until stuck</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.sheetClose} onPress={() => setSolo(false)}>
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
  modeBtnIcon:  { fontSize: 28 },
  modeBtnLabel: { color: '#FFF', fontSize: 16, fontWeight: 'bold', letterSpacing: 1 },
  modeBtnSub:   { color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 2 },

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
});
