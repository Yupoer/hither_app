import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../api/supabase';
import { acceptSubgroupInvite, declineSubgroupInvite, fetchMyInvites } from '../api/client';
import {
  demoAcceptSubgroupInvite,
  demoDeclineSubgroupInvite,
  demoFetchMyInvites,
  isDemoGroup,
} from '../api/demo';
import { notifications } from '../native';
import { useSession } from './SessionContext';
import { useTranslation } from '../i18n';
import type { PendingInvite } from '../types';

/**
 * Pending subgroup ("小隊") invites for the signed-in user, kept live via a
 * Supabase Realtime subscription on `subgroup_invites` (mirrors
 * useGroupNotifications' realtime -> local-notification pattern, and
 * useGroupState's debounced-refetch style).
 *
 * A NEW pending invite (one not seen since this hook mounted) fires a local
 * notification — best-effort, same as useGroupNotifications; Expo Go returns
 * a null push token but local notifications still work.
 */

const REALTIME_DEBOUNCE_MS = 300;

// Per-instance channel suffix, same reasoning as useGroupState/useGroupNotifications:
// a reused channel topic that's already subscribe()d rejects new bindings.
let channelSeq = 0;

// This hook mounts more than once at a time (App.tsx globally + MapScreen for
// the accept/decline UI). Module-level so only ONE of them actually fires the
// notification for a given invite id, no matter which instance's debounced
// refetch sees it first.
// ponytail: plain Set, never pruned — invite ids are few and app-session-lived.
const notifiedIds = new Set<string>();

interface UseSubgroupInvitesResult {
  invites: PendingInvite[];
  accept: (inviteId: string) => Promise<void>;
  decline: (inviteId: string) => Promise<void>;
  refresh: () => void;
}

export function useSubgroupInvites(): UseSubgroupInvitesResult {
  const { user, membership } = useSession();
  const { t } = useTranslation();
  const groupId = membership?.group.id ?? null;
  const myUserId = user?.id ?? null;

  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());
  // False until the first fetch resolves, so invites that already existed
  // when the hook mounted don't all fire a notification at once.
  const initializedRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tRef = useRef(t);
  tRef.current = t;

  const instanceIdRef = useRef(0);
  if (instanceIdRef.current === 0) {
    instanceIdRef.current = ++channelSeq;
  }

  const load = useCallback(async () => {
    if (!myUserId) return;
    try {
      const next = isDemoGroup(groupId)
        ? demoFetchMyInvites(myUserId)
        : await fetchMyInvites(myUserId);
      if (initializedRef.current) {
        const newOnes = next.filter(
          (i) => !seenIdsRef.current.has(i.id) && !notifiedIds.has(i.id),
        );
        for (const inv of newOnes) {
          notifiedIds.add(inv.id);
          void notifications
            .scheduleLocalNotification({
              title: tRef.current('subgroup.inviteNotifyTitle'),
              body: tRef.current('subgroup.invitePrompt', {
                name: inv.inviterName,
                team: inv.subgroupName,
              }),
              data: { subgroupInviteId: inv.id },
            })
            .catch(() => {
              // best-effort
            });
        }
      }
      seenIdsRef.current = new Set(next.map((i) => i.id));
      initializedRef.current = true;
      setInvites(next);
    } catch {
      // best-effort; keep the last known invites on a transient fetch error
    }
  }, [groupId, myUserId]);

  useEffect(() => {
    if (!myUserId) return;
    initializedRef.current = false;
    seenIdsRef.current = new Set();
    load();

    const scheduleReload = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(load, REALTIME_DEBOUNCE_MS);
    };

    const channel = supabase
      .channel(`subgroup-invites:${myUserId}:${instanceIdRef.current}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'subgroup_invites',
          filter: `invitee_id=eq.${myUserId}`,
        },
        scheduleReload,
      )
      .subscribe();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [myUserId, load]);

  const accept = useCallback(
    async (inviteId: string) => {
      if (isDemoGroup(groupId)) {
        demoAcceptSubgroupInvite(inviteId);
      } else {
        await acceptSubgroupInvite(inviteId);
      }
      load();
    },
    [groupId, load],
  );

  const decline = useCallback(
    async (inviteId: string) => {
      if (isDemoGroup(groupId)) {
        demoDeclineSubgroupInvite(inviteId);
      } else {
        await declineSubgroupInvite(inviteId);
      }
      load();
    },
    [groupId, load],
  );

  return { invites, accept, decline, refresh: load };
}
