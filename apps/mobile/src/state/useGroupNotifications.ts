import { useEffect, useRef } from 'react';
import { supabase } from '../api/supabase';
import { getNotificationPreferences } from '../api/client';
import { notifications } from '../native';
import { useSession } from './SessionContext';
import { useTranslation } from '../i18n';
import { isLeaderCommand, type CommandType, type NotificationCategory } from '../types';
import {
  buildAlignedNotificationEventId,
  classifyCommandNotification,
  eventIdFromPushData,
  getProcessNotificationSeen,
  markNotificationDelivered,
  resolveNotificationRecipients,
  shouldDeliverOnce,
  type NotificationEventKind,
  type PolicyMember,
} from '../utils/notificationDeliveryPolicy';

/**
 * Interim LOCAL-notification delivery (Realtime fallback).
 *
 * Each device subscribes to the group's realtime changes and, when an event
 * arrives from SOMEONE ELSE, fires a local notification — gated by THIS user's
 * per-category preference. Shares the same recipient policy matrix and dual-path
 * event identity as remote send-push (Ticket 02). Keep Realtime even when a
 * push token exists; shouldDeliverOnce suppresses true duplicates.
 *
 * Limitation vs APNs: local notifications only fire while the app is running
 * (foreground / briefly background) — true background delivery needs APNs.
 *
 * Events → category / policy event:
 *   commands INSERT (leader type)   → leaderCommands / quick_command
 *   commands INSERT (request_start) → followerRequests / route_request
 *   itinerary_items INSERT          → addGathering / add_gathering
 *   groups journey_status change    → journey / start_journey (members only)
 *   group_alerts straggler          → journey / straggler
 *   destination_arrivals INSERT     → journey / member_arrival (leaders only)
 */

// Per-instance channel suffix so this listener never collides with useGroupState's.
let channelSeq = 0;

function categoryToPolicyEvent(
  category: NotificationCategory,
  commandType?: string | null,
): NotificationEventKind {
  if (commandType === 'request_start') return 'route_request';
  switch (category) {
    case 'leaderCommands':
    case 'followerRequests':
      return 'quick_command';
    case 'addGathering':
      return 'add_gathering';
    case 'journey':
      return 'exception';
    default:
      return 'quick_command';
  }
}

/** Resolve command category without drifting unknown custom roles to leader (#170). */
export function resolveCommandNotificationClass(
  commandType: CommandType,
  senderRole: 'leader' | 'follower' | null | undefined,
): ReturnType<typeof classifyCommandNotification> {
  return classifyCommandNotification({
    commandType,
    senderRole: senderRole ?? null,
    isLeaderFixedType: isLeaderCommand(commandType),
  });
}

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

  useEffect(() => {
    if (!groupId || !myUserId) return;

    // Shared process set so Realtime local and FG push presentation dedupe.
    const seen = getProcessNotificationSeen();

    // When APNs/FCM presents first, mark process seen so Realtime does not
    // schedule a second local banner for the same dual-path identity.
    const unsubPush = notifications.addForegroundListener((data) => {
      const eventId = eventIdFromPushData(data);
      markNotificationDelivered(myUserId, eventId, 'push');
    });

    const fire = async (opts: {
      category: NotificationCategory;
      title: string;
      body: string;
      eventKind: NotificationEventKind;
      senderId: string;
      entityId?: string | null;
      commandType?: string | null;
      version?: string | number | null;
      /** Server push category string for aligned eventId (optional). */
      pushCategory?: string;
      status?: string | null;
      titleKey?: string | null;
    }) => {
      try {
        const { data: me, error: soloErr } = await supabase
          .from('memberships')
          .select('solo, subgroup_id, role')
          .eq('group_id', groupId)
          .eq('user_id', myUserId)
          .maybeSingle();
        const meRow = me as {
          solo?: boolean;
          subgroup_id?: string | null;
          role?: string;
        } | null;

        const isCommand =
          opts.category === 'leaderCommands' || opts.category === 'followerRequests';
        // Leader-only events (member arrival) must reach captains even in a subgroup.
        const isLeaderOnlyEvent = opts.eventKind === 'member_arrival';
        // Solo/subgroup mute only when we successfully read memberships.
        if (!soloErr && meRow?.solo) return;
        if (!soloErr && !isCommand && !isLeaderOnlyEvent && meRow?.subgroup_id != null) return;

        // Role: trust DB row when present; on select error/null fall back to
        // session isLeaderRef so leader_only (request_start) is not dropped.
        const roleFromRow =
          meRow?.role === 'leader'
            ? 'leader'
            : meRow?.role === 'follower'
              ? 'follower'
              : null;
        const role: PolicyMember['role'] =
          roleFromRow
          ?? (isLeaderRef.current ? 'leader' : 'follower');

        // Client-side matrix mirror for recipient eligibility (this device only).
        const selfMember: PolicyMember = {
          userId: myUserId,
          role,
          subgroupId: meRow?.subgroup_id ?? null,
          // On select error, do not invent solo=true (would mute everything).
          solo: soloErr ? false : Boolean(meRow?.solo),
        };
        // Include a stub sender so scope rules can compare subgroup_id.
        const senderStub: PolicyMember = {
          userId: opts.senderId,
          role: 'follower',
          subgroupId: meRow?.subgroup_id ?? null,
          solo: false,
        };

        // Dual-path identity — must match send-push eventIdFromPayload.
        const eventIdentity = buildAlignedNotificationEventId({
          category: opts.pushCategory
            ?? (opts.category === 'leaderCommands'
              ? 'leader_commands'
              : opts.category === 'followerRequests'
                ? 'follower_requests'
                : opts.category === 'addGathering'
                  ? 'add_gathering'
                  : opts.category === 'journey'
                    ? 'journey'
                    : opts.eventKind),
          groupId,
          type: opts.commandType,
          senderId: opts.senderId,
          entityId: opts.entityId,
          status: opts.status,
          title: opts.titleKey,
          version: opts.version,
        });

        const policy = resolveNotificationRecipients({
          event: opts.eventKind,
          senderId: opts.senderId,
          members: [selfMember, senderStub],
          commandType: opts.commandType,
          eventId: eventIdentity,
        });

        // If matrix says this user is not a recipient, skip.
        if (!policy.recipientIds.includes(myUserId)) return;

        const prefs = await getNotificationPreferences();
        if (!prefs[opts.category]) return;

        if (
          !shouldDeliverOnce(seen, eventIdentity, myUserId, 'realtime')
        ) {
          return;
        }

        await notifications.scheduleLocalNotification({
          title: opts.title,
          body: opts.body,
          data: {
            category: opts.category,
            groupId,
            eventId: eventIdentity,
            senderId: opts.senderId,
            type: opts.commandType ?? undefined,
          },
        });
      } catch {
        // best-effort
      }
    };

    const groupFilter = `group_id=eq.${groupId}`;
    const idFilter = `id=eq.${groupId}`;

    const subId = ++channelSeq;
    const channel = supabase
      .channel(`notif:${groupId}:${subId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'commands', filter: groupFilter },
        (payload) => {
          const row = payload.new as {
            id?: string;
            sender_id: string;
            type: CommandType;
            message: string | null;
          };
          if (row.sender_id === myUserId) return; // never notify the sender
          if (row.type === 'request_start' && !isLeaderRef.current) return;
          void (async () => {
            const [{ data: senderMem }, { data: senderProfile }] = await Promise.all([
              row.type === 'custom'
                ? supabase
                  .from('memberships')
                  .select('role')
                  .eq('group_id', groupId)
                  .eq('user_id', row.sender_id)
                  .maybeSingle()
                : Promise.resolve({ data: { role: isLeaderCommand(row.type) ? 'leader' : 'follower' } }),
              supabase.from('profiles').select('nickname').eq('id', row.sender_id).maybeSingle(),
            ]);
            const role = (senderMem as { role?: string } | null)?.role;
            // Only explicit leader; missing/error must not drift to leaderCommands.
            const senderRole = role === 'leader' ? 'leader' : role === 'follower' ? 'follower' : null;
            const classified = resolveCommandNotificationClass(row.type, senderRole);
            const label = row.type === 'custom'
              ? tRef.current('map.cmdTitle')
              : tRef.current(`command.${row.type}` as const);
            const senderName = (senderProfile as { nickname?: string } | null)?.nickname?.trim();
            const title = senderName
              || (classified.prefCategory === 'leaderCommands'
                ? tRef.current('notif.leaderTitle', { label })
                : tRef.current('notif.memberTitle', { label }));
            await fire({
              category: classified.prefCategory,
              title,
              body: row.message?.trim() || label,
              eventKind: classified.policyEvent,
              senderId: row.sender_id,
              // Prefer command row id (also sent as entity_id on push); fallback type:sender.
              entityId: row.id ?? undefined,
              commandType: row.type,
              pushCategory: classified.pushCategory,
            });
          })();
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'itinerary_items', filter: groupFilter },
        (payload) => {
          const row = payload.new as {
            id?: string;
            created_by: string | null;
            title: string;
          };
          if (row.created_by === myUserId) return;
          void (async () => {
            const { data: senderProfile } = row.created_by
              ? await supabase.from('profiles').select('nickname').eq('id', row.created_by).maybeSingle()
              : { data: null };
            const senderName = (senderProfile as { nickname?: string } | null)?.nickname?.trim();
            await fire({
              category: 'addGathering',
              title: senderName
                ? `${senderName} ${tRef.current('notif.addGatheringTitle')}`
                : tRef.current('notif.addGatheringTitle'),
              body: row.title
                ? tRef.current('notif.addGatheringBody', { title: row.title })
                : tRef.current('notif.addGatheringBody', { title: tRef.current('map.gatheringPoints') }),
              eventKind: 'add_gathering',
              senderId: row.created_by ?? 'unknown',
              entityId: row.id ?? undefined,
              titleKey: row.title,
              pushCategory: 'add_gathering',
            });
          })();
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'group_alerts', filter: groupFilter },
        (payload) => {
          // group_alerts.sender_id = leader who reported (matches notify_push).
          const row = payload.new as {
            id?: string;
            kind?: string;
            member_name?: string;
            distance_m?: number | null;
            sender_id?: string | null;
            member_id?: string | null;
          };
          if (row.kind !== 'straggler') return;
          const name = row.member_name?.trim() || tRef.current('group.travelerFallback');
          const distance = typeof row.distance_m === 'number'
            ? `${Math.round(row.distance_m)} m`
            : '';
          void fire({
            category: 'journey',
            title: tRef.current('straggler.notifyTitle'),
            body: tRef.current('straggler.banner', { name, distance }),
            eventKind: 'straggler',
            // Dual-path: same sender segment as send-push payload.sender_id.
            senderId: row.sender_id ?? 'unknown',
            entityId: row.id ?? undefined,
            pushCategory: 'straggler',
          });
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'groups', filter: idFilter },
        (payload) => {
          const next = payload.new as {
            journey_status: string;
            active_destination_id?: string | null;
            journey_started_at?: string | null;
          };
          const prev = payload.old as { journey_status?: string };
          if (next.journey_status === prev?.journey_status) return;
          // Operator local confirm is client-side after startSession — not here.
          if (isLeaderRef.current) return;
          const going = next.journey_status === 'going';
          void (async () => {
            const [{ data: leader }, { data: destination }] = await Promise.all([
              supabase.from('memberships').select('user_id').eq('group_id', groupId).eq('role', 'leader').limit(1).maybeSingle(),
              next.active_destination_id
                ? supabase.from('itinerary_items').select('title').eq('id', next.active_destination_id).maybeSingle()
                : Promise.resolve({ data: null }),
            ]);
            const leaderId = (leader as { user_id?: string } | null)?.user_id ?? 'leader';
            const { data: leaderProfile } = leaderId !== 'leader'
              ? await supabase.from('profiles').select('nickname').eq('id', leaderId).maybeSingle()
              : { data: null };
            const name = (leaderProfile as { nickname?: string } | null)?.nickname?.trim() || tRef.current('notif.leaderTitle', { label: '' }).replace(/[:：]\s*$/, '');
            const title = (destination as { title?: string } | null)?.title?.trim() || tRef.current('map.gatheringPoints');
            await fire({
              category: 'journey',
              title: going ? tRef.current('notif.journeyGoingTitle') : tRef.current('notif.journeyPausedTitle'),
              body: tRef.current(going ? 'notif.journeyGoingBody' : 'notif.journeyPausedBody', { name, title }),
              eventKind: 'exception',
              senderId: leaderId,
              entityId: undefined,
              status: next.journey_status,
              pushCategory: 'journey',
            });
          })();
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'destination_arrivals',
          filter: groupFilter,
        },
        (payload) => {
          // Ticket 03 / CR P1: Realtime fallback when APNs/FCM unavailable.
          // INSERT-only matches push trigger (re-saves use ON CONFLICT DO NOTHING).
          const row = payload.new as {
            id?: string;
            user_id?: string;
            destination_id?: string | null;
            group_id?: string;
            source?: string | null;
          };
          const arriverId = row.user_id;
          if (!arriverId || arriverId === myUserId) return;
          // Leaders only (policy matrix also enforces; early gate saves prefs I/O).
          if (!isLeaderRef.current) return;
          void (async () => {
            const [{ data: memberProfile }, { data: destination }] = await Promise.all([
              supabase.from('profiles').select('nickname').eq('id', arriverId).maybeSingle(),
              row.destination_id
                ? supabase.from('itinerary_items').select('title').eq('id', row.destination_id).maybeSingle()
                : Promise.resolve({ data: null }),
            ]);
            const name = (memberProfile as { nickname?: string } | null)?.nickname?.trim()
              || tRef.current('group.travelerFallback');
            const title = (destination as { title?: string } | null)?.title?.trim()
              || tRef.current('map.gatheringPoints');
            await fire({
              category: 'journey',
              title: tRef.current('notif.memberArrivalTitle', { name }),
              body: tRef.current('notif.memberArrivalBody', { name, title }),
              eventKind: 'member_arrival',
              senderId: arriverId,
              // Keep destination_id as the event identity segment, matching push.
              // send-push uses member_id when destination_id is absent;
              // preserve that same fallback for Realtime deduplication.
              entityId: row.destination_id ?? arriverId,
              commandType: row.source ?? undefined,
              pushCategory: 'arrival',
            });
          })();
        },
      )
      .subscribe();

    return () => {
      unsubPush();
      supabase.removeChannel(channel);
    };
  }, [groupId, myUserId]);
}
