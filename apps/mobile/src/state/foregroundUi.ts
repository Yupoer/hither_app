import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { getRuntimePowerState, optionalVisualsAllowed, subscribeRuntimePowerState } from './runtimePowerState';

// UI only: background location, navigation and sync never subscribe here.
const listeners = new Set<() => void>();
let subscription: { remove(): void } | undefined;
let foreground = AppState?.currentState === 'active';
export function isForegroundUi(): boolean {
  return subscription ? foreground : AppState?.currentState === 'active';
}
export function subscribeForegroundUi(listener: () => void): () => void {
  listeners.add(listener);
  if (!subscription) {
    foreground = AppState?.currentState === 'active';
    let focused = true;
    const update = () => {
      const next = AppState?.currentState === 'active' && focused;
      if (foreground === next) return;
      foreground = next;
      for (const notify of listeners) notify();
    };
    const change = AppState?.addEventListener?.('change', update);
    const blur = Platform?.OS === 'android' ? AppState.addEventListener('blur', () => { focused = false; update(); }) : undefined;
    const focus = Platform?.OS === 'android' ? AppState.addEventListener('focus', () => { focused = true; update(); }) : undefined;
    subscription = { remove: () => { change?.remove(); blur?.remove(); focus?.remove(); } };
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { subscription?.remove(); subscription = undefined; }
  };
}
export function useForegroundUi(): boolean {
  return useSyncExternalStore(subscribeForegroundUi, isForegroundUi, isForegroundUi);
}
export function useOptionalVisuals(): boolean {
  const active = useForegroundUi();
  const power = useSyncExternalStore(subscribeRuntimePowerState, getRuntimePowerState, getRuntimePowerState);
  return active && optionalVisualsAllowed(power);
}
/** Same display cadence while visible; resume reads wall time once, never replays ticks. */
export function useForegroundClock(intervalMs: number, enabled = true): number {
  const active = useForegroundUi();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active || !enabled) return;
    setNow(Date.now());
    const timer = setInterval(() => { if (isForegroundUi()) setNow(Date.now()); }, intervalMs);
    return () => clearInterval(timer);
  }, [active, enabled, intervalMs]);
  return now;
}
