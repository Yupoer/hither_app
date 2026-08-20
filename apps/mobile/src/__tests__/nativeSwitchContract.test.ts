import React from 'react';

const platform = { OS: 'ios' as 'ios' | 'android' };

jest.mock('react-native', () => ({
  Platform: platform,
  Switch: 'Switch',
}));

import NativeSwitch from '../components/NativeSwitch';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { act, create } = require('react-test-renderer') as {
  act: (callback: () => void) => void;
  create: (element: React.ReactElement) => {
    root: {
      findAll: (
        fn: (n: { type: unknown; props: Record<string, unknown> }) => boolean,
      ) => Array<{ props: Record<string, unknown> }>;
    };
    unmount: () => void;
  };
};

describe('NativeSwitch iOS/Android chrome', () => {
  afterEach(() => {
    platform.OS = 'ios';
  });

  it('omits trackColor, thumbColor, and ios_backgroundColor on iOS', () => {
    platform.OS = 'ios';
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        React.createElement(NativeSwitch, {
          value: true,
          accent: '#6cf',
          trackColor: { true: '#f00', false: '#0f0' },
          thumbColor: '#111',
          ios_backgroundColor: '#222',
          accessibilityLabel: 'precise',
        }),
      );
    });
    const switches = tree.root.findAll((n) => n.type === 'Switch');
    expect(switches).toHaveLength(1);
    expect(switches[0].props.trackColor).toBeUndefined();
    expect(switches[0].props.thumbColor).toBeUndefined();
    expect(switches[0].props.ios_backgroundColor).toBeUndefined();
    expect(switches[0].props.value).toBe(true);
    act(() => tree.unmount());
  });

  it('still paints an accent track on Android', () => {
    platform.OS = 'android';
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        React.createElement(NativeSwitch, {
          value: true,
          accent: '#6cf',
          accessibilityLabel: 'precise',
        }),
      );
    });
    const switches = tree.root.findAll((n) => n.type === 'Switch');
    expect(switches[0].props.trackColor).toEqual({
      true: '#6cf',
      false: 'rgba(120,120,128,0.32)',
    });
    expect(switches[0].props.thumbColor).toBe('#fff');
    act(() => tree.unmount());
  });
});
