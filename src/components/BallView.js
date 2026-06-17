/**
 * BallView.js — glossy marble renderer
 *
 * Each ball is a filled circle with a thin dark outline, plus a small
 * white ellipse in the upper-left quadrant to simulate a glass-marble
 * specular highlight. The highlight is rendered as an absolutely-positioned
 * child View so it works on both web and native without SVG.
 */
import React from 'react';
import { View, Platform } from 'react-native';
import { BALL_COLORS } from '../constants';

const BallView = React.memo(({ type, size }) => {
  if (!type) {
    return <View style={{ width: size, height: size }} />;
  }
  const color = BALL_COLORS[type] ?? '#888888'; // fallback for unknown types
  const d = size - 4;
  // Shine ellipse sizing — scales with ball diameter
  const shineW = Math.round(d * 0.30);
  const shineH = Math.round(d * 0.18);
  // Offset from top-left of the ball circle
 