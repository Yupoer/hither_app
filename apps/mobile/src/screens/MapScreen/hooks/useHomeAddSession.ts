import { useRef, useState } from 'react';
import type { StopPlacement } from '../components/D6StopCards';

export type HomeAddDismissal = 'close' | 'store';

export type HomeAddDraft = { day: number; stay: boolean; placement: StopPlacement };

export type HomeAddSession = HomeAddDraft & { id: number; dismissal?: HomeAddDismissal };

/**
 * Owns the D6 add-place session across its native sheet dismissal.
 *
 * A swipe-dismissed SwiftUI sheet reports `onIsPresentedChange(false)` and
 * `onDismiss` back to back, before React renders the first change, so the
 * pending dismissal is mirrored in a ref that both callbacks read
 * synchronously.
 */
export function useHomeAddSession() {
  const [session, setSession] = useState<HomeAddSession | null>(null);
  const live = useRef<HomeAddSession | null>(null);
  const queued = useRef<HomeAddDraft | null>(null);
  const nextId = useRef(0);
  const commit = (next: HomeAddSession | null) => {
    live.current = next;
    setSession(next);
  };
  const start = (draft: HomeAddDraft) => {
    nextId.current += 1;
    return { ...draft, id: nextId.current };
  };

  /** Starts a session; while a close is still animating out, the new one starts once it finishes. */
  const open = (draft: HomeAddDraft) => {
    const current = live.current;
    if (current?.dismissal === 'close') queued.current = draft;
    else if (!current?.dismissal) commit(start(draft));
  };

  const update = (change: (current: HomeAddSession) => HomeAddSession) => {
    const current = live.current;
    if (current && !current.dismissal) commit(change(current));
  };

  /** Marks the session as leaving; the caller hides its sheet and calls `finishDismiss` from the sheet's onDismiss. */
  const dismiss = (dismissal: HomeAddDismissal) => {
    const current = live.current;
    if (!current || current.dismissal) return;
    commit({ ...current, dismissal });
  };

  /** Completes a pending dismissal and reports which one finished; a sheet dismissal with none pending is ignored. */
  const finishDismiss = (): HomeAddDismissal | null => {
    const current = live.current;
    const dismissal = current?.dismissal;
    if (!current || !dismissal) return null;
    if (dismissal === 'store') {
      commit({ ...current, dismissal: undefined });
    } else {
      const draft = queued.current;
      queued.current = null;
      commit(draft ? start(draft) : null);
    }
    return dismissal;
  };

  return { session, open, update, dismiss, finishDismiss };
}
