/**
 * LeaderboardScreen.js — all-modes leaderboard shown side by side
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as sfx from '../sounds';
import { fetchLeaderboard } from '../firebase';

export const LEADERBOARD_MODES = [
  { key: 'mayhem',      label: 'MAYHEM',      icon: '💥' },
  { key: 'solo-time',   label: 'TIME ATTACK', icon: '⏱️' },
  { key: 'solo-normal', label: 'CHALLENGE',   icon: '⚔️' },
];

const RANK_COLORS = ['#FFD700', '#C0C0C0', '#CD7F32'];
const RANK_LABELS = ['🥇', '🥈', '🥉'];

function ModeColumn({ modeKey, label, icon, entries, loading, error }) {
  return (
    <View style={styles.column}>
      {/* Column header */}
      <View style={styles.colHeader}>
        <Text style={styles.colIcon}>{icon}</Text>
        <Text style={styles.colTitle}>{label}</Text>
      </View>

      {/* Column rows */}
      <View style={styles.colBody}>
        {/* Header row */}
        <View style={styles.row}>
          <Text style={[styles.rankCell, styles.dimTxt]}>#</Text>
          <Text style={[styles.nameCell, styles.dimTxt]}>NAME</Text>
          <Text style={[styles.scoreCell, styles.dimTxt]}>SCORE</Text>
        </View>

        {loading ? (
          <View style={styles.colEmpty}>
            <ActivityIndicator size="small" color="#444" />
          </View>
        ) : error ? (
          <View style={styles.colEmpty}>
            <Text style={styles.colErrorTxt}>{error}</Text>
          </View>
        ) : entries.length === 0 ? (
          <View style={styles.colEmpty}>
            <Text style={styles.colEmptyTxt}>No scores yet</Text>
          </View>
        ) : (
          entries.map((entry, i) => (
            <View
              key={i}
              style={[styles.row, styles.entryRow, i % 2 === 0 && styles.entryRowEven]}
            >
              <Text style={[
                styles.rankCell,
                i < 3 && { color: RANK_COLORS[i], fontSize: 16 },
              ]}>
                {i < 3 ? RANK_LABELS[i] : i + 1}
              </Text>
              <Text style={[styles.nameCell, styles.entryName]} numberOfLines={1}>
                {entry.name || 'Player'}
              </Text>
              <Text style={[styles.scoreCell, styles.entryScore]}>
                {entry.score.toLocaleString()}
              </Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

export default function LeaderboardScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [boards, setBoards]     = useState({});
  const [loadingSet, setLoadingSet] = useState({});
  const [errors, setErrors]     = useState({});

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      // Load all modes in parallel
      LEADERBOARD_MODES.forEach(({ key }) => {
        setLoadingSet(prev => ({ ...prev, [key]: true }));
        setErrors(prev => ({ ...prev, [key]: null }));
        fetchLeaderboard(key)
          .then(entries => {
            if (!cancelled) setBoards(prev => ({ ...prev, [key]: entries }));
          })
          .catch(err => {
            if (!cancelled) setErrors(prev => ({ ...prev, [key]: err?.code ?? err?.message ?? 'Error' }));
          })
          .finally(() => {
            if (!cancelled) setLoadingSet(prev => ({ ...prev, [key]: false }));
          });
      });
      return () => { cancelled = true; };
    }, [])
  );

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

      {/* Three columns */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.columnsWrap}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.columns}>
          {LEADERBOARD_MODES.map(({ key, label, icon }) => (
            <ModeColumn
              key={key}
              modeKey={key}
              label={label}
              icon={icon}
              entries={boards[key] ?? []}
              loading={!!loadingSet[key]}
              error={errors[key]}
            />
          ))}
        </View>
      </ScrollView>

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

  columnsWrap: { padding: 10 },
  columns: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },

  // Individual mode column
  column: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1A1A38',
    backgroundColor: '#0D0D22',
    overflow: 'hidden',
  },
  colHeader: {
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A38',
    backgroundColor: '#13132B',
  },
  colIcon:  { fontSize: 20, marginBottom: 2 },
  colTitle: { color: '#FFD700', fontSize: 10, fontWeight: 'bold', letterSpacing: 1.5 },

  colBody: { paddingHorizontal: 6, paddingBottom: 10 },

  colEmpty: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  colEmptyTxt: { color: '#333', fontSize: 12 },
  colErrorTxt: { color: '#553333', fontSize: 11, textAlign: 'center' },

  // Rows
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  entryRow: { borderRadius: 6, paddingHorizontal: 2 },
  entryRowEven: { backgroundColor: 'rgba(255,255,255,0.03)' },

  rankCell:  { width: 28, textAlign: 'center', fontWeight: 'bold', fontSize: 12, color: '#666' },
  nameCell:  { flex: 1, paddingHorizontal: 4, color: '#999', fontSize: 11 },
  scoreCell: { width: 56, textAlign: 'right', color: '#999', fontSize: 11 },

  dimTxt:     { color: '#2A2A4A', fontSize: 9, fontWeight: 'bold', letterSpacing: 0.8 },
  entryName:  { color: '#BBB', fontSize: 12 },
  entryScore: { color: '#FFD700', fontSize: 12, fontWeight: 'bold' },
});
