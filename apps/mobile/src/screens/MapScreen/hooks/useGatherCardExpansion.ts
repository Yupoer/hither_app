import { useCallback, useEffect, useRef, useState } from 'react';

const AUTO_COLLAPSE_MS = 10_000;

export function useGatherCardExpansion(defaultExpanded: boolean) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const overridesRef = useRef(overrides);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** When true, auto-collapse timers are suppressed (feature tour). */
  const autoCollapsePausedRef = useRef(false);

  const replaceOverrides = useCallback((next: Record<string, boolean>) => {
    overridesRef.current = next;
    setOverrides(next);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const scheduleCollapse = useCallback((id: string) => {
    if (autoCollapsePausedRef.current) return;
    clearTimer();
    timerRef.current = setTimeout(() => {
      if (autoCollapsePausedRef.current) {
        timerRef.current = null;
        return;
      }
      if (overridesRef.current[id] === true) replaceOverrides({});
      timerRef.current = null;
    }, AUTO_COLLAPSE_MS);
  }, [clearTimer, replaceOverrides]);

  const isCardExpanded = useCallback(
    (id: string) => overrides[id] ?? defaultExpanded,
    [defaultExpanded, overrides],
  );

  const toggleCard = useCallback((id: string) => {
    const expanded = overridesRef.current[id] ?? defaultExpanded;
    if (defaultExpanded) {
      clearTimer();
      replaceOverrides({ ...overridesRef.current, [id]: !expanded });
      return;
    }
    if (expanded) {
      clearTimer();
      replaceOverrides({});
      return;
    }
    replaceOverrides({ [id]: true });
    scheduleCollapse(id);
  }, [clearTimer, defaultExpanded, replaceOverrides, scheduleCollapse]);

  const collapseCard = useCallback((id: string) => {
    clearTimer();
    const expanded = overridesRef.current[id] ?? defaultExpanded;
    if (!expanded) return;
    if (defaultExpanded) {
      replaceOverrides({ ...overridesRef.current, [id]: false });
    } else {
      replaceOverrides({});
    }
  }, [clearTimer, defaultExpanded, replaceOverrides]);

  /** Force a card open without starting auto-collapse (tour-friendly). */
  const expandCard = useCallback((id: string) => {
    clearTimer();
    replaceOverrides({ [id]: true });
    if (!autoCollapsePausedRef.current && !defaultExpanded) {
      scheduleCollapse(id);
    }
  }, [clearTimer, defaultExpanded, replaceOverrides, scheduleCollapse]);

  const pauseAutoCollapse = useCallback(() => {
    autoCollapsePausedRef.current = true;
    clearTimer();
  }, [clearTimer]);

  const resumeAutoCollapse = useCallback(() => {
    autoCollapsePausedRef.current = false;
  }, []);

  const registerCardActivity = useCallback((id: string) => {
    if (autoCollapsePausedRef.current) return;
    if (!defaultExpanded && overridesRef.current[id] === true) scheduleCollapse(id);
  }, [defaultExpanded, scheduleCollapse]);

  useEffect(() => {
    clearTimer();
    replaceOverrides({});
  }, [clearTimer, defaultExpanded, replaceOverrides]);

  useEffect(() => clearTimer, [clearTimer]);

  return {
    isCardExpanded,
    toggleCard,
    collapseCard,
    registerCardActivity,
    expandCard,
    pauseAutoCollapse,
    resumeAutoCollapse,
  };
}
