import React from 'react';
import { useGatherCardExpansion } from '../screens/MapScreen/hooks/useGatherCardExpansion';

// react-test-renderer is installed but this project does not ship its typings.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require('react-test-renderer') as {
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
  create: (element: React.ReactElement) => {
    update: (nextElement: React.ReactElement) => void;
    unmount: () => void;
  };
};
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe('useGatherCardExpansion', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    consoleError = jest.spyOn(console, 'error').mockImplementation((...args) => {
      if (String(args[0]).includes('react-test-renderer is deprecated')) return;
      throw new Error(args.map(String).join(' '));
    });
  });
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    consoleError.mockRestore();
  });

  function renderExpansion(defaultExpanded: boolean) {
    let result: ReturnType<typeof useGatherCardExpansion> | undefined;
    function Harness({ expanded }: { expanded: boolean }) {
      result = useGatherCardExpansion(expanded);
      return null;
    }
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(Harness, { expanded: defaultExpanded }));
    });
    return {
      get result() {
        if (!result) throw new Error('hook not rendered');
        return result;
      },
      setDefault(expanded: boolean) {
        renderer.update(React.createElement(Harness, { expanded }));
      },
      unmount() {
        act(() => renderer.unmount());
      },
    };
  }

  it('keeps only one card open and auto-collapses it after 10 seconds', () => {
    const hook = renderExpansion(false);
    act(() => hook.result.toggleCard('a'));
    expect(hook.result.isCardExpanded('a')).toBe(true);
    act(() => hook.result.toggleCard('b'));
    expect(hook.result.isCardExpanded('a')).toBe(false);
    expect(hook.result.isCardExpanded('b')).toBe(true);
    act(() => jest.advanceTimersByTime(10_000));
    expect(hook.result.isCardExpanded('b')).toBe(false);
    hook.unmount();
  });

  it('restarts the collapse timer only when the expanded card is used', () => {
    const hook = renderExpansion(false);
    act(() => hook.result.toggleCard('a'));
    act(() => jest.advanceTimersByTime(6_000));
    act(() => hook.result.registerCardActivity('a'));
    act(() => jest.advanceTimersByTime(6_000));
    expect(hook.result.isCardExpanded('a')).toBe(true);
    act(() => jest.advanceTimersByTime(4_000));
    expect(hook.result.isCardExpanded('a')).toBe(false);
    hook.unmount();
  });

  it('lets default-expanded cards stay manually collapsed without a timer', () => {
    const hook = renderExpansion(true);
    expect(hook.result.isCardExpanded('a')).toBe(true);
    expect(hook.result.isCardExpanded('b')).toBe(true);
    act(() => hook.result.toggleCard('a'));
    act(() => jest.advanceTimersByTime(20_000));
    expect(hook.result.isCardExpanded('a')).toBe(false);
    expect(hook.result.isCardExpanded('b')).toBe(true);
    hook.unmount();
  });

  it('clears manual overrides when the preference changes', () => {
    const hook = renderExpansion(false);
    act(() => hook.result.toggleCard('a'));
    expect(hook.result.isCardExpanded('a')).toBe(true);
    act(() => hook.setDefault(true));
    expect(hook.result.isCardExpanded('a')).toBe(true);
    expect(hook.result.isCardExpanded('b')).toBe(true);
    hook.unmount();
  });
});
