// Expo CLI loads apps/mobile/.env for builds, but Jest does not. Component
// tests only need a syntactically valid client configuration; all network
// boundaries remain mocked by the individual suites.
const { jest } = require('@jest/globals');

process.env.EXPO_PUBLIC_SUPABASE_URL ??= 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??= 'test-publishable-key';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => ({
  ...require('react-native-reanimated/mock'),
  makeMutable: value => ({ value }),
  useSharedValue: value => require('react').useRef({ value }).current,
  useReducedMotion: () => true,
  useFrameCallback: () => require('react').useRef({ setActive: jest.fn() }).current,
}));
jest.mock('@shopify/react-native-skia', () => ({
  Canvas: require('react-native').View,
  Fill: () => null,
  Shader: () => null,
  Path: () => null,
  Skia: {
    RuntimeEffect: { Make: jest.fn(() => ({})) },
    Path: { Make: () => ({ addCircle: jest.fn() }) },
  },
}));
jest.mock('react-native-maps', () => ({
  __esModule: true,
  default: require('react-native').View,
  Marker: require('react-native').View,
  Polyline: require('react-native').View,
}));
require('react-native').AppState.currentState = 'active';
