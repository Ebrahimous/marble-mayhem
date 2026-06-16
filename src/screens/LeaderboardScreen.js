/**
 * LeaderboardScreen.js — per-mode top-10 leaderboard
 *
 * Reads `leaderboard_<mode>` entries from AsyncStorage (written by
 * GameScreen when a game ends and the player opts to save their score).
 * Each entry: { name: string, score: number, date: string (ISO date) }.
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as sfx from '../sounds';

export const LEADERBOARD_MODES = [
  { key: 'mayhem',      label: 'MAYHEM',      icon: '💥' },
  { key: 'solo-time',   label: 'TIME ATTACK', icon: '⏱️' },
  { key: 'relax',       label: 'ZEN',         icon: '♾️' },
  { key: 'solo-normal', label: 'CHALLENGE',   icon: '⚔️' },
];

const RANK_COLORS = ['#FFD700', '#C0C0C0', '#CD7F32'];
const RANK_LABELS = ['🥇', '🥈', '🥉'];

export default function LeaderboardScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [activeMode, setActiveMode] = useState(LEADERBOARD_MODES[0].key);
  const [boards, setBoards] = useState({}); // { [mode]: Entry[] }
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Reload all leaderboard data whenever the screen comes into focus
  useFocusEffect(
    useCallback(() => {
      Promise.all(
        LEADERBOARD_MODES.map(m => AsyncStorage.getItem(`leaderboard_${m.key}`))
      ).then(vals => {
        const next = {};
        LEADERBOARD_MODES.forEach((m, i) => {
          next[m.key] = vals[i] ? JSON.parse(vals[i]) : [];
        });
        setBoards(next);
      });
    }, [])
  );

  const entries = boards[activeMode] ?? [];
  const activeLabel = LEADERBOARD_MODES.find(m => m.key === activeMode)?.label ?? '';

  const clearMode = async () => {
    await AsyncStorage.removeItem(`leaderboard_${activeMode}`);
    setBoards(prev => ({ ...prev, [activeMode]: [] }));
    setShowClearConfirm(false);
    sfx.playClick();
  };

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
        <View style={{ width: 40 }} />
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
      {entries.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📭</Text>
          <Text style={styles.emptyText}>No scores yet for {activeLabel}.</Text>
          <Text style={styles.emptyHint}>Play a game to get on the board!</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Column headers */}
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

      {/* Clear button */}
      {entries.length > 0 && (
        <TouchableOpacity
          style={styles.clearBtn}
          onPress={() => { sfx.playClick(); setShowClearConfirm(true); }}
          activeOpacity={0.8}
        >
          <Text style={styles.clearBtnTxt}>Clear {activeLabel} Scores</Text>
        </TouchableOpacity>
      )}

      {/* Clear confirmation modal */}
      <Modal visible={showClearConfirm} animationType="fade" transparent onRequestClose={() => setShowClearConfirm(false)}>
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmSheet}>
            <Text style={styles.confirmTitle}>Clear Scores?</Text>
            <Text style={styles.confirmMsg}>
              All {activeLabel} leaderboard entries will be permanently deleted.
            </Text>
            <TouchableOpacity style={styles.confirmYes} onPress={clearMode}>
              <Text style={styles.confirmYesTxt}>Clear All</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.confirmNo}
              onPress={() => { sfx.playClick(); setShowClearConfirm(false); }}
            >
              <Text style={styles.confirmNoTxt}>Cancel</Text>
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
    backgroundColor: '#080815',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A38',
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnTxt: { color: '#666', fontSize: 20 },
  title: {
    color: '#FFD700',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 1.5,
  },

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

  // Clear button
  clearBtn: {
    marginHorizontal: 16,
    marginBottom: 16,
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#332233',
    alignItems: 'center',
  },
  clearBtnTxt: { color: '#553355', fontSize: 13 },

  // Confirm modal
  confirmBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  confirmSheet: {
    backgroundColor: '#13132B',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E1E44',
    padding: 24,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  confirmTitle: { color: '#FFD700', fontSize: 20, fontWeight: 'bold', marginBottom: 12 },
  confirmMsg:   { color: '#888', fontSize: 14, textAlign: 'center', marginBottom: 24 },
  confirmYes: {
    backgroundColor: '#8B0000',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 32,
    marginBottom: 10,
    width: '100%',
    alignItems: 'center',
  },
  confirmYesTxt: { color: '#FFF', fontSize: 15, fontWeight: 'bold' },
  confirmNo: {
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 32,
    width: '100%',
    alignItems: 'center',
  },
  confirmNoTxt: { color: '#666', fontSize: 15 },
});
