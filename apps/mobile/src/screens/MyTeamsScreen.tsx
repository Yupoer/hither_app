import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useTheme } from '../state/PreferencesContext';
import { accentMix } from '../glass';
import { lightTap, alertBuzz } from '../utils/haptics';
import { useSession } from '../state/SessionContext';
import { getMyJoinedGroups, JoinedGroupInfo, leaveGroups } from '../api/client';
import { GlassView } from '../native/liquidGlass';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

type Props = NativeStackScreenProps<RootStackParamList, 'MyTeams'>;

export default function MyTeamsScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const accent = colors.accent;
  const { user, setMembership } = useSession();

  const [joinedGroups, setJoinedGroups] = useState<JoinedGroupInfo[]>(route.params?.initialGroups || []);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(!route.params?.initialGroups?.length);

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

  function handleEnterGroup(info: JoinedGroupInfo) {
    setExpandedGroupId(null);
    lightTap();
    setMembership({ group: info.group, role: info.role });
    navigation.replace('Map', { groupId: info.group.id });
  }

  function handleLeaveGroup(groupId: string) {
    alertBuzz();
    Alert.alert('離開隊伍', '確定要離開這個隊伍嗎？', [
      { text: '取消', style: 'cancel' },
      {
        text: '確定',
        style: 'destructive',
        onPress: async () => {
          try {
            await leaveGroups([groupId]);
            setJoinedGroups((prev) => prev.filter((g) => g.group.id !== groupId));
            setExpandedGroupId(null);
          } catch (e) {
            console.error('Failed to leave group', e);
          }
        },
      },
    ]);
  }

  function handleClearAllGroups() {
    alertBuzz();
    Alert.alert('清空隊伍', '確定要離開所有隊伍嗎？', [
      { text: '取消', style: 'cancel' },
      {
        text: '確定清空',
        style: 'destructive',
        onPress: async () => {
          try {
            const groupIds = joinedGroups.map((g) => g.group.id);
            await leaveGroups(groupIds);
            setJoinedGroups([]);
            navigation.goBack();
          } catch (e) {
            console.error('Failed to clear groups', e);
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.fill}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Pressable onPress={() => { lightTap(); navigation.goBack(); }} style={styles.backBtn} accessibilityRole="button">
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </Pressable>
        <Text style={styles.title}>我的隊伍</Text>
        <Pressable onPress={handleClearAllGroups} style={styles.clearBtn} hitSlop={10}>
          <Text style={styles.clearText}>清空</Text>
        </Pressable>
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
              <Pressable
                onPress={() => {
                  lightTap();
                  setExpandedGroupId(isExpanded ? null : info.group.id);
                }}
                style={({ pressed }) => [
                  styles.teamCard,
                  { backgroundColor: 'rgba(255,255,255,0.1)' },
                  pressed && !isExpanded && styles.pressed
                ]}
              >
                
                <View style={styles.teamCardHeader}>
                  <View style={styles.teamCardLeft}>
                    <Text style={styles.teamCardName} numberOfLines={1}>{info.group.name}</Text>
                    <Text style={styles.teamCardSubtitle}>{info.memberCount} 人</Text>
                  </View>
                  <View style={styles.teamCardRight}>
                    <View style={styles.avatarStack}>
                      {displayAvatars.map((p, i) => (
                        <View key={i} style={[styles.avatarBubble, { backgroundColor: p.avatarColor || '#333', zIndex: 10 - i }]}>
                          {p.isPlaceholder ? (
                            <Ionicons name="person" size={14} color="rgba(255,255,255,0.2)" />
                          ) : (
                            <Text style={styles.avatarEmoji}>{p.avatar || '😎'}</Text>
                          )}
                        </View>
                      ))}
                      {extraCount > 0 && (
                        <View style={[styles.avatarBubble, styles.avatarExtra, { zIndex: 0 }]}>
                          <Text style={styles.avatarExtraText}>+{extraCount}</Text>
                        </View>
                      )}
                    </View>
                    <Ionicons 
                      name={isExpanded ? "chevron-up" : "chevron-down"} 
                      size={20} 
                      color="rgba(255,255,255,0.4)" 
                      style={{ marginLeft: 8 }} 
                    />
                  </View>
                </View>

                {isExpanded && (
                  <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.expandedSection}>
                    <View style={styles.detailAvatars}>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.detailAvatarsScroll}>
                        {detailAvatars.map((p, i) => (
                          <View key={i} style={[styles.detailAvatarBig, { backgroundColor: p.avatarColor || '#333' }]}>
                            {p.isPlaceholder ? (
                              <Ionicons name="person" size={20} color="rgba(255,255,255,0.2)" />
                            ) : (
                              <Text style={styles.detailEmojiBig}>{p.avatar || '😎'}</Text>
                            )}
                          </View>
                        ))}
                      </ScrollView>
                    </View>

                    <View style={styles.expandedButtonsRow}>
                      <Pressable
                        onPress={() => handleEnterGroup(info)}
                        style={({ pressed }) => [styles.inlineEnterBtn, { backgroundColor: accent }, pressed && styles.pressed]}
                      >
                        <Text style={styles.inlineEnterText}>進入地圖</Text>
                      </Pressable>

                      <Pressable
                        onPress={() => handleLeaveGroup(info.group.id)}
                        style={({ pressed }) => [styles.inlineLeaveBtn, pressed && styles.pressed]}
                      >
                        <Text style={styles.inlineLeaveText}>離開</Text>
                      </Pressable>
                    </View>
                  </Animated.View>
                )}
              </Pressable>
            </Animated.View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#080b12' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  clearBtn: {
    width: 44,
    height: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  clearText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ff453a',
  },
  list: {
    padding: 20,
    gap: 16,
  },
  teamCard: {
    flexDirection: 'column',
    padding: 16,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  teamCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  teamCardLeft: {
    flex: 1,
    marginRight: 12,
  },
  teamCardName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  teamCardSubtitle: {
    fontSize: 14,
    color: 'rgba(235,235,245,0.6)',
  },
  teamCardRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarBubble: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#1e293b',
    marginLeft: -10,
  },
  avatarEmoji: { fontSize: 16 },
  avatarExtra: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  avatarExtraText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
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
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  detailEmojiBig: { fontSize: 24 },
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
