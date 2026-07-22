import React, { useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useTheme } from '../state/PreferencesContext';
import { useTranslation } from '../i18n';
import { lightTap } from '../utils/haptics';
import { logEvent } from '../utils/activityLog';
import CrookIcon from '../components/CrookIcon';
import { useSession } from '../state/SessionContext';
import {
  getCachedMyJoinedGroups,
  getMyJoinedGroups,
  JoinedGroupInfo,
} from '../api/client';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';

type Props = NativeStackScreenProps<RootStackParamList, 'RoleSelect'>;

/**
 * RoleSelect sits on a dark gradient mid-tone ≈ #0e1622.
 * Android composites translucent rounded fills + elevation/outline as a dark
 * “black frame” — use solid pre-blended fills there instead of low-alpha rgba.
 */
const IS_ANDROID = Platform.OS === 'android';
const CHROME_FILL = IS_ANDROID ? '#1c2432' : 'rgba(255,255,255,0.08)';
const CHROME_BORDER = IS_ANDROID ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.18)';
const JOIN_FILL = IS_ANDROID ? '#1c2432' : 'rgba(255,255,255,0.08)';
const JOIN_BORDER = IS_ANDROID ? 'rgba(255,255,255,0.24)' : 'rgba(255,255,255,0.2)';
const MY_TEAMS_FILL = IS_ANDROID ? '#242c3a' : 'rgba(255,255,255,0.12)';

export default function RoleSelectScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const accent = colors.accent;
  const { user, signOut } = useSession();

  // Paint from in-memory cache immediately; refresh in background without
  // waiting for the full (profiles) path.
  const cached = user ? getCachedMyJoinedGroups(user.id) : null;
  const [joinedGroups, setJoinedGroups] = useState<JoinedGroupInfo[]>(cached ?? []);
  const [groupsLoading, setGroupsLoading] = useState(!!user && !cached);

  useEffect(() => {
    if (!user) {
      setJoinedGroups([]);
      setGroupsLoading(false);
      return;
    }

    const fromCache = getCachedMyJoinedGroups(user.id);
    if (fromCache) {
      setJoinedGroups(fromCache);
      setGroupsLoading(false);
    } else {
      setGroupsLoading(true);
    }

    let cancelled = false;
    // RoleSelect only needs count + names; skip profiles for a faster first paint.
    getMyJoinedGroups({ includeProfiles: false })
      .then((list) => {
        if (!cancelled) setJoinedGroups(list);
      })
      .catch((e) => console.log('Failed to fetch joined groups', e))
      .finally(() => {
        if (!cancelled) setGroupsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const showMyTeams = joinedGroups.length > 0;
  // Keep the far gap reserved while loading so the CTA doesn't "pop" closer then jump away.
  const reserveMyTeamsSlot = !!user && (groupsLoading || showMyTeams);

  return (
    <LinearGradient
      colors={['#1f3050', '#0e1622', '#080b12']}
      locations={[0, 0.52, 1]}
      style={styles.fill}
    >
      {navigation.canGoBack() && (
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          android_ripple={IS_ANDROID ? { color: 'transparent' } : undefined}
          style={[styles.back, { top: insets.top + 12, backgroundColor: CHROME_FILL, borderColor: CHROME_BORDER }]}
        >
          <Ionicons name="chevron-back" size={22} color="rgba(255,255,255,0.7)" />
        </Pressable>
      )}
      <Pressable
        onPress={() => Alert.alert(
          t('settings.signOutTitle'),
          t('settings.signOutMsg'),
          [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('settings.signOut'),
              style: 'destructive',
              onPress: () => {
                logEvent('sign_out');
                void signOut().then(() => navigation.reset({ index: 0, routes: [{ name: 'Login' }] }));
              },
            },
          ],
        )}
        accessibilityRole="button"
        accessibilityLabel={t('settings.signOut')}
        android_ripple={IS_ANDROID ? { color: 'transparent' } : undefined}
        style={[styles.logout, { top: insets.top + 12, backgroundColor: CHROME_FILL, borderColor: CHROME_BORDER }]}
      >
        <Ionicons name="log-out-outline" size={20} color="rgba(255,255,255,0.8)" />
        <Text style={styles.logoutText}>{t('settings.signOut')}</Text>
      </Pressable>

      <View
        style={[
          styles.content,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 },
        ]}
      >
        <Animated.View entering={ZoomIn.duration(800).springify()} style={styles.headerArea}>
          <CrookIcon size={96} color={accent} glow style={styles.logo} />
          <Text style={styles.title}>Hither</Text>
          <Text style={styles.tagline}>{t('role.tagline')}</Text>
        </Animated.View>

        <View style={{ height: 56 }} />

        <View style={styles.actionArea}>
          {/* Create / join stay fixed — no slide-up entrance. */}
          <View style={styles.actionRow}>
            <Pressable
              onPress={() => { lightTap(); logEvent('role_select', { role: 'leader' }); navigation.navigate('Auth', { role: 'leader' }); }}
              android_ripple={IS_ANDROID ? { color: 'transparent' } : undefined}
              style={[styles.actionTile, { backgroundColor: accent, borderColor: accent }]}
            >
              <CrookIcon size={32} color="#fff" />
              <Text style={styles.actionTileText}>{t('role.lead')}</Text>
            </Pressable>

            <Pressable
              onPress={() => { lightTap(); logEvent('role_select', { role: 'follower' }); navigation.navigate('Auth', { role: 'follower' }); }}
              android_ripple={IS_ANDROID ? { color: 'transparent' } : undefined}
              style={[styles.actionTile, { backgroundColor: JOIN_FILL, borderColor: JOIN_BORDER }]}
            >
              <Ionicons name="keypad" size={32} color="#fff" />
              <Text style={styles.actionTileText}>{t('role.join')}</Text>
            </Pressable>
          </View>

          {reserveMyTeamsSlot && (
            <>
              <View style={styles.myTeamsSpacer} />
              {showMyTeams ? (
                <Animated.View entering={FadeIn.duration(400)}>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => { lightTap(); navigation.navigate('MyTeams', { initialGroups: joinedGroups }); }}
                    style={[styles.ctaMyTeams, { backgroundColor: MY_TEAMS_FILL }]}
                  >
                    <Ionicons name="people-outline" size={20} color={accent} />
                    <Text style={styles.ctaMyTeamsText}>查看我的隊伍 ({joinedGroups.length})</Text>
                  </TouchableOpacity>
                </Animated.View>
              ) : (
                <View style={styles.myTeamsSlot} />
              )}
            </>
          )}

          <Animated.View entering={FadeIn.duration(600).delay(300)}>
            <Text style={[styles.footer, { marginTop: 16 }]}>{t('role.footer')}</Text>
          </Animated.View>
        </View>

        {/* Leftover height stays below actions — keeps create/join ↔ my-teams distance fixed. */}
        <View style={styles.bottomFlex} />
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  back: {
    position: 'absolute',
    left: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    // elevation:0 — translucent rounded chrome must not cast Android shadow frames
    elevation: 0,
    zIndex: 10,
  },
  logout: {
    position: 'absolute',
    right: 20,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    elevation: 0,
    zIndex: 10,
  },
  logoutText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  headerArea: {
    alignItems: 'center',
    marginTop: 0,
  },
  logo: { marginBottom: 12 },
  title: {
    fontSize: 48,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: '#fff',
    marginTop: 16,
  },
  tagline: {
    fontSize: 17,
    lineHeight: 24,
    textAlign: 'center',
    color: 'rgba(235,235,245,0.6)',
    marginTop: 12,
    maxWidth: 260,
  },
  actionArea: {
    width: '100%',
    alignItems: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 14,
  },
  actionTile: {
    flex: 1,
    aspectRatio: 1.2,
    borderRadius: 24,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    // Clip ripple + kill Android elevation outline on rounded tiles.
    overflow: 'hidden',
    elevation: 0,
  },
  actionTileText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  /** Fixed far gap between primary tiles and the my-teams CTA. */
  myTeamsSpacer: { height: 64 },
  ctaMyTeams: {
    minHeight: 54,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    overflow: 'hidden',
    elevation: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  /** Same height as ctaMyTeams so load → show keeps the far gap stable. */
  myTeamsSlot: {
    minHeight: 54,
    alignSelf: 'stretch',
  },
  ctaMyTeamsText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  footer: {
    fontSize: 13,
    color: 'rgba(235,235,245,0.4)',
  },
  bottomFlex: { flex: 1 },
});
