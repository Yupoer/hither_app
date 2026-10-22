import { createElement, Fragment, useCallback, useMemo, useState } from 'react';
import { useMountEffect } from '../../../hooks/useMountEffect';
import { Alert } from 'react-native';
import { getNotificationPreferences, setNotificationPreferences, setSolo } from '../../../api/client';
import type { TranslationKey } from '../../../i18n';
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences, type Destination, type DestinationArrival, type MemberLocation, type User } from '../../../types';
import type { DirectionsResult } from '../../../native';
import { distanceMeters, etaSecondsFor, formatDistance, type TravelMode } from '../../../utils/geo';
import { shortEta } from '../../../utils/mapFormatters';
import { glass, memberColor } from '../../../glass';
import { locationSharingConfirmCopy } from '../memberStatusSharing';
import { applyPresenceMacroWrites, derivePresenceMacro, presenceMacroWrites, type PresenceMacroKind } from '../../../utils/presenceMacros';
import { logEvent, logError } from '../../../utils/activityLog';
import { lightTap, selectionTick } from '../../../utils/haptics';
import { confirmAction } from '../../../utils/confirm';

export interface UseMemberPresenceInput {
  groupId: string | null;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  uiVisible: boolean;
  members: MemberLocation[];
  user: User | null;
  activePoint: Destination | undefined;
  memberRoutes: Record<string, DirectionsResult>;
  travelMode: TravelMode;
  navTarget: Destination | undefined;
  activeDestinationArrivals: DestinationArrival[];
  deviceCoordsAcceptedAtMs: number | null;
  myScopeId: string | undefined;
  sharingEnabled: boolean;
  handleSharingEnabledChange: (enabled: boolean) => Promise<boolean>;
}

export function useMemberPresence({
  groupId,
  t,
  uiVisible,
  members,
  user,
  activePoint,
  memberRoutes,
  travelMode,
  navTarget,
  activeDestinationArrivals,
  deviceCoordsAcceptedAtMs,
  myScopeId,
  sharingEnabled,
  handleSharingEnabledChange,
}: UseMemberPresenceInput) {
  const [statusApplying, setStatusApplying] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences>(
    DEFAULT_NOTIFICATION_PREFERENCES,
  );
  const [appliedMacro, setAppliedMacro] = useState<PresenceMacroKind | null>(null);
  // --- Solo mode (global user status — not on member cards) -----------------
  // Returns false if the RPC failed (caller should not close the status sheet).
  const toggleSolo = useCallback(async (next: boolean): Promise<boolean> => {
    if (!groupId) return false;
    selectionTick();
    logEvent('solo_toggle', { groupId, next });
    setSoloOverride(next);
    try {
      await setSolo(groupId, next);
      // memberships is realtime-subscribed (useGroupState); its debounced
      // reload refreshes `members` and clears the override above once it
      // matches — no need to force an extra fetch here.
      return true;
    } catch (e) {
      logError('solo_toggle_failed', e, { groupId, next });
      setSoloOverride(null);
      Alert.alert(t('solo.failed'), e instanceof Error ? e.message : undefined);
      return false;
    }
  }, [groupId, t]);


  // --- Derived view models --------------------------------------------------
  // Optimistic flip for the Solo switch — server round trip + realtime
  // refetch otherwise take long enough to read as the switch not responding,
  // especially when you're the only row in the flock. Cleared once `members`
  // (server truth) confirms it, below.
  const [soloOverride, setSoloOverride] = useState<boolean | null>(null);

  const flock = useMemo(
    () =>
      (uiVisible ? members : []).map((m) => {
        const isSelf = m.userId === user?.id;
        // Gathering-point distance still drives the arrived/en-route STATUS.
        const d =
          m.coordinates && activePoint
            ? distanceMeters(m.coordinates, activePoint.coordinates)
            : null;
        // Displayed distance/ETA is "how far this member is from ME" — more
        // useful for keeping the flock together than distance-to-destination.
        const memberRoute = memberRoutes[m.userId];
        const displayedDistance = memberRoute?.distanceMeters ?? d;
        const displayedEta = memberRoute?.expectedTravelTimeSeconds
          ?? (d != null ? etaSecondsFor(d, travelMode) : null);
        const point = navTarget ?? activePoint;
        const arrived = Boolean(point && (m.subgroupId ?? null) === (point.subgroupId ?? null)
          && activeDestinationArrivals.some(a => a.destinationId === point.id && a.userId === m.userId));
        const isMemberLeader = m.role === 'leader';
        // Member status strings that depend on "how recent is lastUpdated" are
        // resolved in FlockRow (30s local tick) so MapScreen is not on a timer.
        const solo =
          m.userId === user?.id && soloOverride !== null ? soloOverride : !!m.solo;
        return {
          userId: m.userId,
          name: (isSelf && user?.name) || m.name || t('group.travelerFallback'),
          // BUG-08: prefer session profile for self so a just-saved avatar
          // shows in the flock before realtime memberships refresh.
          avatar: (isSelf && user?.avatar) || m.avatar,
          avatarColor: (isSelf && user?.avatarColor) || m.avatarColor || memberColor(m.userId),
          solo,
          subgroupId: m.subgroupId,
          // Prefer the member's chosen avatar background colour; fall back to the
          // deterministic per-user colour when they haven't picked one.
          color: (isSelf && user?.avatarColor) || m.avatarColor || memberColor(m.userId),
          isLeader: isMemberLeader,
          arrived,
          // Self row: prefer latest accepted local sample so refresh/push does
          // not leave「尚無位置更新」when blue-dot already has a valid fix.
          lastUpdated: m.capturedAt ?? m.lastUpdated,
          sharingEnabled: m.sharingEnabled,
          locationTrackingMode: m.locationTrackingMode,
          locationSource: m.locationSource,
          locationNavigationSessionId: m.locationNavigationSessionId,
          // Color grade: secondary by default; green only arrived; warn only solo/straggler-like.
          statusColor: solo
            ? glass.warn
            : arrived
              ? glass.ok
              : glass.textSecondary,
          // "—" for my own row (distance to myself is meaningless); everyone
          // else shows how far they are from me.
          eta: displayedEta != null ? shortEta(displayedEta) : '',
          dist: isSelf
            ? ''
            : displayedDistance != null
              ? formatDistance(displayedDistance)
              : '',
        };
      }),
    [
      uiVisible,
      members,
      activePoint,
      navTarget,
      activeDestinationArrivals,
      t,
      user?.id,
      user?.name,
      user?.avatar,
      user?.avatarColor,
      soloOverride,
      memberRoutes,
      travelMode,
      deviceCoordsAcceptedAtMs,
    ],
  );

  // Drop the override once the server value catches up, so a later toggle
  // (from this device or another) isn't masked by a stale optimistic flip.
  const soloOverrideConvergenceLifecycle = createElement(SoloOverrideConvergence, { soloOverride, members, user, setSoloOverride });

  // My own subgroup, if any — gates the "invite a teammate" entry on my card.
  const mySubgroupId = myScopeId;

  const mySoloActive = useMemo(() => {
    if (soloOverride !== null) return soloOverride;
    return !!members.find((m) => m.userId === user?.id)?.solo;
  }, [soloOverride, members, user?.id]);

  const memberNotificationPreferencesLoadLifecycle = createElement(MemberNotificationPreferencesLoad, { setNotifPrefs, user });

  const derivedMacro = derivePresenceMacro({
    solo: mySoloActive,
    locationSharing: sharingEnabled,
    notifications: notifPrefs,
  });
  const myStatusKind: PresenceMacroKind = appliedMacro ?? derivedMacro;

  const statusMenuItems = useMemo(
    () => [
      {
        id: 'follow' as const,
        title: t('solo.followTeam'),
        subtitle: t('solo.followTeamHint'),
        selected: myStatusKind === 'follow',
      },
      {
        id: 'solo' as const,
        title: t('solo.switch'),
        subtitle: t('solo.soloHint'),
        selected: myStatusKind === 'solo',
      },
      {
        id: 'stealth' as const,
        title: t('solo.stealth'),
        subtitle: t('solo.stealthHint'),
        selected: myStatusKind === 'stealth',
      },
    ],
    [myStatusKind, t],
  );

  const applyPresenceMacroKind = useCallback(
    async (next: PresenceMacroKind): Promise<boolean> => {
      if (statusApplying) return false;
      lightTap();
      const current = {
        solo: mySoloActive,
        locationSharing: sharingEnabled,
        notifications: notifPrefs,
      };
      const writes = presenceMacroWrites(next, current);
      setStatusApplying(true);
      try {
        const ok = await applyPresenceMacroWrites(writes, current, {
          setSolo: toggleSolo,
          applyNotifications: async (nextPrefs) => {
            setNotifPrefs(nextPrefs);
            await setNotificationPreferences(nextPrefs);
          },
          disableLocationSharing: () =>
            new Promise<boolean>((resolve) => {
              const copy = locationSharingConfirmCopy(false);
              confirmAction({
                title: t(copy.titleKey),
                message: t(copy.bodyKey),
                destructive: copy.destructive,
              }, () => {
                void handleSharingEnabledChange(false).then((result) => resolve(result !== false));
              }, () => resolve(false));
            }),
        });
        if (!ok) return false;
        setAppliedMacro(next);
        return true;
      } catch {
        return false;
      } finally {
        setStatusApplying(false);
      }
    },
    [
      statusApplying,
      mySoloActive,
      sharingEnabled,
      notifPrefs,
      toggleSolo,
      handleSharingEnabledChange,
      t,
    ],
  );

  const openAndroidStatusSheet = useCallback(() => {
    lightTap();
    Alert.alert(
      t('solo.statusTitle'),
      statusMenuItems.map((item) => `${item.title}\n${item.subtitle}`).join('\n\n'),
      [
        ...statusMenuItems.map((item) => ({
          text: item.selected ? `${item.title} ✓` : item.title,
          onPress: () => {
            void applyPresenceMacroKind(item.id);
          },
        })),
        { text: t('common.cancel'), style: 'cancel' as const },
      ],
    );
  }, [applyPresenceMacroKind, statusMenuItems, t]);

  return {
    lifecycle: createElement(Fragment, { key: 'member-presence-runtime' }, soloOverrideConvergenceLifecycle, memberNotificationPreferencesLoadLifecycle), flock, mySoloActive, myStatusKind, statusMenuItems, applyPresenceMacroKind, openAndroidStatusSheet, mySubgroupId };
}

function SoloOverrideConvergence({ soloOverride, members, user, setSoloOverride }: {
  soloOverride: boolean | null;
  members: MemberLocation[];
  user: User | null;
  setSoloOverride: import("react").Dispatch<import("react").SetStateAction<boolean | null>>;
}) {
  const [soloOverrideConvergenceInputs, setSoloOverrideConvergenceInputs] = useState(() => ({ generation: 0, members, soloOverride, user_id: user?.id }));
  if (!(Object.is(soloOverrideConvergenceInputs.members, members) && Object.is(soloOverrideConvergenceInputs.soloOverride, soloOverride) && Object.is(soloOverrideConvergenceInputs.user_id, user?.id))) {
    setSoloOverrideConvergenceInputs({ generation: soloOverrideConvergenceInputs.generation + 1, members, soloOverride, user_id: user?.id });
  }
  return createElement(SoloOverrideConvergenceCommit, { key: soloOverrideConvergenceInputs.generation, soloOverride, members, user, setSoloOverride });
}

function SoloOverrideConvergenceCommit({ soloOverride, members, user, setSoloOverride }: {
  soloOverride: boolean | null;
  members: MemberLocation[];
  user: User | null;
  setSoloOverride: import("react").Dispatch<import("react").SetStateAction<boolean | null>>;
}) {
  useMountEffect(() => {
    if (soloOverride === null) return;
    const mine = members.find((m) => m.userId === user?.id);
    if (mine && !!mine.solo === soloOverride) setSoloOverride(null);
  });
  return null;
}

function MemberNotificationPreferencesLoad({ setNotifPrefs, user }: {
  setNotifPrefs: import("react").Dispatch<import("react").SetStateAction<NotificationPreferences>>;
  user: User | null;
}) {
  const [memberNotificationPreferencesLoadInputs, setMemberNotificationPreferencesLoadInputs] = useState(() => ({ generation: 0, user_id: user?.id }));
  if (!(Object.is(memberNotificationPreferencesLoadInputs.user_id, user?.id))) {
    setMemberNotificationPreferencesLoadInputs({ generation: memberNotificationPreferencesLoadInputs.generation + 1, user_id: user?.id });
  }
  return createElement(MemberNotificationPreferencesLoadCommit, { key: memberNotificationPreferencesLoadInputs.generation, setNotifPrefs, user });
}

function MemberNotificationPreferencesLoadCommit({ setNotifPrefs, user }: {
  setNotifPrefs: import("react").Dispatch<import("react").SetStateAction<NotificationPreferences>>;
  user: User | null;
}) {
  useMountEffect(() => {
    let alive = true;
    void getNotificationPreferences()
      .then((prefs) => {
        if (alive) setNotifPrefs(prefs);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  });
  return null;
}
