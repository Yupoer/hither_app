import { useForegroundClock } from '../../../state/foregroundUi';
import { locationFreshness, resolveSelfAwareLastUpdated } from '../../../utils/locationFreshness';
import { APP_TEXT_SIZE } from '../../../theme/typeScale';
import React, { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../../../components/AppText';
import Pressable from '../../../components/MotionPressable';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { avatarColorForGroup, avatarForGroup, displayMemberAvatar } from '../../../constants/avatars';
import { accentMix, memberColor } from '../../../glass';
import { useTranslation, type TranslationKey } from '../../../i18n';
import { NativeMenuHost, type NativeMenuItem } from '../../../native/menu';
import SheetHeaderAction from '../../../components/SheetHeaderAction';
import { MAP_SHEET_ACTION_HIT_SIZE } from '../../../components/mapSheetChrome';
import MemberStatusMenu from './MemberStatusMenu';
import type { Group, MemberLocation, PendingInvite, Subgroup } from '../../../types';
import { selectionTick } from '../../../utils/haptics';
import type { PresenceMacroKind } from '../../../utils/presenceMacros';
import {
  D6_MEMBER_STATUS_COLORS,
  getD6MemberStatus,
  getD6SubgroupPresentation,
  type D6MemberStatus,
} from '../d6TeamPresentation';
import type { UseCoordinationRequestsResult } from '../hooks/useCoordinationRequests';
import { MemberInboxBadge } from './MemberInboxBadge';

type TeamMember = Pick<MemberLocation, 'userId' | 'name' | 'avatar' | 'subgroupId' | 'sharingEnabled' | 'lastUpdated'>
  & { color: string; dist: string; arrived: boolean; isLeader: boolean };

const STATUS_LABELS: Record<D6MemberStatus, TranslationKey> = {
  follow: 'd6.team.statusFollow',
  solo: 'd6.team.statusSolo',
  stealth: 'solo.stealth',
};

const STATUS_TITLES: Record<D6MemberStatus, TranslationKey> = {
  follow: 'solo.followTeam',
  solo: 'solo.switch',
  stealth: 'solo.stealth',
};

export interface D6MembersPaneProps {
  accent: string;
  onAccent: string;
  group: Group | null;
  isNewTeam?: boolean;
  showHeader?: boolean;
  selfSampleAtMs?: number | null;
  locationWarning?: string | null;
  onLocationRecovery?: () => void;
  displayFont?: string;
  flock: readonly TeamMember[];
  myUserId: string | undefined;
  myStatusKind: PresenceMacroKind;
  sharingEnabled: boolean;
  statusMenuItems: readonly NativeMenuItem[];
  applyPresenceMacroKind: (kind: PresenceMacroKind) => Promise<boolean>;
  onEnableSharing: () => Promise<boolean>;
  onTemporarilyLeave: () => Promise<boolean>;
  mySubgroupId: string | undefined;
  subgroups: readonly Subgroup[];
  pendingInvites: readonly PendingInvite[];
  sentInvites: readonly { id: string; inviteeName: string }[];
  coordination: UseCoordinationRequestsResult;
  onOpenTeamSettings: () => void;
  onInviteTeam: () => void;
  onAcceptInvite: (id: string) => Promise<void>;
  onDeclineInvite: (id: string) => Promise<void>;
  onInviteToSubgroup: () => void;
  onLeaveSubgroup: () => Promise<boolean>;
  onStartSplit: () => void;
  selectedMemberIds: readonly string[] | null;
  onToggleMember: (id: string) => void;
  onLocateMember: (id: string) => void;
  onKickMember?: (member: Pick<TeamMember, 'userId' | 'name'>) => void;
  memberInbox: ReadonlyMap<string, { count: number }>;
  onOpenMemberInbox: (id: string) => void;
}

export function D6MembersPane({
  accent,
  onAccent,
  group,
  isNewTeam,
  showHeader = true,
  selfSampleAtMs, locationWarning, onLocationRecovery,
  displayFont,
  flock,
  myUserId,
  myStatusKind,
  sharingEnabled,
  statusMenuItems,
  applyPresenceMacroKind,
  onEnableSharing,
  onTemporarilyLeave,
  mySubgroupId,
  subgroups,
  pendingInvites,
  sentInvites,
  coordination,
  onOpenTeamSettings,
  onInviteTeam,
  onAcceptInvite,
  onDeclineInvite,
  onInviteToSubgroup,
  onLeaveSubgroup,
  onStartSplit,
  selectedMemberIds,
  onToggleMember,
  onLocateMember,
  onKickMember,
  memberInbox,
  onOpenMemberInbox,
}: D6MembersPaneProps) {
  const { t } = useTranslation();
  const clock = useForegroundClock(30_000);
  const reducedMotion = useReducedMotion();
  const applyingStatus = useRef(false);
  const respondingToInvite = useRef(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const picking = selectedMemberIds !== null;
  const myMember = flock.find(member => member.userId === myUserId);
  const status = getD6MemberStatus(myStatusKind, sharingEnabled);
  const statusItems: NativeMenuItem[] = (['follow', 'solo', 'stealth'] satisfies D6MemberStatus[]).map(id => ({
    id,
    title: t(STATUS_TITLES[id]),
    subtitle: statusMenuItems.find(item => item.id === id)?.subtitle,
    selected: status === id,
  }));

  async function changeStatus(next: string) {
    if (applyingStatus.current || next === status) return;
    if (next !== 'follow' && next !== 'solo' && next !== 'stealth') return;
    applyingStatus.current = true;
    try {
      if (next !== 'stealth' && !sharingEnabled && !(await onEnableSharing())) return;
      await applyPresenceMacroKind(next);
    } finally {
      applyingStatus.current = false;
    }
  }

  async function respondToInvite(id: string, accept: boolean) {
    if (respondingToInvite.current) return;
    respondingToInvite.current = true;
    setInviteBusy(true);
    try {
      await (accept ? onAcceptInvite(id) : onDeclineInvite(id));
    } finally {
      respondingToInvite.current = false;
      setInviteBusy(false);
    }
  }

  function renderMember(member: TeamMember) {
    const isMe = member.userId === myUserId;
    const name = isMe ? t('flock.you') : member.name;
    const memberId = member.userId;
    const inboxCount = memberInbox.get(memberId)?.count ?? 0;
    const hideLocation = isMe ? status === 'stealth' : member.sharingEnabled === false;
    const selected = selectedMemberIds?.includes(memberId) ?? false;
    const updated = resolveSelfAwareLastUpdated({ isSelf: isMe, remoteLastUpdated: member.lastUpdated, selfSampleAtMs });
    const age = locationFreshness(updated, clock.now);
    const freshnessLabel = hideLocation ? t('map.locationSharingStopped')
      : age.unit === 'minutes' ? t('locationUpdate.minutes', { minutes: age.value })
        : age.unit === 'hours' ? t('locationUpdate.hours', { hours: age.value }) : t(`locationUpdate.${age.unit}`);
    const identity = (
      <>
        <View style={styles.avatarSlot}>
          <TeamMemberAvatar member={member} dim={hideLocation} />
          {isMe ? (
            <View style={[styles.statusDot, { backgroundColor: D6_MEMBER_STATUS_COLORS[status] }]} />
          ) : inboxCount > 0 ? (
            <MemberInboxBadge count={inboxCount} style={styles.inboxBadge} testID={`member-inbox-badge-${memberId}`} />
          ) : null}
        </View>
        <View style={styles.memberIdentity}>
          <Text numberOfLines={2} style={styles.memberName}>{name}</Text>
          <Text style={styles.freshness} testID={`d6-member-updated-${memberId}`}>{freshnessLabel}</Text>
          {isMe && locationWarning ? <Pressable testID="d6-self-location-warning" onPress={onLocationRecovery}
            accessibilityRole="button" accessibilityLabel={locationWarning} style={styles.locationRecovery}>
            <Text style={styles.locationWarning}>{locationWarning}</Text>
          </Pressable> : null}
        </View>
      </>
    );

    if (picking) {
      return (
        <Pressable
          key={memberId}
          style={styles.memberRow}
          onPress={() => onToggleMember(memberId)}
          accessibilityRole="checkbox"
          accessibilityLabel={name}
          accessibilityState={{ checked: selected }}
          testID={`d6-subgroup-select-${memberId}`}
        >
          {identity}
          <View style={[styles.check, selected && { backgroundColor: accent, borderColor: accent }]}>
            {selected && <Ionicons name="checkmark" color={onAccent} size={16} />}
          </View>
        </Pressable>
      );
    }

    if (isMe) {
      return (
        <View key={memberId} style={styles.memberRow}>
          {identity}
          <MemberStatusMenu items={statusItems} onSelect={id => void changeStatus(id)}
            label={t(STATUS_LABELS[status])} accessibilityLabel={t('solo.statusCurrent', { status: t(STATUS_TITLES[status]) })}>
            <View style={styles.statusPill}>
              <Text style={styles.statusLabel}>{t(STATUS_LABELS[status])}</Text>
              <Ionicons name="chevron-down" size={13} color={muted} />
            </View>
          </MemberStatusMenu>
        </View>
      );
    }

    const actions: NativeMenuItem[] = [];
    if (!hideLocation) actions.push({ id: 'locate', title: t('d6.team.locate') });
    if (inboxCount > 0) actions.push({ id: 'inbox', title: t('memberInbox.open', { name, count: inboxCount }) });
    if (onKickMember && !member.isLeader) actions.push({ id: 'kick', title: t('group.kick') });
    const locationLabel = member.arrived ? t('d6.team.arrived') : !hideLocation && member.dist ? member.dist : '';
    const rowContent = (
      <>
        {identity}
        {locationLabel ? (
          <View style={styles.trailing}>
            {member.arrived && <View style={[styles.arrivedDot, { backgroundColor: accent }]} />}
            <Text style={member.arrived ? styles.arrivedText : styles.value}>{locationLabel}</Text>
          </View>
        ) : null}
      </>
    );
    if (actions.length === 0) return <View key={memberId} style={styles.memberRow}>{rowContent}</View>;
    return (
      <NativeMenuHost
        key={memberId}
        items={actions}
        onSelect={id => {
          if (id === 'locate') onLocateMember(memberId);
          if (id === 'inbox') onOpenMemberInbox(memberId);
          if (id === 'kick') onKickMember?.(member);
        }}
        accessibilityLabel={[name, locationLabel].filter(Boolean).join(', ')}
        testID={`d6-team-member-${memberId}`}
        style={styles.memberRow}
      >
        <View style={styles.menuRow} pointerEvents="none">{rowContent}</View>
      </NativeMenuHost>
    );
  }

  return (
    <View collapsable={false} testID="d6-members-pane" style={styles.pane}>
      {clock.lifecycle}
      {showHeader ? <D6TeamHeader group={group} onOpenTeamSettings={onOpenTeamSettings} onInviteTeam={onInviteTeam} /> : null}
      {myMember && !picking ? renderMember(myMember) : null}
      <ScrollView testID="d6-team-scroll" showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scrollContent}>
      {group && isNewTeam && myMember && flock.length === 1 && group.inviteCode ? (
        <View style={[styles.codeCard, { backgroundColor: accentMix(accent, 22) }]}>
          <Text
            selectable
            style={[styles.inviteCode, displayFont ? { fontFamily: displayFont } : styles.fallbackCodeFont]}
            adjustsFontSizeToFit
            numberOfLines={1}
          >
            {group.inviteCode}
          </Text>
          <Pressable
            style={[styles.inviteButton, { backgroundColor: accent }]}
            onPress={onInviteTeam}
            accessibilityRole="button"
            accessibilityLabel={t('map.inviteMembers')}
            testID="d6-team-invite-code"
          >
            <Ionicons name="share-outline" color={onAccent} size={17} />
            <Text style={[styles.inviteLabel, { color: onAccent }]}>{t('d6.team.invite')}</Text>
          </Pressable>
        </View>
      ) : null}
      {group && myMember && (
        <CoordinationVotes
          coordination={coordination}
          groupId={group.id}
          mySubgroupId={mySubgroupId}
          isLeader={myMember.isLeader}
        />
      )}
      {pendingInvites.filter(invite => invite.groupId === group?.id).map(invite => {
        const isRequest = invite.kind === 'request';
        const prompt = t(isRequest ? 'subgroup.requestPrompt' : 'd6.team.joinSubgroup', {
          name: invite.inviterName,
          team: invite.subgroupName,
        });
        const sender = flock.find(member => member.userId === invite.inviterId);
        const actorId = invite.inviterId;
        return (
          <View key={invite.id} style={[styles.card, styles.inviteCard]}>
            <View style={styles.inviteIdentity}>
              <TeamMemberAvatar member={sender ?? { userId: actorId, color: memberColor(actorId) }} />
              <Text style={styles.invitePrompt}>{prompt}</Text>
            </View>
            <View style={styles.inviteActions}>
              <Pressable
                style={styles.inviteButton}
                onPress={() => void respondToInvite(invite.id, false)}
                disabled={inviteBusy}
                accessibilityState={{ disabled: inviteBusy }}
                accessibilityRole="button"
                testID={`subgroup-invite-decline-${invite.id}`}
              >
                <Text style={styles.inviteLabel}>{t('subgroup.decline')}</Text>
              </Pressable>
              <Pressable
                style={[styles.inviteButton, styles.acceptButton]}
                onPress={() => void respondToInvite(invite.id, true)}
                disabled={inviteBusy}
                accessibilityState={{ disabled: inviteBusy }}
                accessibilityRole="button"
                testID={`subgroup-invite-accept-${invite.id}`}
              >
                <Text style={[styles.inviteLabel, styles.acceptLabel]}>{t(isRequest ? 'subgroup.approve' : 'subgroup.accept')}</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
      {flock.filter(member => !member.subgroupId && (picking || member.userId !== myUserId)).map(renderMember)}
      {getD6SubgroupPresentation(subgroups).map(({ subgroup, color }) => {
        const subgroupMembers = flock.filter(member => member.subgroupId === subgroup.id);
        if (subgroupMembers.length === 0) return null;
        const mine = subgroup.id === mySubgroupId;
        const subgroupActions: NativeMenuItem[] = [];
        if (mine) {
          subgroupActions.push({ id: 'invite', title: t('d6.team.inviteToSubgroup') });
          if (subgroupMembers.length === 1) subgroupActions.push({ id: 'merge', title: t('d6.team.mergeMain') });
          subgroupActions.push({ id: 'leave', title: t('subgroup.leaveTeam') });
        }
        return (
          <Animated.View
            key={subgroup.id}
            entering={reducedMotion ? undefined : FadeInDown.duration(280)}
            style={[styles.subgroup, { backgroundColor: accentMix(color, 14), borderColor: accentMix(color, 45) }]}
          >
            <View style={styles.subgroupHead}>
              <View style={[styles.subgroupDot, { backgroundColor: color }]} />
              <Text style={styles.subgroupName} numberOfLines={1}>{subgroup.name}</Text>
              {!picking && subgroupActions.length > 0 && (
                <NativeMenuHost
                  items={subgroupActions}
                  onSelect={id => {
                    if (id === 'invite') onInviteToSubgroup();
                    if (id === 'leave' || id === 'merge') void onLeaveSubgroup();
                  }}
                  accessibilityLabel={t('d6.team.subgroupOptions', { name: subgroup.name })}
                  testID={`d6-subgroup-options-${subgroup.id}`}
                  style={styles.smallCircle}
                >
                  <View style={styles.menuIcon} pointerEvents="none">
                    <Ionicons name="ellipsis-horizontal" color={white} size={20} />
                  </View>
                </NativeMenuHost>
              )}
            </View>
            {subgroupMembers.filter(member => picking || member.userId !== myUserId).map(renderMember)}
            {mine && sentInvites.length > 0 && (
              <Text style={styles.pending}>
                {t('subgroup.pendingInvites', { names: sentInvites.map(invite => invite.inviteeName).join(t('d6.team.nameSeparator')) })}
              </Text>
            )}
          </Animated.View>
        );
      })}
      {!picking && myMember && !mySubgroupId && (<>
        <Pressable
          style={styles.splitButton}
          onPress={onStartSplit}
          accessibilityRole="button"
          accessibilityLabel={t('subgroup.createTeam')}
          testID="map-subgroup-split"
        >
          <Ionicons name="add" color={muted} size={18} />
          <Text style={styles.splitLabel}>{t('d6.team.subgroup')}</Text>
        </Pressable>
        <Pressable style={styles.splitButton} onPress={() => void onTemporarilyLeave()}
          accessibilityRole="button" accessibilityLabel={t('solo.tempLeave')} accessibilityHint={t('solo.tempLeaveHint')}
          testID="d6-team-temporary-leave">
          <Ionicons name="exit-outline" color={muted} size={19} />
          <Text style={styles.splitLabel}>{t('solo.tempLeave')}</Text>
        </Pressable>
      </>)}
      </ScrollView>
    </View>
  );
}

export function D6TeamHeader({ group, onOpenTeamSettings, onInviteTeam }: Pick<D6MembersPaneProps, 'group' | 'onOpenTeamSettings' | 'onInviteTeam'>) {
  const { t } = useTranslation();
  if (!group) return null;
  return (
        <View style={styles.header}>
          <Pressable
            style={styles.headerIdentity}
            onPress={onOpenTeamSettings}
            accessibilityRole="button"
            accessibilityLabel={t('d6.team.settingsNamed', { name: group.name })}
            testID="d6-team-settings"
          >
            <View style={[styles.teamAvatar, { backgroundColor: group.avatarColor ?? avatarColorForGroup(group.id) }]}>
              <Text style={styles.teamEmoji}>{group.avatar ?? avatarForGroup(group.id)}</Text>
            </View>
            <Text style={styles.teamName} numberOfLines={1}>{group.name}</Text>
          </Pressable>
          <SheetHeaderAction
            action="share"
            onPress={onInviteTeam}
            accessibilityLabel={t('map.inviteMembers')}
            testID="map-invite-members"
          />
        </View>
  );
}

function TeamMemberAvatar({ member, dim }: {
  member: { userId: string; avatar?: string; color: string };
  dim?: boolean;
}) {
  return (
    <View style={[styles.memberAvatar, { backgroundColor: member.color }, dim && styles.stealthAvatar]}>
      <Text style={styles.memberEmoji}>{displayMemberAvatar(member.avatar, member.userId).emoji}</Text>
    </View>
  );
}

function CoordinationVotes({
  coordination,
  groupId,
  mySubgroupId,
  isLeader,
}: {
  coordination: UseCoordinationRequestsResult;
  groupId: string;
  mySubgroupId: string | undefined;
  isLeader: boolean;
}) {
  const { t } = useTranslation();
  const { requests, respond, busyRequestId, error } = coordination;
  const active = requests.filter(request =>
    request.groupId === groupId && request.status === 'open' &&
    (!request.subgroupId || request.subgroupId === mySubgroupId || isLeader)
  );
  if (active.length === 0) return null;
  return (
    <View testID="d6-team-coordination">
      {active.map(request => (
        <View key={request.id} style={[styles.card, styles.poll]}>
          <Text style={styles.pollTitle}>{request.subject}</Text>
          <View style={styles.voteRow}>
            {request.options.map(option => {
              const selected = request.myOptionId === option.id;
              const count = request.responses.filter(response => response.optionId === option.id).length;
              const optionLabel = option.kind === 'keep_current' && option.label === t('coordination.optionKeep')
                ? t('d6.team.voteKeep')
                : option.label === t('coordination.optionChange')
                  ? t('d6.team.voteChange')
                  : option.label;
              const disabled = Boolean(busyRequestId);
              return (
                <Pressable
                  key={option.id}
                  style={[styles.vote, selected && styles.voteSelected]}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={t('d6.team.voteOption', { label: optionLabel, count })}
                  accessibilityState={{ selected, disabled }}
                  onPress={() => { selectionTick(); void respond(request.id, option.id); }}
                  testID={`coordination-response-${option.id}`}
                >
                  <Text style={styles.voteLabel}>{optionLabel}{'  '}<Text style={styles.voteCount}>{count}</Text></Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const white = '#FFFFFF';
const muted = 'rgba(255,255,255,0.6)';
const soft = 'rgba(255,255,255,0.1)';

const styles = StyleSheet.create({
  pane: { flex: 1, minHeight: 0 },
  scrollContent: { paddingBottom: 8 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingBottom: 6 },
  headerIdentity: { flex: 1, minHeight: MAP_SHEET_ACTION_HIT_SIZE, flexDirection: 'row', alignItems: 'center', gap: 12 },
  teamAvatar: { width: MAP_SHEET_ACTION_HIT_SIZE, height: MAP_SHEET_ACTION_HIT_SIZE, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  teamEmoji: { fontSize: 23, includeFontPadding: false },
  teamName: { flex: 1, color: white, fontSize: APP_TEXT_SIZE.title, fontWeight: '700' },
  smallCircle: { width: 44, height: 44 },
  menuIcon: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  codeCard: { borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, marginVertical: 6 },
  inviteCode: { flex: 1, color: white, fontSize: APP_TEXT_SIZE.heading, fontVariant: ['tabular-nums'], letterSpacing: 3 },
  fallbackCodeFont: { fontWeight: '900', fontStyle: 'italic' },
  card: { backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 20, marginVertical: 5 },
  inviteCard: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', padding: 10, gap: 8 },
  inviteIdentity: { flexDirection: 'row', alignItems: 'center', flexGrow: 1, flexBasis: 110, gap: 8 },
  invitePrompt: { flex: 1, color: white, fontSize: APP_TEXT_SIZE.caption, fontWeight: '600' },
  inviteActions: { flexDirection: 'row', gap: 6, marginLeft: 'auto' },
  inviteButton: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', borderRadius: 22, gap: 5, minHeight: 44, paddingHorizontal: 14, backgroundColor: soft },
  inviteLabel: { color: white, fontSize: APP_TEXT_SIZE.caption, fontWeight: '700' },
  acceptButton: { backgroundColor: white },
  acceptLabel: { color: '#171717' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54, paddingVertical: 7, borderTopColor: 'rgba(255,255,255,0.08)', borderTopWidth: StyleSheet.hairlineWidth },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  memberIdentity: { flex: 1, minWidth: 0, gap: 3 },
  freshness: { color: muted, fontSize: APP_TEXT_SIZE.caption },
  locationRecovery: { minHeight: 34, justifyContent: 'center' },
  locationWarning: { color: '#FF8585', fontSize: APP_TEXT_SIZE.caption, fontWeight: '600' },
  memberName: { color: white, fontSize: APP_TEXT_SIZE.body, fontWeight: '600' },
  memberAvatar: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19 },
  avatarSlot: { width: 38, height: 38 },
  memberEmoji: { fontSize: 21, includeFontPadding: false },
  statusDot: { position: 'absolute', right: 0, bottom: 0, width: 11, height: 11, borderWidth: 2, borderRadius: 6, borderColor: '#26302E' },
  inboxBadge: { top: -4, right: -4 },
  stealthAvatar: { opacity: 0.4 },
  statusPill: { minHeight: 34, paddingHorizontal: 13, flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: soft, borderRadius: 17 },
  statusLabel: { color: white, fontSize: APP_TEXT_SIZE.caption, fontWeight: '600' },
  check: { width: 26, height: 26, borderRadius: 13, borderColor: 'rgba(255,255,255,0.45)', borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  arrivedDot: { width: 8, height: 8, borderRadius: 4 },
  arrivedText: { color: white, fontSize: APP_TEXT_SIZE.caption, fontWeight: '600' },
  value: { color: muted, fontSize: APP_TEXT_SIZE.caption },
  subgroup: { marginTop: 12, borderRadius: 20, borderWidth: 1, paddingHorizontal: 12 },
  subgroupHead: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10 },
  subgroupDot: { width: 10, height: 10, borderRadius: 5 },
  subgroupName: { flex: 1, color: white, fontSize: APP_TEXT_SIZE.caption, fontWeight: '700' },
  pending: { color: muted, fontSize: APP_TEXT_SIZE.caption, marginVertical: 8 },
  splitButton: { borderStyle: 'dashed', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)', borderRadius: 18, minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12 },
  splitLabel: { color: 'rgba(255,255,255,0.75)', fontSize: APP_TEXT_SIZE.caption, fontWeight: '600' },
  poll: { padding: 14, gap: 10 },
  pollTitle: { color: white, fontSize: APP_TEXT_SIZE.body, fontWeight: '700' },
  voteRow: { flexDirection: 'row', gap: 8 },
  vote: { flex: 1, minHeight: 44, padding: 7, borderWidth: 2, borderColor: 'transparent', borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: soft },
  voteSelected: { borderColor: white },
  voteLabel: { color: white, fontSize: APP_TEXT_SIZE.caption, fontWeight: '600', textAlign: 'center' },
  voteCount: { color: muted, fontSize: APP_TEXT_SIZE.caption, fontVariant: ['tabular-nums'] },
  error: { color: '#FF6B6B', fontSize: APP_TEXT_SIZE.caption, marginBottom: 6 },
});
