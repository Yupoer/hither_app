import React from 'react';

jest.mock('react-native', () => ({
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
}));

jest.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: () => null,
  requireNativeViewManager: () => {
    throw new Error('missing');
  },
}));

import { NativeMenuHost, isNativeMenuAvailable } from '../native/menu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { act, create } = require('react-test-renderer') as {
  act: (callback: () => void) => void;
  create: (element: React.ReactElement) => {
    root: {
      findAllByProps: (props: Record<string, unknown>) => Array<{ props: Record<string, unknown> }>;
    };
    unmount: () => void;
  };
};

describe('native menu host', () => {
  it('is unavailable without the optional native module and still renders the trigger', () => {
    expect(isNativeMenuAvailable()).toBe(false);
    const onSelect = jest.fn();
    let tree: ReturnType<typeof create>;
    act(() => {
      tree = create(
        React.createElement(
          NativeMenuHost,
          {
            items: [{ id: 'zh', title: '中文' }],
            onSelect,
            accessibilityLabel: '中文',
            children: React.createElement('Text', null, '中文'),
          },
        ),
      );
    });
    const buttons = tree!.root.findAllByProps({ accessibilityRole: 'button' });
    expect(buttons).toHaveLength(1);
    expect(buttons[0].props.accessibilityState).toEqual({ disabled: true });
    expect(onSelect).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});
