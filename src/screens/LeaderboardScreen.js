/**
 * LeaderboardScreen.js — per-mode, per-ball-count top-10 leaderboard
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as sfx from '../sounds';
import { fetchLeaderboard } from '../firebase';

export const LEADERBOARD_MODES = [
  { key: 'mayhem', label: 'TIME BLAST', icon: '💣' },
];

const RANK_COLORS = ['#FFD700', '#C0C0C0', '#CD7F32'];
const RANK_LABELS = ['🥇', '🥈', '🥉'];

export default function LeaderboardScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [activeMode, setActiveMode] = useState(LEADERBOARD_MODES[0].key);
  const [ballCount, setBallCount]   = useState(5);
  const [boards, setBoards]         = useState({});
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);

  // Load persisted ball count on mount
  React.useEffect(() => {
    AsyncStorage.getItem('ballCount').then(v => v && setBallCount(parseInt(v, 10)));
  }, []);

  // Leaderboard key matches the key used in GameScreen when saving scores
  const lbKey = `${activeMode}-${ballCount}`;

  // Reload scores whenever the active mode or ball count changes, or screen focuses
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      setError(null);
      fetchLeaderboard(lbKey)
        .then(entries => { if (!cancelled) setBoards(prev => ({ ...prev, [lbKey]: entries })); })
        .catch(err => { if (!cancelled) setError(`Error: ${err?.code ?? err?.message ?? String(err)}`); })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }, [lbKey])
  );

  const toggleBallCount = () => {
    sfx.playClick();
    setBallCount(prev => prev === 5 ? 6 : 5);
  };

  const entries = boards[lbKey] ?? [];
  const activeLabel = LEADERBOARD_MODES.find(m => m.key === activeMode)?.label ?? '';

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => { sfx.playClick(); navigation.goBack(); }}
        >
          <Text style={styles.backBtnTxt}>◀</Text>
        </TouchableOpacity>
        <Text style={styles.title}>🏆 LEADERBOARD</Text>
        {/* Ball count toggle — mirrors the menu setting */}
        <TouchableOpacity style={styles.ballToggle} onPress={toggleBallCount} activeOpacity={0.8}>
          <Text style={styles.ballToggleLabel}>DIFFICULTY</Text>
          <View style={styles.ballPill}>
            <View style={[styles.ballOption, ballCount === 5 && styles.ballOptionActive]}>
              <Text style={[styles.ballOptionTxt, ballCount === 5 && styles.ballOptionTxtActive]}>EASY</Text>
            </View>
            <View style={[styles.ballOption, ballCount === 6 && styles.ballOptionActive]}>
              <Text style={[styles.ballOptionTxt, ballCount === 6 && styles.ballOptionTxtActive]}>HARD</Text>
            </View>
          </View>
        </TouchableOpacity>
      </View>

      {/* Mode tabs */}
      <View style={styles.tabs}>
        {LEADERBOARD_MODES.map(m => (
          <TouchableOpacity
            key={m.key}
            style={[styles.tab, activeMode === m.key && styles.tabActive]}
            onPress={() => { sfx.playClick(); setActiveMode(m.key); }}
            activeOpacity={0.8}
          >
            <Text style={styles.tabIcon}>{m.icon}</Text>
            <Text style={[styles.tabLabel, activeMode === m.key && styles.tabLabelActive]}>
              {m.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Entries list */}
      {loading ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>⏳</Text>
          <Text style={styles.emptyText}>Loading scores…</Text>
        </View>
      ) : error ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>⚠️</Text>
          <Text style={styles.emptyText}>{error}</Text>
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📭</Text>
          <Text style={styles.emptyText}>No scores yet for {activeLabel} ({ballCount === 5 ? 'Easy' : 'Hard'}).</Text>
          <Text style={styles.emptyHint}>Play a game to get on the board!</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.row}>
            <Text style={[styles.cell, styles.cellRank, styles.colHeader]}>#</Text>
            <Text style={[styles.cell, styles.cellName, styles.colHeader]}>NAME</Text>
            <Text style={[styles.cell, styles.cellScore, styles.colHeader]}>SCORE</Text>
            <Text style={[styles.cell, styles.cellDate, styles.colHeader]}>DATE</Text>
          </View>

          {entries.map((entry, i) => (
            <View
              key={i}
              style={[styles.row, styles.entryRow, i % 2 === 0 && styles.entryRowEven]}
            >
              <Text style={[
                styles.cell, styles.cellRank,
                i < 3 && { color: RANK_COLORS[i], fontSize: 20 },
              ]}>
                {i < 3 ? RANK_LABELS[i] : i + 1}
              </Text>
              <Text style={[styles.cell, styles.cellName, styles.entryName]} numberOfLines={1}>
                {entry.name || 'Player'}
              </Text>
              <Text style={[styles.cell, styles.cellScore, styles.entryScore]}>
                {entry.score.toLocaleString()}
              </Text>
              <Text style={[styles.cell, styles.cellDate, styles.entryDate]}>
                {entry.date ?? ''}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#080815',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A38',
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnTxt: { color: '#666', fontSize: 20 },
  title: {
    color: '#FFD700',
    fontSize: 17,
    fontWeight: 'bold',
    letterSpacing: 1.5,
  },

  // Ball count toggle
  ballToggle: { alignItems: 'center' },
  ballToggleLabel: { color: '#444', fontSize: 8, fontWeight: 'bold', letterSpacing: 1, marginBottom: 3 },
  ballPill: {
    flexDirection: 'row',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#252545',
    overflow: 'hidden',
  },
  ballOption: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#0D0D22',
  },
  ballOptionActive: { backgroundColor: '#1E90FF' },
  ballOptionTxt: { color: '#444', fontSize: 13, fontWeight: 'bold' },
  ballOptionTxtActive: { color: '#FFF' },

  // Mode tabs
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A38',
    gap: 6,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1A1A38',
    backgroundColor: '#0D0D22',
  },
  tabActive: {
    backgroundColor: '#1E1E44',
    borderColor: '#FFD700',
  },
  tabIcon:  { fontSize: 16 },
  tabLabel: { color: '#444', fontSize: 9, fontWeight: 'bold', letterSpacing: 1, marginTop: 2 },
  tabLabelActive: { color: '#FFD700' },

  // Empty state
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { color: '#666', fontSize: 16, marginBottom: 6 },
  emptyHint: { color: '#333', fontSize: 13 },

  // Entry list
  list: { flex: 1 },
  listContent: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 24 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  entryRow: {
    borderRadius: 8,
    paddingHorizontal: 8,
  },
  entryRowEven: {
    backgroundColor: 'rgba(255,255,255,0.03)',
  },

  cell: { color: '#999' },
  cellRank:  { width: 40, textAlign: 'center', fontWeight: 'bold', fontSize: 14 },
  cellName:  { flex: 1, paddingHorizontal: 8 },
  cellScore: { width: 90, textAlign: 'right', fontVariant: ['tabular-nums'] },
  cellDate:  { width: 78, textAlign: 'right', marginLeft: 8 },

  colHeader: { color: '#333', fontSize: 10, letterSpacing: 1 },

  entryName:  { color: '#CCC', fontSize: 15 },
  entryScore: { color: '#FFD700', fontSize: 16, fontWeight: 'bold' },
  entryDate:  { color: '#444', fontSize: 12 },
});
