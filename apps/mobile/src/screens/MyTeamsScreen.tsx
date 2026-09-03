import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useTheme } from '../state/PreferencesContext';
import { lightTap, alertBuzz } from '../utils/haptics';
import { useSession } from '../state/SessionContext';
import { getMyJoinedGroups, JoinedGroupInfo, leaveGroups } from '../api/client';
import { clearLiveActivities } from '../state/useLiveActivity';
import { HitherText } from '../components/HitherText';
import { avatarForGroup, displayMemberAvatar } from '../constants/avatars';
import { runUiAction } from '../utils/uiAction';
import { useTranslation } from '../i18n';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import MetalforgeBackground from '../components/MetalforgeBackground';
import NativeGlassButton from '../components/NativeGlassButton';
import NativeTeamCard from '../components/NativeTeamCard';

type Props = NativeStackScreenProps<RootStackParamList, 'MyTeams'>;

export default function MyTeamsScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { colors } = useTheme();
  const accent = colors.accent;
  const { user, setMembership, updateNickname } = useSession();
  const { t } = useTranslation();

  const [joinedGroups, setJoinedGroups] = useState<JoinedGroupInfo[]>(route.params?.initialGroups || []);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(!route.params?.initialGroups?.length);

  /**
   * Enter guard across OTA reload / repeated taps / multi-group races.
   * Cleared on focus return and on non-navigation exits (timeout / stale token).
   * UI baseline unchanged — only entry lifecycle hardening (ticket 02).
   */
  const enterInFlightRef = useRef<string | null>(null);

  useEffect(() => {
    if (user) {
      getMyJoinedGroups().then(data => {
        setJoinedGroups(data);
        setIsLoading(false);
      }).catch((e) => {
        console.log('Failed to fetch joined groups', e);
        setIsLoading(false);
      });
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      enterInFlightRef.current = null;
      return () => undefined;
    }, []),
  );

  function handleEnterGroup(info: JoinedGroupInfo) {
    // Any in-flight enter blocks — not only the same group id.
    if (enterInFlightRef.current) return;
    enterInFlightRef.current = info.group.id;
    // Cleared on every non-navigation exit (timeout, stale token, error).
    // Kept set only after replace so double-tap during transition cannot re-enter.
    let navigationScheduled = false;
    void runUiAction(
      'my_teams.enter_group',
      async (token) => {
        setExpandedGroupId(null);
        lightTap();
        // Reconcile orphan Live Activities after OTA / prior session before map.
        await clearLiveActivities().catch(() => undefined);
        if (!token.isCurrent()) {
          enterInFlightRef.current = null;
          return;
        }
        if (!user?.name.trim()) {
          const fallback = user?.email?.split('@')[0]?.trim() || t('group.travelerFallback');
          await updateNickname(fallback);
          if (!token.isCurrent()) {
            enterInFlightRef.current = null;
            return;
          }
        }
        setMembership({ group: info.group, role: info.role });
        navigation.replace('Map', { groupId: info.group.id });
        navigationScheduled = true;
      },
      { screen: 'MyTeams' },
    )
      .then(() => {
        // runUiAction resolves (does not reject) on timeout — clear unless we
        // already handed off to Map.
        if (!navigationScheduled && enterInFlightRef.current === info.group.id) {
          enterInFlightRef.current = null;
        }
      })
      .catch(() => {
        if (enterInFlightRef.current === info.group.id) {
          enterInFlightRef.current = null;
        }
      });
  }

  function handleLeaveGroup(groupId: string) {
    alertBuzz();
    Alert.alert(t('teams.leaveTitle'), t('teams.leaveMsg'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.confirm'),
        style: 'destructive',
        onPress: () => {
          void runUiAction(
            'my_teams.leave_group',
            async (token) => {
              await leaveGroups([groupId]);
              await clearLiveActivities({ groupIds: [groupId] });
              if (!token.isCurrent()) return;
              setJoinedGroups((prev) => prev.filter((g) => g.group.id !== groupId));
              setExpandedGroupId(null);
            },
            { screen: 'MyTeams' },
          );
        },
      },
    ]);
  }

  function handleClearAllGroups() {
    alertBuzz();
    Alert.alert(t('teams.clearAllTitle'), t('teams.clearAllMsg'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('teams.clearAllConfirm'),
        style: 'destructive',
        onPress: () => {
          void runUiAction(
            'my_teams.clear_all',
            async (token) => {
              const groupIds = joinedGroups.map((g) => g.group.id);
              await leaveGroups(groupIds);
              await clearLiveActivities({ groupIds });
              if (!token.isCurrent()) return;
              setJoinedGroups([]);
              navigation.goBack();
            },
            { screen: 'MyTeams' },
          );
        },
      },
    ]);
  }

  return (
    <View style={styles.fill}>
      <MetalforgeBackground active={isFocused} />
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <NativeGlassButton
          label={t('common.back')}
          systemImage="chevron.left"
          shape="capsule"
          variant="glass"
          onPress={() => { lightTap(); navigation.goBack(); }}
          accessibilityLabel={t('common.back')}
          width={78}
          height={36}
          style={styles.backBtn}
        />
        <Text style={styles.title}>{t('teams.title')}</Text>
        <NativeGlassButton
          label={t('teams.clear')}
          shape="capsule"
          variant="glass"
          onPress={handleClearAllGroups}
          accessibilityLabel={t('teams.clear')}
          foregroundColor="#ff453a"
          style={styles.clearBtn}
        />
      </View>

      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]}>
        {isLoading && joinedGroups.length === 0 ? (
          <View style={{ paddingTop: 60, alignItems: 'center' }}>
            <ActivityIndicator size="large" color={accent} />
          </View>
        ) : null}
        {joinedGroups.map((info) => {
          const totalMembers = Math.max(0, info.memberCount);
          const displayAvatars = [];
          for (let i = 0; i < Math.min(4, totalMembers); i++) {
            if (i < info.memberProfiles.length) {
              displayAvatars.push({ ...info.memberProfiles[i], isPlaceholder: false });
            } else {
              displayAvatars.push({ avatarColor: 'rgba(255,255,255,0.05)', isPlaceholder: true });
            }
          }
          const extraCount = Math.max(0, totalMembers - 4);
          const isExpanded = expandedGroupId === info.group.id;
          
          const detailAvatars = [];
          for (let i = 0; i < totalMembers; i++) {
            if (i < info.memberProfiles.length) {
              detailAvatars.push({ ...info.memberProfiles[i], isPlaceholder: false });
            } else {
              detailAvatars.push({ avatarColor: 'rgba(255,255,255,0.05)', isPlaceholder: true });
            }
          }

          return (
            <Animated.View key={info.group.id} layout={LinearTransition.springify()}>
              <NativeTeamCard
                teamName={info.group.name}
                subtitle={t('teams.memberCount', { count: info.memberCount })}
                inviteCode={info.group.inviteCode}
                groupEmoji={info.group.avatar || avatarForGroup(info.group.id)}
                groupColor={info.group.avatarColor || 'rgba(255,255,255,0.16)'}
                members={displayAvatars.map((p, i) => ({
                  emoji: p.userId ? displayMemberAvatar(p.avatar, p.userId).emoji : undefined,
                  placeholder: p.isPlaceholder,
                }))}
                extraCount={extraCount}
                expanded={isExpanded}
                onPress={() => {
                  lightTap();
                  setExpandedGroupId(isExpanded ? null : info.group.id);
                }}
                accessibilityLabel={`${info.group.name}, ${t('teams.memberCount', { count: info.memberCount })}`}
                testID={`team-card-${info.group.id}`}
                style={styles.teamCard}
              />

              {isExpanded && (
                  <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.expandedSection}>
                    <View style={styles.detailAvatars}>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.detailAvatarsScroll}>
                        {detailAvatars.map((p, i) => (
                          <View
                            key={i}
                            style={[
                              styles.detailAvatarBig,
                              {
                                backgroundColor: p.avatarColor
                                  || (p.userId ? displayMemberAvatar(p.avatar, p.userId).color : 'rgba(255,255,255,0.05)'),
                              },
                            ]}
                          >
                            {p.isPlaceholder ? (
                              <Ionicons name="person" size={20} color="rgba(255,255,255,0.2)" />
                            ) : (
                              <HitherText typeRole="emoji" style={styles.detailEmojiBig}>
                                {displayMemberAvatar(p.avatar, p.userId ?? `${info.group.id}:${i}`).emoji}
                              </HitherText>
                            )}
                          </View>
                        ))}
                      </ScrollView>
                    </View>

                    {info.group.inviteCode ? (
                      <View style={styles.inviteCodeRow}>
                        <Text style={styles.inviteCodeLabel}>{t('teams.inviteCode')}</Text>
                        <Text style={styles.inviteCodeValue}>{info.group.inviteCode}</Text>
                      </View>
                    ) : null}

                    <View style={styles.expandedButtonsRow}>
                      <NativeGlassButton
                        label={t('teams.enterMap')}
                        onPress={() => handleEnterGroup(info)}
                        accessibilityLabel={t('teams.enterMap')}
                        shape="capsule"
                        variant="glassProminent"
                        tintColor={accent}
                        foregroundColor="#fff"
                        height={48}
                        style={[styles.inlineEnterBtn, { backgroundColor: accent }]}
                      />

                      <NativeGlassButton
                        label={t('teams.leave')}
                        onPress={() => handleLeaveGroup(info.group.id)}
                        accessibilityLabel={t('teams.leave')}
                        shape="capsule"
                        variant="glass"
                        foregroundColor="#ff453a"
                        width={80}
                        height={48}
                        style={styles.inlineLeaveBtn}
                      />
                    </View>
                  </Animated.View>
              )}
            </Animated.View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  backBtn: { width: 78, height: 36 },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  clearBtn: { width: 76, height: 36 },
  list: {
    padding: 20,
    gap: 16,
  },
  teamCard: { width: '100%', minHeight: 84 },
  expandedSection: {
    marginTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.1)',
    paddingTop: 16,
  },
  detailAvatars: {
    height: 48,
    marginBottom: 20,
    width: '100%',
  },
  detailAvatarsScroll: {
    gap: 10,
    alignItems: 'center',
  },
  detailAvatarBig: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  detailEmojiBig: { fontSize: 24 },
  inviteCodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  inviteCodeLabel: {
    fontSize: 13,
    color: 'rgba(235,235,245,0.55)',
    fontWeight: '600',
  },
  inviteCodeValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
  },
  expandedButtonsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  inlineEnterBtn: {
    flex: 1,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineEnterText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  inlineLeaveBtn: {
    width: 80,
    height: 48,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineLeaveText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ff453a',
  },
  pressed: { opacity: 0.8 },
});
