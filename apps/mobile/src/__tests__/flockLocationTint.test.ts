import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { FlockRow } from '../screens/MapScreen/components/FlockRow';

let mockReduceMotion = false;
jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: { absoluteFill: {}, create: (styles: object) => styles },
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  useReducedMotion: () => mockReduceMotion,
  useSharedValue: (value: number) => ({ value, set: jest.fn() }),
  useAnimatedStyle: (style: () => object) => style(),
  withDelay: (_: number, animation: number) => animation,
  withTiming: (value: number) => value,
  cancelAnimation: jest.fn(),
}));
jest.mock('../components/HitherText', () => ({ HitherText: 'Text' }));
jest.mock('../state/foregroundUi', () => ({
  useForegroundClock: () => ({ now: Date.parse('2026-11-08T03:00:10Z'), lifecycle: null }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('shows the tint only for a newer peer fix, with no flash on mount or under Reduce Motion', async () => {
  const draw = (lastUpdated: string) => React.createElement(FlockRow, {
    userId: 'peer', name: 'Peer', color: '#FFFFFF', isLeader: false, solo: false,
    dist: '', arrived: false, lastUpdated, serverTimeOffsetMs: 0, syncFailed: false,
    isMe: false, last: true, styles: {}, t: key => key, accent: '#F5B142',
    onSelfMerge: () => {}, onSelfSplit: () => {}, inboxCount: 0, onOpenInbox: () => {},
  });
  let root!: ReactTestRenderer;
  await act(async () => { root = create(draw('2026-11-08T02:58:00Z')); });
  const tint = () => root.root.findAllByProps({ testID: 'map-member-location-tint' });

  try {
    expect(tint()).toHaveLength(0);
    await act(async () => { root.update(draw('2026-11-08T02:57:00Z')); });
    expect(tint()).toHaveLength(0);
    await act(async () => { root.update(draw('2026-11-08T03:00:00Z')); });
    const highlighted = tint()[0];
    expect(highlighted.props.pointerEvents).toBe('none');
    await act(async () => { root.update(draw('2026-11-08T03:00:00Z')); });
    expect(tint()[0]).toBe(highlighted);
    mockReduceMotion = true;
    await act(async () => { root.update(draw('2026-11-08T03:00:01Z')); });
    expect(tint()).toHaveLength(0);
  } finally {
    await act(async () => { root.unmount(); });
    mockReduceMotion = false;
  }
});
