import { createElement, Fragment, useRef, useState, type ReactElement, type RefObject } from 'react';
import { AppState } from 'react-native';
import { useMountEffect } from '../hooks/useMountEffect';

type RepairCallback = () => unknown;
interface ForegroundRepairInput {
  enabled: boolean;
  intervalMs: number;
  reload: RepairCallback;
}

function CommittedForegroundReload({ reload, callback }: {
  reload: RepairCallback;
  callback: RefObject<RepairCallback>;
}) {
  useMountEffect(() => { callback.current = reload; });
  return null;
}

function ForegroundRepairTimer({ enabled, intervalMs, reload, callback }: ForegroundRepairInput & {
  callback: RefObject<RepairCallback>;
}) {
  useMountEffect(() => {
    // Setup can synchronously receive an AppState event before sibling publication.
    callback.current = reload;
    if (!enabled) return;
    const run = () => {
      if (AppState.currentState === 'active') void Promise.resolve().then(() => callback.current()).catch(() => undefined);
    };
    const sub = AppState.addEventListener('change', state => { if (state === 'active') run(); });
    const timer = setInterval(run, intervalMs);
    return () => { sub.remove(); clearInterval(timer); };
  });
  return null;
}

function ForegroundReconcile({ enabled, reload, intervalMs }: ForegroundRepairInput) {
  const callback = useRef(reload);
  const [repairInput, setRepairInput] = useState({ enabled, intervalMs, generation: 0 });
  const [reloadInput, setReloadInput] = useState({ reload, generation: 0 });
  if (!Object.is(repairInput.enabled, enabled) || !Object.is(repairInput.intervalMs, intervalMs)) {
    setRepairInput({ enabled, intervalMs, generation: repairInput.generation + 1 });
  }
  if (!Object.is(reloadInput.reload, reload)) {
    setReloadInput({ reload, generation: reloadInput.generation + 1 });
  }
  return createElement(Fragment, null,
    createElement(CommittedForegroundReload, { key: 'reload:' + reloadInput.generation, reload, callback }),
    createElement(ForegroundRepairTimer, { key: 'repair:' + repairInput.generation, enabled, intervalMs, reload, callback }),
  );
}

/** Missed-event repair. The consumer must render this lifecycle at its stable owner. */
export function useForegroundReconcile(enabled: boolean, reload: RepairCallback, intervalMs = 30_000): ReactElement {
  return createElement(ForegroundReconcile, { enabled, reload, intervalMs });
}
