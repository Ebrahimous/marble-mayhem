/**
 * BallView.js — flat-style ball renderer
 *
 * Plain solid-colour circle, no border/outline/glow/highlight — matches
 * marbles_template_1.svg (flat single-fill circles).
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
    }} />
  );
});

export default BallView;
