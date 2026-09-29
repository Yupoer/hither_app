import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

/** Missed-event repair for active data surfaces; callbacks keep their own single-flight guard. */
export function useForegroundReconcile(enabled: boolean, reload: () => unknown, intervalMs = 30_000): void {
  const ref = useRef(reload);
  ref.current = reload;
  useEffect(() => {
    if (!enabled) return;
    const run = () => {
      if (AppState.currentState === 'active') void Promise.resolve().then(() => ref.current()).catch(() => undefined);
    };
    const sub = AppState.addEventListener('change', state => { if (state === 'active') run(); });
    const timer = setInterval(run, intervalMs);
    return () => { sub.remove(); clearInterval(timer); };
  }, [enabled, intervalMs]);
}
