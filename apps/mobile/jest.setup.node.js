jest.mock('./src/components/MotionPressable', () => ({
  __esModule: true,
  default: require('react-native').Pressable,
}));
