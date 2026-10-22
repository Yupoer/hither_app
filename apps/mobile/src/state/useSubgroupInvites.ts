import { useForegroundReconcile } from './useForegroundReconcile';
import { createElement, Fragment, useCallback, useRef, useState, type ReactElement, type RefObject, type Dispatch, type SetStateAction } from 'react';
import { useMountEffect } from '../hooks/useMountEffect';
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
  lifecycle: ReactElement;
  invites: PendingInvite[];
  accept: (inviteId: string) => Promise<void>;
  decline: (inviteId: string) => Promise<void>;
  refresh: () => void;
}
interface InviteIdentity { groupId: string | null; myUserId: string | null }

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
  const identityRef = useRef<InviteIdentity | null>(null);

  const load = useCallback(async () => {
    const identity = identityRef.current;
    if (!myUserId || !identity || identity.groupId !== groupId || identity.myUserId !== myUserId) return;
    try {
      const next = isDemoGroup(groupId)
        ? demoFetchMyInvites(myUserId)
        : await fetchMyInvites(myUserId);
      if (identityRef.current !== identity) return;
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

  const foregroundLifecycle = useForegroundReconcile(Boolean(myUserId), load);

  const [subscriptionIdentity, setSubscriptionIdentity] = useState({ groupId, myUserId, generation: 0 });
  if (!Object.is(subscriptionIdentity.groupId, groupId) || !Object.is(subscriptionIdentity.myUserId, myUserId)) {
    setSubscriptionIdentity({ groupId, myUserId, generation: subscriptionIdentity.generation + 1 });
  }

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

  return { invites, accept, decline, refresh: load,
    lifecycle: createElement(Fragment, null,
      createElement(Fragment, { key: 'invite-subscription' }, createElement(SubgroupInviteSubscription, {
        key: `subgroup-invites:${subscriptionIdentity.generation}`, groupId, myUserId, identityRef,
        setInvites, initializedRef, seenIdsRef, load, debounceRef,
      })),
      createElement(Fragment, { key: 'invite-foreground' }, foregroundLifecycle)),
  };
}

function SubgroupInviteSubscription({ groupId, myUserId, identityRef, setInvites, initializedRef, seenIdsRef, load, debounceRef }: {
  groupId: string | null;
  myUserId: string | null;
  identityRef: RefObject<InviteIdentity | null>;
  setInvites: Dispatch<SetStateAction<PendingInvite[]>>;
  initializedRef: RefObject<boolean>;
  seenIdsRef: RefObject<Set<string>>;
  load: () => Promise<void>;
  debounceRef: RefObject<ReturnType<typeof setTimeout> | null>;
}) {
  useMountEffect(() => {
    setInvites([]);
    if (!myUserId) { identityRef.current = null; return; }
    const identity = { groupId, myUserId };
    identityRef.current = identity;
    let active = true;
    initializedRef.current = false;
    seenIdsRef.current = new Set();
    load();

    const scheduleReload = () => {
      if (!active) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        load();
      }, REALTIME_DEBOUNCE_MS);
    };

    const subId = ++channelSeq;
    const channel = supabase
      .channel(`subgroup-invites:${myUserId}:${subId}`)
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
      .subscribe(status => { if (status === 'SUBSCRIBED') scheduleReload(); });

    return () => {
      active = false;
      if (identityRef.current === identity) identityRef.current = null;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  });
  return null;
}
