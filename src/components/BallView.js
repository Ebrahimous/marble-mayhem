/**
 * BallView.js — glossy marble renderer
 *
 * Each ball is a filled circle with a thin dark outline, plus a small
 * white ellipse in the upper-left quadrant to simulate a glass-marble
 * specular highlight. Wild balls display a colour-cycling animation.
 */
import React, { useState, useEffect } from 'react';
import { View, Platform } from 'react-native';
import { BALL_COLORS } from '../constants';

// Colours the wild ball cycles through (one per ball type)
const WILD_CYCLE = ['#E24B4A', '#EF9F27', '#4CAF28', '#378ADD', '#9B2FCF', '#C0C8D8'];

function WildBallView({ size }) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setIdx(i => (i + 1) % WILD_CYCLE.length), 220);
    return () => clearInterval(t);
  }, []);

  const color = WILD_CYCLE[idx];
  const d = size - 4;
  const shineW    = Math.round(d * 0.30);
  const shineH    = Math.round(d * 0.18);
  const shineLeft = Math.round(d * 0.15);
  const shineTop  = Math.round(d * 0.13);

  return (
    <View style={{
      width: d, height: d, borderRadius: d / 2,
      backgroundColor: color, margin: 2,
      borderWidth: 1.5, borderColor: '#0A0A14',
      overflow: 'hidden',
      ...Platform.select({
        web: { boxShadow: 'inset 0 -2px 4px rgba(0,0,0,0.25)' },
      }),
    }}>
      <View style={{
        position: 'absolute',
        top: shineTop, left: shineLeft,
        width: shineW, height: shineH,
        borderRadius: shineH / 2,
        backgroundColor: 'rgba(255,255,255,0.55)',
        transform: [{ rotate: '-30deg' }],
      }} />
    </View>
  );
}


const BallView = React.memo(({ type, size }) => {
  if (!type) {
    return <View style={{ width: size, height: size }} />;
  }
  if (type === 'wild') {
    return <WildBallView size={size} />;
  }

  const color = BALL_COLORS[type] ?? '#888888';
  const d = size - 4;
  const shineW    = Math.round(d * 0.30);
  const shineH    = Math.round(d * 0.18);
  const shineLeft = Math.round(d * 0.15);
  const shineTop  = Math.round(d * 0.13);

  return (
    <View style={{
      width: d, height: d, borderRadius: d / 2,
      backgroundColor: color, margin: 2,
      borderWidth: 1.5, borderColor: '#0A0A14',
      overflow: 'hidden',
      ...Platform.select({
        web: { boxShadow: 'inset 0 -2px 4px rgba(0,0,0,0.25)' },
      }),
    }}>
      <View style={{
        position: 'absolute',
        top: shineTop,
        left: shineLeft,
        width: shineW,
        height: shineH,
        borderRadius: shineH / 2,
        backgroundColor: 'rgba(255,255,255,0.45)',
        transform: [{ rotate: '-30deg' }],
      }} />
    </View>
  );
});

export default BallView;
