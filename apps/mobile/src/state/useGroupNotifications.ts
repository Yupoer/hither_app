import { useEffect, useRef } from 'react';
import { supabase } from '../api/supabase';
import { getNotificationPreferences } from '../api/client';
import { notifications } from '../native';
import { useSession } from './SessionContext';
import { useTranslation } from '../i18n';
import { isLeaderCommand, type CommandType, type NotificationCategory } from '../types';

/**
 * Interim LOCAL-notification delivery (no APNs / no paid Apple account yet).
 *
 * Each device subscribes to the group's realtime changes and, when an event
 * arrives from SOMEONE ELSE, fires a local notification — gated by THIS user's
 * per-category preference (enforced receiver-side here, since there's no server
 * to filter). Mirrors what the APNs Edge Function would send; when an APNs key
 * is added later, the server path takes over and this can be retired.
 *
 * Limitation vs APNs: local notifications only fire while the app is running
 * (foreground / briefly background) — true background delivery needs APNs.
 *
 * Events → category:
 *   commands INSERT (leader type)   → leaderCommands
 *   commands INSERT (follower type) → followerRequests
 *   itinerary_items INSERT          → addGathering
 *   groups journey_status change    → journey  (skipped for the leader who set it)
 */

// Per-instance channel suffix so this listener never collides with useGroupState's.
let channelSeq = 0;

export function useGroupNotifications(): void {
  const { user, membership } = useSession();
  const { t } = useTranslation();

  const groupId = membership?.group.id ?? null;
  const myUserId = user?.id ?? null;

  // Read latest t / role inside realtime callbacks without re-subscribing.
  const tRef = useRef(t);
  tRef.current = t;
  const isLeaderRef = useRef(membership?.role === 'leader');
  isLeaderRef.current = membership?.role === 'leader';

  const instanceIdRef = useRef(0);
  if (instanceIdRef.current === 0) {
    instanceIdRef.current = ++channelSeq;
  }

  useEffect(() => {
    if (!groupId || !myUserId) return;

    // Fire a local notification iff this user's category pref is on. Prefs are
    // read fresh per event (events are low-frequency) so a toggle in Settings
    // takes effect immediately.
    const fire = async (
      category: NotificationCategory,
      title: string,
      body: string,
    ) => {
      try {
        // Solo mode detaches this user from ALL group noise. Read fresh per
        // event (like prefs below); a select error (solo_mode migration not
        // applied yet) just means "not solo".
        // Subgroup members are muted from main-group events by design (a
        // subgroup is Solo-for-two-or-more semantically) — server-side push
        // fanout doesn't apply the same filter yet, that's a known follow-up.
        const { data: me, error: soloErr } = await supabase
          .from('memberships')
          .select('solo, subgroup_id')
          .eq('group_id', groupId)
          .eq('user_id', myUserId)
          .maybeSingle();
        const meRow = me as { solo?: boolean; subgroup_id?: string | null } | null;
        if (!soloErr && (meRow?.solo || meRow?.subgroup_id != null)) return;

        const prefs = await getNotificationPreferences();
        if (!prefs[category]) return;
        await notifications.scheduleLocalNotification({
          title,
          body,
          data: { category, groupId },
        });
      } catch {
        // best-effort
      }
    };

    const groupFilter = `group_id=eq.${groupId}`;
    const idFilter = `id=eq.${groupId}`;

    const channel = supabase
      .channel(`notif:${groupId}:${instanceIdRef.current}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'commands', filter: groupFilter },
        (payload) => {
          const row = payload.new as {
            sender_id: string;
            type: CommandType;
            message: string | null;
          };
          if (row.sender_id === myUserId) return; // never notify the sender
          const leader = isLeaderCommand(row.type);
          const label = tRef.current(`command.${row.type}` as const);
          const title = leader
            ? tRef.current('notif.leaderTitle', { label })
            : tRef.current('notif.memberTitle', { label });
          void fire(
            leader ? 'leaderCommands' : 'followerRequests',
            title,
            row.message ?? label,
          );
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'itinerary_items', filter: groupFilter },
        (payload) => {
          const row = payload.new as { created_by: string | null; title: string };
          if (row.created_by === myUserId) return;
          void fire(
            'addGathering',
            tRef.current('notif.addGatheringTitle'),
            tRef.current('notif.addGatheringBody', { title: row.title }),
          );
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'groups', filter: idFilter },
        (payload) => {
          const next = payload.new as { journey_status: string };
          const prev = payload.old as { journey_status?: string };
          if (next.journey_status === prev?.journey_status) return; // no change
          if (isLeaderRef.current) return; // the leader pressed it themselves
          const going = next.journey_status === 'going';
          void fire(
            'journey',
            tRef.current(going ? 'notif.journeyGoingTitle' : 'notif.journeyPausedTitle'),
            tRef.current(going ? 'notif.journeyGoingBody' : 'notif.journeyPausedBody'),
          );
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId, myUserId]);
}
