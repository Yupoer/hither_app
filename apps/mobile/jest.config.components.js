module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.tsx'],
  setupFiles: ['<rootDir>/jest.setup.components.js'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)'
  ]
};
