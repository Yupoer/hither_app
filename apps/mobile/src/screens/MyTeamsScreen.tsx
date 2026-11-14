import { APP_TEXT_SIZE } from '../theme/typeScale';
import React, { useCallback, useRef } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Pressable from '../components/MotionPressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useSession } from '../state/SessionContext';
import { useJoinedGroups } from '../state/useJoinedGroups';
import { clearLiveActivities } from '../state/useLiveActivity';
import { getCachedMyJoinedGroups, leaveGroups, type JoinedGroupInfo } from '../api/services/GroupService';
import { avatarColorForGroup, avatarForGroup, displayMemberAvatar } from '../constants/avatars';
import { runUiAction } from '../utils/uiAction';
import { alertBuzz, lightTap } from '../utils/haptics';
import { logEvent } from '../utils/activityLog';
import { useTranslation } from '../i18n';
import WaveLoading from '../components/WaveLoading';
import GroupLoadError from '../components/GroupLoadError';
import { HitherText } from '../components/HitherText';
import TeamSwipeActions from '../components/TeamSwipeActions';
import EntryCodeInput from './entry/EntryCodeInput';
import { ENTRY_ACCENT, EntryAvatar, WelcomeHerd } from './entry/EntryVisuals';

type Props = NativeStackScreenProps<RootStackParamList, 'MyTeams'>;

export default function MyTeamsScreen({ route, navigation }: Props) {
  return <TeamEntryScreen origin="MyTeams" params={route.params} navigation={navigation} />;
}

export function TeamEntryScreen({ origin, params, navigation }: {
  origin: 'RoleSelect' | 'MyTeams';
  params: RootStackParamList['RoleSelect'];
  navigation: NativeStackNavigationProp<RootStackParamList>;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { t } = useTranslation();
  const { user, isAnonymous, setMembership, membership, leaveGroup, signOut } = useSession();
  const actorId = user?.id ?? null;
  const { groups, setGroups, loading, error, retry, lifecycle } = useJoinedGroups(actorId, false);
  const enterInFlightRef = useRef<string | null>(null);
  const returning = origin === 'MyTeams' || groups.length > 0;
  const loadingEntry = loading && actorId !== null && groups.length === 0 && !returning;
  const avatar = user ? displayMemberAvatar(user.avatar, user.id, user.avatarColor) : null;

  useFocusEffect(useCallback(() => {
    enterInFlightRef.current = null;
    if (actorId && getCachedMyJoinedGroups(actorId) === null) retry();
  }, [actorId, retry]));

  function handleEnterGroup(info: JoinedGroupInfo) {
    if (enterInFlightRef.current) return;
    enterInFlightRef.current = info.group.id;
    let navigationScheduled = false;
    void runUiAction('my_teams.enter_group', (token) => {
      if (!token.isCurrent()) return;
      lightTap();
      setMembership({ group: info.group, role: info.role });
      navigation.reset({ index: 0, routes: [{ name: 'Map', params: { groupId: info.group.id } }] });
      navigationScheduled = true;
    }, { screen: 'MyTeams' }).then(() => {
      if (!navigationScheduled) enterInFlightRef.current = null;
    });
  }

  function handleLeaveGroup(groupId: string) {
    alertBuzz();
    Alert.alert(t('teams.leaveTitle'), t('teams.leaveMsg'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('teams.leave'),
        style: 'destructive',
        onPress: () => {
          void runUiAction('my_teams.leave_group', async (token) => {
            await leaveGroups([groupId]);
            await clearLiveActivities({ groupIds: [groupId] });
            if (!token.isCurrent()) return;
            if (membership?.group.id === groupId) leaveGroup();
            setGroups(previous => previous.filter(info => info.group.id !== groupId));
          }, { screen: 'MyTeams' });
        },
      },
    ]);
  }

  function handleClearAllGroups() {
    const groupIds = groups.map(info => info.group.id);
    alertBuzz();
    Alert.alert(t('teams.clearAllTitle'), t('teams.clearAllMsg'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('teams.clearAllConfirm'),
        style: 'destructive',
        onPress: () => {
          void runUiAction('my_teams.clear_all', async token => {
            await leaveGroups(groupIds);
            await clearLiveActivities({ groupIds });
            if (!token.isCurrent()) return;
            if (membership && groupIds.includes(membership.group.id)) leaveGroup();
            setGroups(previous => previous.filter(info => !groupIds.includes(info.group.id)));
          }, { screen: 'MyTeams' });
        },
      },
    ]);
  }

  function startSignOut() {
    void runUiAction('role_select.sign_out', async token => {
      logEvent('sign_out');
      await signOut();
      if (token.isCurrent()) navigation.reset({ index: 0, routes: [{ name: 'RoleSelect' }] });
    }, {
      screen: origin,
      suppressBanner: true,
      onError: kind => Alert.alert(t('settings.signOutTitle'), t(kind === 'timeout' ? 'interaction.signOutTimeout' : 'interaction.error'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('interaction.retry'), onPress: startSignOut },
      ]),
    });
  }

  function openSignOut() {
    Alert.alert(t('settings.signOutTitle'), t('settings.signOutMsg'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('settings.signOut'), style: 'destructive', onPress: startSignOut },
    ]);
  }

  return (
    <KeyboardAvoidingView
      style={styles.page}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      testID={returning ? 'entry-returning' : 'entry-welcome'}
    >
      {lifecycle}
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 4, paddingBottom: Math.max(18, insets.bottom - 6) },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          {returning ? (
            <HitherText typeRole="display" accessibilityRole="header" style={styles.title}>{t('teams.title')}</HitherText>
          ) : <View />}
          {avatar && !isAnonymous ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('settings.signOut')} testID="role-signout" onPress={openSignOut}>
              <EntryAvatar emoji={avatar.emoji} color={avatar.color} size={40} circle />
            </Pressable>
          ) : (
            <Pressable accessibilityRole="button" style={styles.login} testID="entry-login" onPress={() => navigation.navigate('Login')}>
              <HitherText style={styles.loginText}>{t('login.ctaSignIn')}</HitherText>
            </Pressable>
          )}
        </View>
        {loadingEntry ? null : returning ? (
          <View style={styles.teams}>
            {groups.map(info => (
              <TeamCard key={info.group.id} info={info} onEnter={() => handleEnterGroup(info)} onLeave={() => handleLeaveGroup(info.group.id)} />
            ))}
            {groups.length > 0 ? (
              <Pressable testID="teams-clear" accessibilityRole="button" style={styles.clear} onPress={handleClearAllGroups}>
                <HitherText style={styles.clearText}>{t('teams.clear')}</HitherText>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View style={styles.hero}>
            <WelcomeHerd compact={height < 700} />
            <HitherText typeRole="display" accessibilityRole="header" style={styles.word}>Hither</HitherText>
            <HitherText style={styles.tagline}>{t('entry.tagline')}</HitherText>
          </View>
        )}
        {error ? <GroupLoadError error={error} loading={loading} retry={retry} color={ENTRY_ACCENT} /> : null}
        <View style={styles.grow} />
        <EntryCodeInput
          key={params?.rejectedInviteKey ?? 'code'}
          rejected={params?.rejectedInviteKey !== undefined}
          onJoin={code => navigation.navigate('Auth', { role: 'follower', code })}
          onCreate={() => navigation.navigate('Auth', { role: 'leader' })}
        />
      </ScrollView>
      {loadingEntry ? <View testID="teams-entry-loading" style={styles.loading}><WaveLoading color={ENTRY_ACCENT} /></View> : null}
    </KeyboardAvoidingView>
  );
}

function TeamCard({ info, onEnter, onLeave }: {
  info: JoinedGroupInfo;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const { group } = info;
  return (
    <TeamSwipeActions id={group.id} name={group.name} onLeave={onLeave}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={group.name}
        accessibilityActions={[{ name: 'remove', label: t('teams.leave') }]}
        onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'remove') onLeave(); }}
        testID={`team-card-${group.id}`}
        onPress={onEnter}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      >
        <EntryAvatar emoji={group.avatar ?? avatarForGroup(group.id)} color={group.avatarColor ?? avatarColorForGroup(group.id)} />
        <HitherText typeRole="title" numberOfLines={2} style={styles.cardText}>{group.name}</HitherText>
        <Ionicons name="chevron-forward" color="rgba(255,255,255,0.5)" size={16} />
      </Pressable>
    </TeamSwipeActions>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 20 },
  header: { minHeight: 44, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: '#fff', fontSize: APP_TEXT_SIZE.heading, fontFamily: 'BricolageGrotesque', fontWeight: '800', letterSpacing: -0.34 },
  login: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' },
  loginText: { fontSize: APP_TEXT_SIZE.caption, fontWeight: '600', color: '#fff' },
  hero: { alignItems: 'center', marginTop: 12 },
  word: { color: '#fff', fontSize: APP_TEXT_SIZE.metric, fontFamily: 'BricolageGrotesque', fontWeight: '800', letterSpacing: -0.88, marginTop: 6 },
  tagline: { fontSize: APP_TEXT_SIZE.body, color: 'rgba(255,255,255,0.68)', marginTop: 10 },
  grow: { flexGrow: 1, minHeight: 18 },
  loading: { ...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center' },
  teams: { gap: 10, marginTop: 18 },
  clear: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 12 },
  clearText: { color: '#FF8C86', fontSize: APP_TEXT_SIZE.caption },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 20, padding: 12, backgroundColor: 'rgba(255,255,255,0.08)' },
  cardPressed: { backgroundColor: '#2A2F3F' },
  cardText: { flexShrink: 1, flexGrow: 1, fontSize: APP_TEXT_SIZE.body, fontWeight: '700', color: '#fff' },
});
