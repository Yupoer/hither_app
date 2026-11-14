import { APP_TEXT_SIZE } from '../theme/typeScale';
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../components/AppText';
import Pressable from '../components/MotionPressable';
import { CommonActions } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { ReduceMotion, SlideInDown } from 'react-native-reanimated';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { createGroup, getCachedMyJoinedGroups, joinGroup, updateGroupAvatar } from '../api/services/GroupService';
import { useSession } from '../state/SessionContext';
import { useTranslation } from '../i18n';
import { logEvent } from '../utils/activityLog';
import { runUiAction } from '../utils/uiAction';
import { errorTap, mediumTap, selectionTick } from '../utils/haptics';
import { classifyAnonymousAccessError } from '../anonymousAccess';
import { getOperationErrorMessage } from '../utils/operationError';
import { AVATAR_COLORS, HOME_AVATAR_COLORS, avatarColorForGroup, avatarForGroup, displayMemberAvatar } from '../constants/avatars';
import type { Group } from '../types';
import { useMountEffect } from '../hooks/useMountEffect';
import SheetHeaderAction from '../components/SheetHeaderAction';
import { MAP_FLOATING_EDGE_INSET, MAP_SHEET_CORNER_RADIUS, SHEET_CORNER_ACTION_INSET } from '../components/mapSheetChrome';
import { ENTRY_ACCENT, EntryAvatar, EntryPrimaryButton } from './entry/EntryVisuals';

type Props = NativeStackScreenProps<RootStackParamList, 'Auth'>;

const teamAvatars = [
  ['🦊', HOME_AVATAR_COLORS[1]], ['🐑', HOME_AVATAR_COLORS[0]], ['🐺', AVATAR_COLORS[9]],
  ['🐰', HOME_AVATAR_COLORS[7]], ['🐻', HOME_AVATAR_COLORS[1]], ['🐼', HOME_AVATAR_COLORS[3]],
  ['🐸', HOME_AVATAR_COLORS[4]], ['🐥', HOME_AVATAR_COLORS[2]], ['🦁', HOME_AVATAR_COLORS[2]],
  ['🐯', HOME_AVATAR_COLORS[1]], ['🐨', HOME_AVATAR_COLORS[6]], ['🐢', HOME_AVATAR_COLORS[3]],
  ['🐙', HOME_AVATAR_COLORS[0]], ['🦄', HOME_AVATAR_COLORS[6]], ['🐳', HOME_AVATAR_COLORS[5]],
  ['🦉', HOME_AVATAR_COLORS[1]], ['🐹', HOME_AVATAR_COLORS[2]], ['🐮', AVATAR_COLORS[9]],
  ['🐷', HOME_AVATAR_COLORS[7]],
] as const;

export default function AuthScreen({ navigation, route }: Props) {
  const { signIn, user, updateNickname, setMembership, refreshProfile } = useSession();
  const { t, language } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const request = route.params;
  const isLeader = request.role === 'leader';
  const name = user?.name?.trim() || t('entry.guestName');
  const [nickname, setNickname] = useState<string>();
  const [groupName, setGroupName] = useState('');
  const [avatarIndex, setAvatarIndex] = useState(0);
  const createdTeam = useRef<Group | null>(null);
  const [nameLocked, setNameLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const [emoji, color] = teamAvatars[avatarIndex];
  const myAvatar = user
    ? displayMemberAvatar(user.avatar, user.id, user.avatarColor)
    : { emoji: '🦊', color: AVATAR_COLORS[1] };
  const cachedTeam = request.role === 'follower'
    ? getCachedMyJoinedGroups(user?.id)?.find(info => info.group.inviteCode === request.code)
    : undefined;
  const displayedNickname = nickname ?? name;
  const canSubmit = !busy && (isLeader ? Boolean(groupName.trim()) : Boolean(displayedNickname.trim()));
  const close = () => {
    if (busy) return;
    Keyboard.dismiss();
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.replace('RoleSelect');
  };

  useMountEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  });

  function handleJoinRejection() {
    if (request.role !== 'follower') return;
    const state = navigation.getState();
    const previous = state.routes[state.index - 1];
    if (previous && (previous.name === 'RoleSelect' || previous.name === 'MyTeams')) {
      navigation.dispatch({
        ...CommonActions.setParams({ rejectedInviteKey: route.key }),
        source: previous.key,
        target: state.key,
      });
      navigation.goBack();
    } else {
      setError(t('group.invalidInviteCode'));
    }
  }

  function submitAuth() {
    if (!canSubmit) return;
    const actionId = isLeader ? 'auth.create_group' : 'auth.join_group';
    Keyboard.dismiss();
    setError(null);
    void runUiAction(actionId, async (token) => {
      const current = () => mounted.current && token.isCurrent();
      const nextName = isLeader ? name : displayedNickname.trim();
      try {
        if (!user) {
          await signIn({ name: nextName });
        } else if (nextName !== user.name) {
          await updateNickname(nextName);
        }
        if (!current()) return;
        mediumTap();
        let group: Group;
        if (request.role === 'leader') {
          const created = createdTeam.current ?? await createGroup(groupName.trim());
          createdTeam.current = created;
          if (!current()) return;
          setNameLocked(true);
          group = await updateGroupAvatar(created.id, emoji, color);
        } else {
          group = await joinGroup(request.code);
        }
        if (!current()) return;
        void refreshProfile().catch(() => undefined);
        logEvent(isLeader ? 'group_create' : 'group_join');
        setMembership({ group, role: cachedTeam?.role ?? request.role });
        navigation.reset({
          index: 0,
          routes: [{ name: 'Map', params: { groupId: group.id, ...(isLeader ? { showTeamInvite: true } : {}) } }],
        });
      } catch (cause) {
        if (current()) {
          errorTap();
          if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'invalid_invite_code') {
            handleJoinRejection();
            return;
          }
          const message = cause instanceof Error ? cause.message : '';
          const access = classifyAnonymousAccessError(message);
          if (message === 'member_limit') setError(t('paywall.memberCap', { n: 5 }));
          else if (access === 'registration_required') setError(t('paywall.memberCapAfterRegister'));
          else if (access === 'expired') setError(t('anon.expired'));
          else setError(getOperationErrorMessage(cause, language));
        }
        throw cause;
      }
    }, {
      screen: 'Auth',
      onBusyChange: next => { if (mounted.current) setBusy(next); },
      suppressBanner: true,
      onError: kind => {
        if (kind === 'timeout' && mounted.current) setError(t('interaction.timeout'));
      },
    });
  }

  return (
    <KeyboardAvoidingView
      style={styles.overlay}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      accessibilityViewIsModal
    >
      <View style={styles.scrim} />
      <Pressable style={StyleSheet.absoluteFill} onPress={close} disabled={busy} accessible={false} />
      <Animated.View entering={SlideInDown.duration(260).reduceMotion(ReduceMotion.System)}
        testID="auth-sheet" style={[styles.sheet, {
          marginBottom: Math.max(12, insets.bottom - 6), maxHeight: height - insets.top - insets.bottom - 18,
        }]}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>{isLeader ? t('entry.createTeam') : t('entry.joinTeam')}</Text>
          <SheetHeaderAction action="close" accessibilityLabel={t('common.close')} onPress={close} disabled={busy} testID="auth-close" />
        </View>
      <ScrollView
        style={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {isLeader ? (
          <>
            <View style={styles.preview}>
              <EntryAvatar size={60} emoji={emoji} color={color} />
              <View style={styles.teamDetails}>
                <Text style={styles.teamTitle}>{language === 'zh' ? '隊伍圖示' : 'Team icon'}</Text>
                <Text style={styles.previewHint}>{language === 'zh' ? '左右滑動，點選一個圖示。' : 'Swipe to browse, then tap an icon.'}</Text>
              </View>
            </View>
            <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel}>
              {teamAvatars.map(([itemEmoji, itemColor], index) => (
                <Pressable
                  key={itemEmoji}
                  onPress={() => { selectionTick(); setAvatarIndex(index); }}
                  accessibilityRole="button"
                  accessibilityLabel={itemEmoji}
                  accessibilityState={{ selected: avatarIndex === index }}
                  style={[styles.avatarChoice, avatarIndex === index && { borderColor: ENTRY_ACCENT }]}
                >
                  <EntryAvatar size={42} emoji={itemEmoji} color={itemColor} />
                </Pressable>
              ))}
            </ScrollView>
            <TextInput
              accessibilityLabel={t('entry.teamName')}
              style={[styles.field, styles.teamName]}
              value={groupName}
              onChangeText={setGroupName}
              editable={!busy && !nameLocked}
              testID="auth-group-name"
              keyboardAppearance="dark"
              placeholder={t('entry.teamName')}
              placeholderTextColor="rgba(255,255,255,0.46)"
              returnKeyType="done"
              onSubmitEditing={submitAuth}
            />
          </>
        ) : (
          <>
            <View style={styles.teamCard}>
              {cachedTeam ? (
                <EntryAvatar size={52} emoji={cachedTeam.group.avatar ?? avatarForGroup(cachedTeam.group.id)} color={cachedTeam.group.avatarColor ?? avatarColorForGroup(cachedTeam.group.id)} />
              ) : null}
              <View style={styles.teamDetails}>
                <Text accessibilityRole="header" style={styles.teamTitle}>{cachedTeam?.group.name ?? t('entry.joinTeam')}</Text>
                {cachedTeam ? (
                  <View style={styles.teamMembers}>
                    {cachedTeam.memberProfiles.slice(0, 9).map((member, index) => {
                      const avatar = displayMemberAvatar(member.avatar, member.userId ?? `${cachedTeam.group.id}:${index}`, member.avatarColor);
                      return <EntryAvatar key={member.userId ?? index} emoji={avatar.emoji} color={avatar.color} circle size={22} />;
                    })}
                  </View>
                ) : <Text style={styles.code}>{request.code.slice(0, 3)}-{request.code.slice(3)}</Text>}
              </View>
            </View>
            <View style={styles.nicknameRow}>
              <EntryAvatar emoji={myAvatar.emoji} color={myAvatar.color} size={50} circle />
              <TextInput
                accessibilityLabel={t('auth.nameLabel')}
                style={[styles.field, styles.nickname]}
                value={displayedNickname}
                onChangeText={setNickname}
                editable={!busy}
                testID="auth-name"
                keyboardAppearance="dark"
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={submitAuth}
              />
            </View>
          </>
        )}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <EntryPrimaryButton
          accent={ENTRY_ACCENT}
          label={isLeader ? t('entry.createTeam') : t('teams.join')}
          testID={isLeader ? 'auth-create-group' : 'auth-join-group'}
          disabled={!canSubmit}
          onPress={submitAuth}
        />
        {busy ? <ActivityIndicator accessibilityRole="progressbar" color="#fff" /> : null}
      </ScrollView>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: MAP_FLOATING_EDGE_INSET },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: '#07091696' },
  sheet: { flexShrink: 1, borderRadius: MAP_SHEET_CORNER_RADIUS, backgroundColor: '#23283A',
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#FFFFFF42' },
  header: { paddingHorizontal: SHEET_CORNER_ACTION_INSET, paddingTop: SHEET_CORNER_ACTION_INSET, flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { flex: 1, minWidth: 0, color: '#fff', fontWeight: '800', fontSize: APP_TEXT_SIZE.heading },
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { padding: SHEET_CORNER_ACTION_INSET, paddingTop: 12, gap: 12 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  previewHint: { color: '#CDD2E3', fontSize: APP_TEXT_SIZE.caption, marginTop: 3 },
  carousel: { flexDirection: 'row', gap: 7, alignItems: 'center', paddingVertical: 2 },
  avatarChoice: { borderRadius: 15, borderWidth: 2, borderColor: 'transparent', padding: 2 },
  field: {
    minHeight: 54, color: '#fff', fontSize: APP_TEXT_SIZE.body, paddingHorizontal: 15,
    borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  teamName: { fontSize: APP_TEXT_SIZE.body, fontWeight: '600' },
  teamCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 20, padding: 12 },
  teamDetails: { flex: 1 },
  teamTitle: { color: '#fff', fontSize: APP_TEXT_SIZE.body, fontWeight: '700' },
  teamMembers: { flexDirection: 'row', gap: 2, marginTop: 4 },
  nicknameRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nickname: { flex: 1 },
  code: { color: 'rgba(255,255,255,0.66)', fontSize: APP_TEXT_SIZE.caption, marginTop: 4, letterSpacing: 2, fontVariant: ['tabular-nums'] },
  error: { color: '#FF9F95', fontSize: APP_TEXT_SIZE.caption },
});
