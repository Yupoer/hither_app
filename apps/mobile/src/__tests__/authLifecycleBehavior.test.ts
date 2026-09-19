import { installAuthLifecycle } from '../api/authLifecycle';

describe('installAuthLifecycle edge behavior', () => {
  it('starts immediately for an already-active app and defers foreground work by default', () => {
    jest.useFakeTimers();
    const start = jest.fn();
    const foreground = jest.fn();
    const remove = jest.fn();
    const cleanup = installAuthLifecycle({
      auth: { startAutoRefresh: start },
      appState: { currentState: 'active', addEventListener: () => ({ remove }) },
      onForeground: foreground,
    });

    expect(start).toHaveBeenCalledTimes(1);
    expect(foreground).not.toHaveBeenCalled();
    jest.runOnlyPendingTimers();
    expect(foreground).toHaveBeenCalledTimes(1);
    cleanup();
    expect(remove).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('stops on inactive, ignores unrelated states, and tolerates optional auth hooks', () => {
    const stop = jest.fn();
    let listener: ((state: string) => void) | undefined;
    const cleanup = installAuthLifecycle({
      auth: { stopAutoRefresh: stop },
      appState: {
        currentState: 'unknown',
        addEventListener: (_event, next) => {
          listener = next;
          return { remove: jest.fn() };
        },
      },
    });

    expect(stop).not.toHaveBeenCalled();
    listener!('inactive');
    listener!('background');
    listener!('extension');
    expect(stop).toHaveBeenCalledTimes(2);
    expect(() => cleanup()).not.toThrow();
  });

  it('uses the injected deferral hook synchronously without awaiting inside the AppState callback', () => {
    const events: string[] = [];
    let listener: ((state: string) => void) | undefined;
    installAuthLifecycle({
      auth: { startAutoRefresh: () => events.push('start') },
      appState: {
        currentState: null,
        addEventListener: (_event, next) => {
          listener = next;
          return { remove: jest.fn() };
        },
      },
      onForeground: () => events.push('foreground'),
      defer: (work) => {
        events.push('defer');
        work();
      },
    });

    listener!('active');
    expect(events).toEqual(['start', 'defer', 'foreground']);
  });
});
