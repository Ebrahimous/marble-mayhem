import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import MenuScreen from './src/screens/MenuScreen';
import GameScreen from './src/screens/GameScreen';

const Stack = createNativeStackNavigator();

/**
 * Web-only: make the page behave like a mobile app.
 *  - Viewport tuned for phones (no accidental pinch/double-tap zoom)
 *  - Theme colour for browser chrome / "Add to Home Screen"
 *  - Disable pull-to-refresh, rubber-band scrolling, text selection,
 *    and the tap-highlight flash so swipes feel native.
 */
function useMobileWebSetup() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    const setMeta = (name, content) => {
      let tag = document.querySelector(`meta[name="${name}"]`);
      if (!tag) {
        tag = document.createElement('meta');
        tag.name = name;
        document.head.appendChild(tag);
      }
      tag.content = content;
    };

    setMeta('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover');
    setMeta('theme-color', '#0F0F1A');
    setMeta('apple-mobile-web-app-capable', 'yes');
    setMeta('apple-mobile-web-app-status-bar-style', 'black-translucent');
    setMeta('mobile-web-app-capable', 'yes');

    // Tell the browser this page is intentionally dark-themed. Without this,
    // some Android Chrome builds apply their own "force dark" colour
    // transform to pages it thinks are light-themed, which dims/desaturates
    // our bright marble colours (e.g. red/blue/green render as muted
    // navy/maroon/dark-green). Declaring `color-scheme: dark` opts the page
    // out of that automatic recolouring so our palette renders as authored.
    setMeta('color-scheme', 'dark');
    setMeta('supported-color-schemes', 'dark');

    const style = document.createElement('style');
    style.textContent = `
      :root { color-scheme: dark; }
      html, body, #root { height: 100%; overscroll-behavior: none; }
      body {
        touch-action: pan-x pan-y;
        -webkit-user-select: none;
        user-select: none;
        -webkit-tap-highlight-color: transparent;
        forced-color-adjust: none;
      }
    `;
    document.head.appendChild(style);
  }, []);
}

export default function App() {
  useMobileWebSetup();

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName="Menu"
          screenOptions={{ headerShown: false, animation: 'fade' }}
        >
          <Stack.Screen name="Menu" component={MenuScreen} />
          <Stack.Screen name="Game" component={GameScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
