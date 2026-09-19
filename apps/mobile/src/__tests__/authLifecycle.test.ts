import { installAuthLifecycle } from '../api/authLifecycle';

describe('auth lifecycle', () => {
  it('starts/stops auto refresh with AppState and defers foreground work', () => {
    const startAutoRefresh = jest.fn();
    const stopAutoRefresh = jest.fn();
    let listener: ((state: string) => void) | null = null;
    const foreground: Array<() => void> = [];
    const remove = jest.fn();

    const cleanup = installAuthLifecycle({
      auth: { startAutoRefresh, stopAutoRefresh },
      appState: {
        currentState: 'background',
        addEventListener: (_event, next) => {
          listener = next;
          return { remove };
        },
      },
      onForeground: () => foreground.push(() => undefined),
      defer: (work) => foreground.push(work),
    });

    expect(stopAutoRefresh).toHaveBeenCalledTimes(1);
    expect(startAutoRefresh).not.toHaveBeenCalled();
    listener!('active');
    expect(startAutoRefresh).toHaveBeenCalledTimes(1);
    expect(foreground).toHaveLength(1);
    cleanup();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

