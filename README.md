# Marble Mayhem 🎮

A modern mobile remake of the classic Windows 98 game **Lose Your Marbles**, built with React Native + Expo. Runs on iOS and Android.

---

## What you need (install once)

1. **Node.js** — download from https://nodejs.org  
   Pick the "LTS" version. Just click Next through the installer.

2. **Expo Go app** on your phone  
   - iPhone → App Store → search "Expo Go"  
   - Android → Google Play → search "Expo Go"

That's it. You don't need Xcode or Android Studio.

---

## Running the game

Open a terminal (on Windows: press `Win + R`, type `cmd`, press Enter).

```bash
# 1. Go into the project folder
cd "C:\Users\EB\Claude\Projects\Marbles remake"

# 2. Install dependencies (only needed once)
npm install

# 3. Start the development server
npm start
```

A QR code will appear in the terminal.  
Open **Expo Go** on your phone and scan the QR code.  
The game will load on your phone within a few seconds.

> **Same Wi-Fi required** — your computer and phone must be on the same Wi-Fi network.

---

## How to play

| Action | What it does |
|--------|-------------|
| Tap a **▼** button | Drop your current marble into that column |
| Tap directly on a **column** | Same as above |

**Rules:**
- Line up **3 or more** same-colour marbles (horizontal, vertical, or diagonal) to clear them.
- Cleared marbles score points. Chain reactions give combo bonuses.
- Every few seconds a new row pushes in from the top — the red bar counts down.
- Game over when marbles reach the bottom.

**Power-up:** Every 12th marble you drop is a 💣 **bomb** that blasts a 3×3 area.

---

## Project structure (for curious readers)

```
App.js                  ← navigation setup
src/
  constants.js          ← grid size, colours, timing, scoring
  engine.js             ← all game logic (no React, pure functions)
  screens/
    MenuScreen.js       ← home screen + high score
    GameScreen.js       ← the actual game
```

The game logic in `engine.js` is completely separate from the UI, which makes it easy to test or modify the rules without touching any visual code.

---

## Publishing to the App Store / Google Play (when you're ready)

1. Create an [Expo account](https://expo.dev) (free)
2. Run `npm install -g eas-cli` then `eas build`
3. Follow the prompts — Expo handles the build process in the cloud

Full guide: https://docs.expo.dev/distribution/introduction/
