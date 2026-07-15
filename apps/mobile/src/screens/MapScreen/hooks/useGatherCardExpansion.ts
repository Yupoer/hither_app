import { useCallback, useEffect, useRef, useState } from 'react';

const AUTO_COLLAPSE_MS = 10_000;

export function useGatherCardExpansion(defaultExpanded: boolean) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const overridesRef = useRef(overrides);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const replaceOverrides = useCallback((next: Record<string, boolean>) => {
    overridesRef.current = next;
    setOverrides(next);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const scheduleCollapse = useCallback((id: string) => {
    clearTimer();
    timerRef.current = setTimeout(() => {
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

  const registerCardActivity = useCallback((id: string) => {
    if (!defaultExpanded && overridesRef.current[id] === true) scheduleCollapse(id);
  }, [defaultExpanded, scheduleCollapse]);

  useEffect(() => {
    clearTimer();
    replaceOverrides({});
  }, [clearTimer, defaultExpanded, replaceOverrides]);

  useEffect(() => clearTimer, [clearTimer]);

  return { isCardExpanded, toggleCard, registerCardActivity };
}
