import { createElement, Fragment, useCallback, useMemo, useState } from 'react';
import { useMountEffect } from '../../../hooks/useMountEffect';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchSentInvites, inviteToSubgroup, selfMerge, selfSplit } from '../../../api/client';
import { isDemoGroup } from '../../../api/demo';
import type { TranslationKey } from '../../../i18n';
import { useSubgroupInvites } from '../../../state/useSubgroupInvites';
import type { MemberLocation, Subgroup } from '../../../types';
import { logError, logEvent } from '../../../utils/activityLog';
import { mediumTap, selectionTick } from '../../../utils/haptics';
import type { GroupReloadReason } from '../../../utils/syncAuthority';

/** Persisted "don't warn me again" flag for the leave-the-main-group notice. */
export const LEAVE_GROUP_WARN_KEY = 'hither.subgroupLeaveWarnDismissed';
const SENT_INVITES_POLL_MS = 15_000;

export interface UseSubgroupActionsInput {
  groupId: string | null;
  userName: string | undefined;
  members: MemberLocation[];
  allSubgroups: Subgroup[] | undefined;
  /** The subgroup I am in, if any; its pending sent invites are tracked. */
  mySubgroupId: string | undefined;
  refresh: (reason?: GroupReloadReason) => Promise<boolean>;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  /** Leaving my subgroup wipes subgroup-scoped UI. */
  onMergedBack: () => void;
}

/** Subgroup membership flows: invites in and out, split off, merge back. */
export function useSubgroupActions(input: UseSubgroupActionsInput) {
  const { groupId, userName, members, allSubgroups, mySubgroupId, refresh, t, onMergedBack } = input;
  // Drop empty leftovers so the members list never shows "X 的小隊 · 0" after
  // leave; server also deletes empty rows, this is the client-side safety net.
  const subgroups = useMemo(
    () => (allSubgroups ?? []).filter((sg) => members.some((m) => m.subgroupId === sg.id)),
    [allSubgroups, members],
  );
  const {
    invites: pendingInvites,
    accept: acceptInvite,
    decline: declineInvite,
    refresh: refreshInvites,
  } = useSubgroupInvites();

  // Invites I've sent for my subgroup that are still pending — shown on the
  // card so "I invited someone" doesn't just look like nothing happened while
  // they haven't accepted yet.
  const [sentInvites, setSentInvites] = useState<{ id: string; inviteeName: string }[]>([]);
  const refreshSentInvites = useCallback(async (subgroupId: string | undefined) => {
    if (!subgroupId) {
      setSentInvites([]);
      return;
    }
    try {
      setSentInvites(await fetchSentInvites(subgroupId));
    } catch {
      // best-effort
    }
  }, []);
  const sentSubgroupInvitesLoadLifecycle = createElement(SentSubgroupInvitesLoad, { refreshSentInvites, mySubgroupId });
  // BUG-22: when invitee accepts/declines, inviter's pending list must drop
  // the row without a manual refresh — poll only while invites are outstanding
  // (membership realtime already covers accept → members.length change).
  const sentSubgroupInvitesPollLifecycle = createElement(SentSubgroupInvitesPoll, { mySubgroupId, sentInvites, refreshSentInvites, members });

  // Leaving the main "組隊伍" (by creating or joining a subteam) hides the
  // shared gathering-point cards. Warn once per action unless the user has
  // ticked "don't show again". Resolves true = proceed (both buttons proceed;
  // only the dismiss button silences future warnings).
  const confirmLeaveMainGroup = useCallback(async (): Promise<boolean> => {
    const dismissed = await AsyncStorage.getItem(LEAVE_GROUP_WARN_KEY);
    if (dismissed === '1') return true;
    return new Promise((resolve) => {
      Alert.alert(
        t('subgroup.leaveWarnTitle'),
        t('subgroup.leaveWarnBody'),
        [
          {
            text: t('subgroup.leaveWarnDontShow'),
            onPress: () => {
              void AsyncStorage.setItem(LEAVE_GROUP_WARN_KEY, '1');
              resolve(true);
            },
          },
          { text: t('subgroup.leaveWarnConfirm'), onPress: () => resolve(true) },
        ],
        { cancelable: false },
      );
    });
  }, [t]);

  const handleAcceptInvite = useCallback(async (inviteId: string) => {
    if (!(await confirmLeaveMainGroup())) return;
    mediumTap();
    logEvent('invite_accept', { inviteId });
    try {
      await acceptInvite(inviteId);
      logEvent('invite_accept_ok', { inviteId });
      await refresh('membership_change');
    } catch (e) {
      logError('invite_accept_failed', e, { inviteId });
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
    }
  }, [confirmLeaveMainGroup, acceptInvite, refresh, t]);

  const handleDeclineInvite = useCallback(async (inviteId: string) => {
    selectionTick();
    logEvent('invite_decline', { inviteId });
    try {
      await declineInvite(inviteId);
    } catch (e) {
      logError('invite_decline_failed', e, { inviteId });
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
    }
  }, [declineInvite, t]);

  const handleInvite = useCallback(async (subgroupId: string, inviteeId: string) => {
    mediumTap();
    logEvent('invite_send', { subgroupId, inviteeId });
    try {
      await inviteToSubgroup(subgroupId, inviteeId);
      logEvent('invite_send_ok', { subgroupId, inviteeId });
      // Demo has no realtime channel to nudge the invite list, and simulates
      // the invitee replying with a join-request — pull it in so the pending
      // approve/decline card shows immediately.
      if (isDemoGroup(groupId)) refreshInvites();
      void refreshSentInvites(subgroupId);
      Alert.alert(t('subgroup.inviteSent'));
    } catch (e) {
      logError('invite_send_failed', e, { subgroupId, inviteeId });
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
    }
  }, [t, groupId, refreshInvites, refreshSentInvites]);

  // Any member can split themselves into their own new (collab, no-leader)
  // subgroup, or merge themselves back up a level — no leader say-so needed.
  // Returns false if the user cancelled the leave warning or the RPC failed.
  const doSelfSplit = useCallback(async (): Promise<boolean> => {
    if (!groupId) return false;
    if (!(await confirmLeaveMainGroup())) return false;
    mediumTap();
    logEvent('team_create', { groupId });
    try {
      await selfSplit(groupId, t('subgroup.selfSplitName', { name: userName ?? t('group.travelerFallback') }));
      logEvent('team_create_ok', { groupId });
      refresh();
      return true;
    } catch (e) {
      logError('team_create_failed', e, { groupId });
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
      return false;
    }
  }, [groupId, confirmLeaveMainGroup, userName, t, refresh]);

  const doSelfMerge = useCallback(async (): Promise<boolean> => {
    if (!groupId) return false;
    selectionTick();
    logEvent('team_leave', { groupId });
    try {
      await selfMerge(groupId);
      logEvent('team_leave_ok', { groupId });
      onMergedBack();
      await refresh();
      return true;
    } catch (e) {
      logError('team_leave_failed', e, { groupId });
      Alert.alert(t('subgroup.failed'), e instanceof Error ? e.message : undefined);
      return false;
    }
  }, [groupId, onMergedBack, refresh, t]);

  return {
    lifecycle: createElement(Fragment, { key: 'subgroup-actions-runtime' }, sentSubgroupInvitesLoadLifecycle, sentSubgroupInvitesPollLifecycle),
    subgroups,
    pendingInvites,
    sentInvites,
    handleAcceptInvite,
    handleDeclineInvite,
    handleInvite,
    doSelfSplit,
    doSelfMerge,
  };
}

function SentSubgroupInvitesLoad({ refreshSentInvites, mySubgroupId }: {
  refreshSentInvites: (subgroupId: string | undefined) => Promise<void>;
  mySubgroupId: string | undefined;
}) {
  const [sentSubgroupInvitesLoadInputs, setSentSubgroupInvitesLoadInputs] = useState(() => ({ generation: 0, mySubgroupId, refreshSentInvites }));
  if (!(Object.is(sentSubgroupInvitesLoadInputs.mySubgroupId, mySubgroupId) && Object.is(sentSubgroupInvitesLoadInputs.refreshSentInvites, refreshSentInvites))) {
    setSentSubgroupInvitesLoadInputs({ generation: sentSubgroupInvitesLoadInputs.generation + 1, mySubgroupId, refreshSentInvites });
  }
  return createElement(SentSubgroupInvitesLoadCommit, { key: sentSubgroupInvitesLoadInputs.generation, refreshSentInvites, mySubgroupId });
}

function SentSubgroupInvitesLoadCommit({ refreshSentInvites, mySubgroupId }: {
  refreshSentInvites: (subgroupId: string | undefined) => Promise<void>;
  mySubgroupId: string | undefined;
}) {
  useMountEffect(() => {
    void refreshSentInvites(mySubgroupId);
  });
  return null;
}

function SentSubgroupInvitesPoll({ mySubgroupId, sentInvites, refreshSentInvites, members }: {
  mySubgroupId: string | undefined;
  sentInvites: { id: string; inviteeName: string; }[];
  refreshSentInvites: (subgroupId: string | undefined) => Promise<void>;
  members: MemberLocation[];
}) {
  const [sentSubgroupInvitesPollInputs, setSentSubgroupInvitesPollInputs] = useState(() => ({ generation: 0, mySubgroupId, refreshSentInvites, sentInvites_length: sentInvites.length, members_length: members.length }));
  if (!(Object.is(sentSubgroupInvitesPollInputs.mySubgroupId, mySubgroupId) && Object.is(sentSubgroupInvitesPollInputs.refreshSentInvites, refreshSentInvites) && Object.is(sentSubgroupInvitesPollInputs.sentInvites_length, sentInvites.length) && Object.is(sentSubgroupInvitesPollInputs.members_length, members.length))) {
    setSentSubgroupInvitesPollInputs({ generation: sentSubgroupInvitesPollInputs.generation + 1, mySubgroupId, refreshSentInvites, sentInvites_length: sentInvites.length, members_length: members.length });
  }
  return createElement(SentSubgroupInvitesPollCommit, { key: sentSubgroupInvitesPollInputs.generation, mySubgroupId, sentInvites, refreshSentInvites, members });
}

function SentSubgroupInvitesPollCommit({ mySubgroupId, sentInvites, refreshSentInvites, members }: {
  mySubgroupId: string | undefined;
  sentInvites: { id: string; inviteeName: string; }[];
  refreshSentInvites: (subgroupId: string | undefined) => Promise<void>;
  members: MemberLocation[];
}) {
  useMountEffect(() => {
    if (!mySubgroupId || sentInvites.length === 0) return;
    const id = setInterval(() => {
      void refreshSentInvites(mySubgroupId);
    }, SENT_INVITES_POLL_MS);
    return () => clearInterval(id);
  });
  return null;
}
