/**
 * BallView.js — flat-style ball renderer
 *
 * Flat single-fill circles (matches marbles_template_1.svg), with a thin
 * dark outline so balls stay readable against any cell background —
 * notably the yellow main-row background, where lighter ball colours
 * (e.g. amber) would otherwise blend in.
 */
import React from 'react';
import { View } from 'react-native';
import { BALL_COLORS } from '../constants';

const BallView = React.memo(({ type, size }) => {
  if (!type) {
    return <View style={{ width: size, height: size }} />;
  }
  const color = BALL_COLORS[type];
  const d = size - 4;
  return (
    <View style={{
      width: d, height: d, borderRadius: d / 2,
      backgroundColor: color, margin: 2,
      borderWidth: 1.5, borderColor: '#0A0A14',
    }} />
  );
});

export default BallView;
