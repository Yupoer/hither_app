import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useMountEffect } from '../hooks/useMountEffect';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Resource({ setup }: { setup: () => void | (() => void) }) {
  useMountEffect(setup);
  return null;
}

describe('useMountEffect resource lifetime', () => {
  let tree: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => tree?.unmount());
    tree = undefined;
  });

  it('sets up on mount, cleans up on unmount, and sets up again on remount', () => {
    const events: string[] = [];
    const setup = () => {
      events.push('setup');
      return () => { events.push('cleanup'); };
    };
    act(() => { tree = create(React.createElement(Resource, { setup })); });
    expect(events).toEqual(['setup']);
    act(() => { tree?.unmount(); });
    expect(events).toEqual(['setup', 'cleanup']);
    act(() => { tree = create(React.createElement(Resource, { setup })); });
    expect(events).toEqual(['setup', 'cleanup', 'setup']);
  });

  it('keeps the mounted closure when the setup prop changes without restarting', () => {
    const cleanup = jest.fn();
    const first = jest.fn(() => cleanup);
    const next = jest.fn();
    act(() => { tree = create(React.createElement(Resource, { setup: first })); });
    act(() => { tree?.update(React.createElement(Resource, { setup: next })); });
    expect(first).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    act(() => { tree?.unmount(); });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('preserves StrictMode setup cleanup replay and final disposal', () => {
    const events: string[] = [];
    const setup = () => {
      events.push('setup');
      return () => { events.push('cleanup'); };
    };
    act(() => {
      tree = create(React.createElement(React.StrictMode, null, React.createElement(Resource, { setup })));
    });
    expect(events).toEqual(['setup', 'cleanup', 'setup']);
    act(() => { tree?.unmount(); });
    expect(events).toEqual(['setup', 'cleanup', 'setup', 'cleanup']);
  });

  it('accepts a setup with no cleanup', () => {
    const setup = jest.fn();
    act(() => { tree = create(React.createElement(Resource, { setup })); });
    act(() => { tree?.unmount(); });
    expect(setup).toHaveBeenCalledTimes(1);
  });
});
