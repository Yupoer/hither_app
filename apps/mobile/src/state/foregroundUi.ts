import { createElement, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import { useMountEffect } from '../hooks/useMountEffect';
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
    let lastAppState = AppState?.currentState;
    const update = () => {
      const next = AppState?.currentState === 'active' && focused;
      if (foreground === next && lastAppState === AppState?.currentState) return;
      foreground = next;
      lastAppState = AppState?.currentState;
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
/** iOS system covers are still visible UI; only true background hides native surfaces. */
export function isVisibleUi(): boolean {
  return isForegroundUi() || (Platform?.OS === 'ios' && AppState?.currentState === 'inactive');
}
export function useVisibleUi(): boolean {
  return useSyncExternalStore(subscribeForegroundUi, isVisibleUi, isVisibleUi);
}
export function useOptionalVisuals(): boolean {
  const active = useForegroundUi();
  const power = useSyncExternalStore(subscribeRuntimePowerState, getRuntimePowerState, getRuntimePowerState);
  return active && optionalVisualsAllowed(power);
}
/** Same display cadence while visible; resume reads wall time once, never replays ticks. */
export function useForegroundClock(intervalMs: number, enabled = true) {
  const active = useVisibleUi();
  const [now, setNow] = useState(Date.now);
  const [clockIdentity, setClockIdentity] = useState({ active, enabled, intervalMs, generation: 0 });
  if (!Object.is(clockIdentity.active, active) || !Object.is(clockIdentity.enabled, enabled) || !Object.is(clockIdentity.intervalMs, intervalMs)) {
    setClockIdentity({ active, enabled, intervalMs, generation: clockIdentity.generation + 1 });
  }
  return { now, lifecycle: createElement(ForegroundClockTick, { key: `foreground-clock:${clockIdentity.generation}`, active, enabled, intervalMs, setNow }) };
}

const readAppState = () => AppState?.currentState;
/** Reuse the shared native subscription; auth may remain visible while inactive. */
export function useAppState() {
  return useSyncExternalStore(subscribeForegroundUi, readAppState, readAppState);
}

function ForegroundClockTick({ active, enabled, intervalMs, setNow }: {
  active: boolean;
  enabled: boolean;
  intervalMs: number;
  setNow: Dispatch<SetStateAction<number>>;
}) {
  useMountEffect(() => {
    if (!active || !enabled) return;
    setNow(Date.now());
    const timer = setInterval(() => { if (isVisibleUi()) setNow(Date.now()); }, intervalMs);
    return () => clearInterval(timer);
  });
  return null;
}
