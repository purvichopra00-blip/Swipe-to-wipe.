import 'react-native-gesture-handler/jestSetup';

// Mock Reanimated
require('react-native-reanimated').setUpTests();

// Mock Async Storage
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Mock Expo Router
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  }),
  useLocalSearchParams: () => ({}),
  Link: 'Link',
}));

// Mock Expo Media Library
jest.mock('expo-media-library', () => ({
  getAssetsAsync: jest.fn(() => Promise.resolve({ assets: [], hasNextPage: false })),
  getAssetInfoAsync: jest.fn(() => Promise.resolve({ uri: 'mock-uri' })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
}));

// Mock Expo Video
jest.mock('expo-video', () => ({
  useVideoPlayer: jest.fn(() => ({
    play: jest.fn(),
    pause: jest.fn(),
    loop: true,
  })),
  VideoView: 'VideoView',
}));

// Mock Google Mobile Ads
jest.mock('react-native-google-mobile-ads', () => ({
  InterstitialAd: {
    createForAdRequest: jest.fn(() => ({
      load: jest.fn(),
      show: jest.fn(),
      onAdEvent: jest.fn(),
    })),
  },
  BannerAd: 'BannerAd',
  BannerAdSize: { FULL_BANNER: 'FULL_BANNER' },
  TestIds: { INTERSTITIAL: 'test-id' },
  AdEventType: { LOADED: 'LOADED', CLOSED: 'CLOSED' },
}));

// Mock Expo Haptics
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));

// Mock Sentry (So it doesn't try to send events during tests)
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

// Silence the console.warn that some libraries emit
global.console = {
  ...console,
  // warn: jest.fn(),
  // error: jest.fn(),
};
