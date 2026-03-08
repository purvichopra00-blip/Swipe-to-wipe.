# 📸 Photo Swipe — Tinder for Photos

A beautiful photo swiping app built with **Expo (SDK 54)**, **React Native**, and **TypeScript**.

Swipe right to like, left to pass. See your liked photos in a gorgeous grid.

## ✨ Features

- 🃏 **Swipeable card stack** — drag photos left/right with smooth gesture animations
- ❤️ **Like / ❌ Nope buttons** — tap to swipe programmatically
- ↩️ **Undo** — bring back the last swiped card
- 📸 **Liked collection** — grid view of all your liked photos (long-press to remove)
- 🎨 **Dark glassmorphism UI** — gradient backgrounds, glowing cards, micro-animations
- 📳 **Haptic feedback** on swipe completion
- 🔄 **Start Over** — reset when you've seen all photos

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ installed
- **Expo Go** app on your phone ([iOS](https://apps.apple.com/app/expo-go/id982107779) / [Android](https://play.google.com/store/apps/details?id=host.exp.exponent))

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server
npx expo start

# 3. Scan the QR code with Expo Go on your phone
#    (make sure phone & laptop are on the same WiFi)
```

## 📁 Project Structure

```
photo-swipe/
├── app/
│   ├── _layout.tsx              # Root layout (GestureHandler + Context)
│   └── (tabs)/
│       ├── _layout.tsx          # Tab navigator (Discover + Liked)
│       ├── index.tsx            # Discover screen (swipe cards)
│       └── liked.tsx            # Liked photos grid
├── components/
│   └── SwipeCard.tsx            # Animated swipe card component
├── constants/
│   └── photos.ts               # Photo data (15 items from picsum.photos)
├── contexts/
│   └── PhotoContext.tsx         # Shared state (liked, disliked, undo)
├── app.json                     # Expo config
├── package.json                 # Dependencies (SDK 54)
└── tsconfig.json                # TypeScript config
```

## 🛠 Tech Stack

| Package | Version | Purpose |
|---|---|---|
| expo | ~54.0 | SDK & runtime |
| expo-router | ~6.0 | File-based routing |
| react-native-gesture-handler | ~2.28 | Swipe gestures |
| react-native-reanimated | ~4.1 | Smooth animations |
| react-native-worklets | 0.5.1 | Required by reanimated (pinned for Expo Go) |
| expo-haptics | ~15.0 | Haptic feedback |
| expo-image | ~3.0 | Optimized image loading |
| expo-linear-gradient | ~15.0 | Gradient backgrounds |

> **Note:** `react-native-worklets` is pinned to `0.5.1` via npm `overrides` in `package.json` to match the native version bundled in Expo Go SDK 54. Do not upgrade this without also upgrading to a newer Expo SDK.

## 📱 Running on Device

1. Install [Expo Go](https://expo.dev/go) on your phone
2. Run `npx expo start` in this directory
3. Scan the QR code that appears in your terminal
4. Both phone and laptop must be on the same WiFi network

## 🔧 Customization

- **Add more photos**: Edit `constants/photos.ts` — add objects with `id`, `url`, `title`, `photographer`, `category`
- **Change theme colors**: Search for `#ff6b9d` (pink accent) and `#0a0a1a` (background) across the source files
- **Swipe sensitivity**: Adjust `SWIPE_THRESHOLD` in `app/(tabs)/index.tsx` and `components/SwipeCard.tsx`
