import { useEffect } from 'react';

export function useMountEffect(fn: () => void | (() => void)): void {
  // The caller owns one resource lifetime; changed inputs require a new mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(fn, []);
}
