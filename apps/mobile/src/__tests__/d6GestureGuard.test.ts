import { measure, type AnimatedRef } from 'react-native-reanimated';
import { guardGesture, measureAttached, subscribeGestureFailures } from '../screens/MapScreen/components/d6GestureGuard';

jest.mock('react-native-reanimated', () => ({
  measure: jest.fn(() => ({ x: 0, y: 0, width: 10, height: 20, pageX: 4, pageY: 8 })),
  runOnJS: (callback: unknown) => callback,
}));

Object.assign(globalThis, { __DEV__: false });

describe('guardGesture', () => {
  it('passes gesture arguments through and leaves recovery idle when the callback succeeds', () => {
    const callback = jest.fn();
    const recover = jest.fn();
    const listener = jest.fn();
    const unsubscribe = subscribeGestureFailures(listener);
    guardGesture('pane-update', callback, recover)({ translationY: 12 }, true);
    unsubscribe();
    expect(callback).toHaveBeenCalledWith({ translationY: 12 }, true);
    expect(recover).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it('recovers locally and reports the source and error instead of letting a worklet throw escape', () => {
    const recover = jest.fn();
    const listener = jest.fn();
    const unsubscribe = subscribeGestureFailures(listener);
    const guarded = guardGesture('route-reorder-update', () => { throw new TypeError('measure of null'); }, recover);
    expect(() => guarded()).not.toThrow();
    expect(recover).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('route-reorder-update', 'TypeError: measure of null');
    expect(() => guardGesture('pane-end', () => { throw 'detached'; }, recover)()).not.toThrow();
    expect(listener).toHaveBeenLastCalledWith('pane-end', 'detached');
    unsubscribe();
  });

  it('stops notifying a listener after it unsubscribes while other listeners keep receiving failures', () => {
    const removed = jest.fn();
    const kept = jest.fn();
    const unsubscribeRemoved = subscribeGestureFailures(removed);
    const unsubscribeKept = subscribeGestureFailures(kept);
    unsubscribeRemoved();
    guardGesture('pane-start', () => { throw new Error('lost'); }, () => {})();
    unsubscribeKept();
    guardGesture('pane-start', () => { throw new Error('again'); }, () => {})();
    expect(removed).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);
    expect(kept).toHaveBeenCalledWith('pane-start', 'Error: lost');
  });

  it('warns with the gesture source in development builds', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    Object.assign(globalThis, { __DEV__: true });
    try {
      guardGesture('pane-finalize', () => { throw new Error('boom'); }, () => {})();
      expect(warn).toHaveBeenCalledWith('[gesture:pane-finalize] Error: boom');
    } finally {
      Object.assign(globalThis, { __DEV__: false });
      warn.mockRestore();
    }
  });
});

describe('measureAttached', () => {
  beforeEach(() => jest.mocked(measure).mockClear());

  it.each([null, undefined])('returns null without measuring when the animated ref resolves to %s', attached => {
    const ref = (() => attached) as unknown as AnimatedRef<object>;
    expect(measureAttached(ref)).toBeNull();
    expect(measure).not.toHaveBeenCalled();
  });

  it('delegates to measure once the animated ref has an attached view', () => {
    const ref = (() => ({ tag: 7 })) as unknown as AnimatedRef<object>;
    expect(measureAttached(ref)).toEqual({ x: 0, y: 0, width: 10, height: 20, pageX: 4, pageY: 8 });
    expect(measure).toHaveBeenCalledWith(ref);
  });
});
