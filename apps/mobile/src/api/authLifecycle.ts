export interface AuthAutoRefreshAdapter {
  startAutoRefresh?: () => void;
  stopAutoRefresh?: () => void;
}

export interface AuthAppStateAdapter {
  currentState?: string | null;
  addEventListener: (
    event: 'change',
    listener: (state: string) => void,
  ) => { remove: () => void };
}

export interface AuthLifecycleOptions {
  auth: AuthAutoRefreshAdapter;
  appState: AuthAppStateAdapter;
  /** Runs after the synchronous AppState/auth callback has returned. */
  onForeground?: () => void;
  defer?: (work: () => void) => void;
}

/**
 * Keep Supabase Auth's refresh timer aligned with the native app lifecycle.
 * The listener itself is synchronous: async session work is always deferred.
 */
export function installAuthLifecycle(options: AuthLifecycleOptions): () => void {
  const defer = options.defer ?? ((work: () => void) => {
    setTimeout(work, 0);
  });

  const apply = (state: string | null | undefined) => {
    if (state === 'active') {
      options.auth.startAutoRefresh?.();
      if (options.onForeground) defer(options.onForeground);
    } else if (state === 'background' || state === 'inactive') {
      options.auth.stopAutoRefresh?.();
    }
  };

  apply(options.appState.currentState);
  const subscription = options.appState.addEventListener('change', apply);
  return () => subscription.remove();
}

