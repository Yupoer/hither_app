import { APP_TEXT_SIZE } from '../../../theme/typeScale';
import { useMountEffect } from '../../../hooks/useMountEffect';
import React, { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Pressable from '../../../components/MotionPressable';
import TeamSwipeActions from '../../../components/TeamSwipeActions';
import { Ionicons } from '@expo/vector-icons';
import { leaveGroups, type JoinedGroupInfo } from '../../../api/client';
import { HitherText } from '../../../components/HitherText';
import GroupLoadError from '../../../components/GroupLoadError';
import WaveLoading from '../../../components/WaveLoading';
import { avatarColorForGroup, avatarForGroup } from '../../../constants/avatars';
import { useTranslation } from '../../../i18n';
import { useJoinedGroups } from '../../../state/useJoinedGroups';
import { clearLiveActivities } from '../../../state/useLiveActivity';
import { useSession } from '../../../state/SessionContext';
import type { Group } from '../../../types';
import { confirmAction } from '../../../utils/confirm';
import { runUiAction } from '../../../utils/uiAction';

export function HomeTeamCard({ team, count, selected, onPress, onLeave }: {
  team: Group;
  count: number;
  selected?: boolean;
  onPress: () => void;
  onLeave?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Pressable style={styles.card} onPress={onPress}
      testID={`settings-team-card-${team.id}`}
      accessibilityRole="button" accessibilityState={selected === undefined ? undefined : { selected }}
      accessibilityActions={onLeave ? [{ name: 'leave', label: t('teams.leave') }] : undefined}
      onAccessibilityAction={onLeave ? event => { if (event.nativeEvent.actionName === 'leave') onLeave(); } : undefined}>
      <View style={[styles.avatar, { backgroundColor: team.avatarColor ?? avatarColorForGroup(team.id) }]}>
        <HitherText typeRole="emoji" style={styles.emoji}>{team.avatar ?? avatarForGroup(team.id)}</HitherText>
      </View>
      <HitherText style={styles.name} numberOfLines={2}>{team.name}</HitherText>
      <HitherText style={styles.count}>{t('teams.memberCount', { count })}</HitherText>
      <Ionicons name={selected ? 'checkmark-circle' : 'chevron-forward'} size={selected ? 36 : 24}
        color={selected ? '#34C759' : 'rgba(255,255,255,0.5)'} />
    </Pressable>
  );
}

export default function HomeTeamsPage({
  onLoadingChange, currentGroupId, onSwitch, onCreate, onJoin, onLeaveCurrent }: {
  onLoadingChange?: (loading: boolean) => void;
  currentGroupId?: string;
  onSwitch?: (team: JoinedGroupInfo) => void;
  onCreate?: () => void;
  onJoin?: () => void;
  onLeaveCurrent: () => void;
}) {
  const { user } = useSession();
  const { t, language } = useTranslation();
  const { groups, loading, error, retry, lifecycle, setGroups } = useJoinedGroups(user?.id ?? null, false);
  const leaving = useRef(new Set<string>());

  function confirmLeave(id: string) {
    if (id === currentGroupId) {
      onLeaveCurrent();
      return;
    }
    confirmAction({
      title: t('teams.leaveTitle'),
      message: t('teams.leaveMsg'),
      confirmLabel: t('teams.leave'),
      destructive: true,
    }, () => {
      if (leaving.current.has(id)) return;
      leaving.current.add(id);
      void runUiAction('my_teams.leave_group', async () => {
        await leaveGroups([id]);
        setGroups(previous => previous.filter(info => info.group.id !== id));
        await clearLiveActivities({ groupIds: [id] });
      }, { screen: 'Map' }).finally(() => leaving.current.delete(id));
    });
  }

  const waiting = loading && groups.length === 0;
  const loadingLifecycle = <TeamLoadingStatus key={String(waiting)} loading={waiting} onChange={onLoadingChange} />;
  if (waiting) return (
    <View testID="settings-teams-loading" style={styles.loading}>
      {lifecycle}
      {loadingLifecycle}
      {!onLoadingChange ? <WaveLoading size="large" color="#4C6FFF" /> : null}
    </View>
  );

  return (
    <View style={styles.list}>
      {lifecycle}
      {loadingLifecycle}
      {error ? <GroupLoadError error={error} loading={loading} retry={retry} color="#4C6FFF" /> : null}
      {groups.map(info => {
        const id = info.group.id;
        const selected = id === currentGroupId;
        return (
          <TeamSwipeActions key={id} id={id} name={info.group.name} onLeave={() => confirmLeave(id)}>
            <HomeTeamCard team={info.group} count={info.memberCount} selected={selected}
              onPress={() => onSwitch?.(info)} onLeave={() => confirmLeave(id)} />
          </TeamSwipeActions>
        );
      })}
      <View style={styles.actions}>
        {onCreate ? <Pressable style={styles.action} onPress={onCreate} accessibilityRole="button" testID="settings-team-create">
          <HitherText style={styles.actionText}>{language === 'zh' ? '建立' : t('teams.create')}</HitherText>
        </Pressable> : null}
        {onJoin ? <Pressable style={styles.action} onPress={onJoin} accessibilityRole="button" testID="settings-team-join">
          <HitherText style={styles.actionText}>{t('teams.join')}</HitherText>
        </Pressable> : null}
      </View>
    </View>
  );
}

function TeamLoadingStatus({ loading, onChange }: { loading: boolean; onChange?: (loading: boolean) => void }) {
  useMountEffect(() => {
    onChange?.(loading);
    return () => onChange?.(false);
  });
  return null;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { gap: 10 },
  card: { minHeight: 66, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.09)', borderRadius: 20 },
  avatar: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 26 },
  name: { flex: 1, color: '#fff', fontSize: APP_TEXT_SIZE.body, fontWeight: '700' },
  count: { color: 'rgba(255,255,255,0.67)', fontSize: APP_TEXT_SIZE.body, fontWeight: '600', flexShrink: 0 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 3 },
  action: { minHeight: 48, flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  actionText: { color: '#fff', fontSize: APP_TEXT_SIZE.caption, fontWeight: '700' },
});
