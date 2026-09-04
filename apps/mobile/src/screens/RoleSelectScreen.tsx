import React, { useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useIsFocused } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useTheme } from '../state/PreferencesContext';
import { useTranslation } from '../i18n';
import { lightTap } from '../utils/haptics';
import { logEvent } from '../utils/activityLog';
import { runUiAction } from '../utils/uiAction';
import CrookIcon from '../components/CrookIcon';
import LanguagePicker from '../components/LanguagePicker';
import NativeGlassButton from '../components/NativeGlassButton';
import NativeRoleActionButton from '../components/NativeRoleActionButton';
import NativeTeamsButton from '../components/NativeTeamsButton';
import MetalforgeBackground from '../components/MetalforgeBackground';
import { useSession } from '../state/SessionContext';
import {
  getCachedMyJoinedGroups,
  getMyJoinedGroups,
  JoinedGroupInfo,
} from '../api/client';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';

type Props = NativeStackScreenProps<RootStackParamList, 'RoleSelect'>;

// Keep Android's opaque fallback fills; iOS renders the native glass tile.
const IS_ANDROID = Platform.OS === 'android';
const JOIN_FILL = IS_ANDROID ? '#1c2432' : 'rgba(255,255,255,0.08)';

const appVersion =
  Constants.expoConfig?.version ??
  Constants.nativeAppVersion ??
  '0.1.7';
export default function RoleSelectScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
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

  function startSignOut(): void {
    void runUiAction(
      'role_select.sign_out',
      async (token) => {
        logEvent('sign_out');
        await signOut();
        if (!token.isCurrent()) return;
        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      },
      {
        screen: 'RoleSelect',
        suppressBanner: true,
        onError: (kind) => {
          const message = kind === 'timeout'
            ? t('interaction.signOutTimeout')
            : t('interaction.error');
          Alert.alert(t('settings.signOutTitle'), message, [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('interaction.retry'), onPress: startSignOut },
          ]);
        },
      },
    );
  }

  return (
    <View style={styles.fill}>
      <MetalforgeBackground active={isFocused} />
      <View style={[styles.leftChrome, { top: insets.top + 8 }]}>
        {navigation.canGoBack() ? (
          <NativeGlassButton
            onPress={() => navigation.goBack()}
            systemImage="chevron.left"
            width={45}
            height={45}
            imageSize={19.2}
            iconOffset={{ x: 1.16 }}
            shape="capsule"
            variant="glass"
            accessibilityLabel={t('common.back')}
            style={styles.back}
          />
        ) : null}
        <LanguagePicker variant="menu" />
      </View>
      <NativeGlassButton
        systemImage="rectangle.portrait.and.arrow.right"
        onPress={() => Alert.alert(
          t('settings.signOutTitle'),
          t('settings.signOutMsg'),
          [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('settings.signOut'),
              style: 'destructive',
              onPress: startSignOut,
            },
          ],
        )}
        accessibilityLabel={t('settings.signOut')}
        shape="capsule"
        width={45}
        height={45}
        imageSize={19.2}
        variant="glass"
        foregroundColor="#fff"
        iconOffset={{ x: 2.5 }}
        style={[styles.logout, { top: insets.top + 8 }]}
      />
      <View
        style={[styles.versionChrome, { bottom: Math.max(insets.bottom, 10) }]}
        pointerEvents="none"
      >
        <Text style={styles.versionText}>V{appVersion}</Text>
      </View>

      <View
        style={[
          styles.content,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 },
        ]}
      >
        <Animated.View entering={ZoomIn.duration(800).springify()} style={styles.headerArea}>
          <CrookIcon size={96} color={accent} glow style={styles.logo} />
          <Text style={styles.title}>Hither</Text>
        </Animated.View>

        <View style={{ height: 56 }} />

        <View style={styles.actionArea}>
          {/* Create / join stay fixed — no slide-up entrance. */}
          <View style={styles.actionRow}>
            <NativeRoleActionButton
              label="創建群組"
              systemImage="person.2.badge.plus"
              onPress={() => { lightTap(); logEvent('role_select', { role: 'leader' }); navigation.navigate('Auth', { role: 'leader' }); }}
              accessibilityLabel="創建群組"
              testID="role-create"
              accent="rgba(10, 16, 28, 0.65)"
              style={styles.actionTile}
            />

            <NativeRoleActionButton
              label="用代碼加入"
              systemImage="keypad"
              onPress={() => { lightTap(); logEvent('role_select', { role: 'follower' }); navigation.navigate('Auth', { role: 'follower' }); }}
              accessibilityLabel="用代碼加入"
              testID="role-join"
              accent="rgba(10, 16, 28, 0.65)"
              style={styles.actionTile}
            />
          </View>
          {reserveMyTeamsSlot && (
            <>
              <View style={styles.myTeamsSpacer} />
              {showMyTeams ? (
                <Animated.View entering={FadeIn.duration(400)}>
                  <NativeTeamsButton
                    label={t('role.myTeams')}
                    count={joinedGroups.length || 3}
                    onPress={() => { lightTap(); navigation.navigate('MyTeams', { initialGroups: joinedGroups }); }}
                    accessibilityLabel={t('role.myTeams', { count: joinedGroups.length || 3 })}
                    testID="role-my-teams"
                    style={styles.ctaMyTeams}
                  />
                </Animated.View>
              ) : (
                <View style={styles.myTeamsSlot} />
              )}
            </>
          )}

        </View>

        {/* Leftover height stays below actions — keeps create/join ↔ my-teams distance fixed. */}
        <View style={styles.bottomFlex} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  leftChrome: {
    position: 'absolute',
    left: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 10,
  },
  back: {
    width: 45,
    height: 45,
  },
  logout: {
    position: 'absolute',
    right: 20,
    width: 45,
    height: 45,
    zIndex: 10,
  },
  versionChrome: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  versionText: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.65)',
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
    aspectRatio: 1,
    overflow: 'hidden',
    elevation: 0,
  },
  /** Fixed gap between primary tiles and the my-teams CTA. */
  myTeamsSpacer: { height: 64 },
  ctaMyTeams: { height: 56, paddingHorizontal: 30, borderRadius: 28, alignSelf: 'center' },
  /** Same height as ctaMyTeams so load → show keeps the far gap stable. */
  myTeamsSlot: {
    minHeight: 56,
    alignSelf: 'stretch',
  },
  bottomFlex: { flex: 1 },
});
