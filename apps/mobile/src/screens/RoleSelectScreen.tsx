import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, ScrollView, Modal, Alert, Dimensions, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useTheme } from '../state/PreferencesContext';
import { useTranslation } from '../i18n';
import { accentMix } from '../glass';
import { lightTap, alertBuzz } from '../utils/haptics';
import { logEvent } from '../utils/activityLog';
import CrookIcon from '../components/CrookIcon';
import { useSession } from '../state/SessionContext';
import { getMyJoinedGroups, JoinedGroupInfo } from '../api/client';
import Animated, { FadeIn, FadeOut, SlideInDown, ZoomIn, LinearTransition } from 'react-native-reanimated';

type Props = NativeStackScreenProps<RootStackParamList, 'RoleSelect'>;

export default function RoleSelectScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const accent = colors.accent;
  const { user } = useSession();

  const [joinedGroups, setJoinedGroups] = useState<JoinedGroupInfo[]>([]);

  useEffect(() => {
    if (user) {
      getMyJoinedGroups().then(setJoinedGroups).catch((e) => console.log('Failed to fetch joined groups', e));
    }
  }, [user]);

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
          style={[styles.back, { top: insets.top + 12 }]}
        >
          <Ionicons name="chevron-back" size={22} color="rgba(255,255,255,0.7)" />
        </Pressable>
      )}

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
          <Animated.View entering={SlideInDown.duration(600).springify().delay(200)} style={styles.actionRow}>
            <Pressable
              onPress={() => { lightTap(); logEvent('role_select', { role: 'leader' }); navigation.navigate('Auth', { role: 'leader' }); }}
              style={({ pressed }) => [
                styles.actionTile,
                { backgroundColor: accent, borderColor: accent },
                pressed && styles.pressed,
              ]}
            >
              <CrookIcon size={32} color="#fff" />
              <Text style={styles.actionTileText}>{t('role.lead')}</Text>
            </Pressable>

            <Pressable
              onPress={() => { lightTap(); logEvent('role_select', { role: 'follower' }); navigation.navigate('Auth', { role: 'follower' }); }}
              style={({ pressed }) => [
                styles.actionTile,
                { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.2)' },
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="keypad" size={32} color="#fff" />
              <Text style={styles.actionTileText}>{t('role.join')}</Text>
            </Pressable>
          </Animated.View>

          {joinedGroups.length > 0 && (
            <Animated.View entering={FadeIn.duration(400)}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => { lightTap(); navigation.navigate('MyTeams', { initialGroups: joinedGroups }); }}
                style={[
                  styles.ctaMyTeams,
                  { backgroundColor: 'rgba(255,255,255,0.12)', marginTop: 32 }
                ]}
              >
                <Ionicons name="people-outline" size={20} color={accent} />
                <Text style={styles.ctaMyTeamsText}>查看我的隊伍 ({joinedGroups.length})</Text>
              </TouchableOpacity>
            </Animated.View>
          )}

          <Animated.View entering={FadeIn.duration(600).delay(300)}>
            <Text style={[styles.footer, { marginTop: 16 }]}>{t('role.footer')}</Text>
          </Animated.View>
        </View>
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
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    zIndex: 10,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  spacer: { flex: 1 },
  actionArea: {
    width: '100%',
    alignItems: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 14,
    marginBottom: 16,
  },
  actionTile: {
    flex: 1,
    aspectRatio: 1.2,
    borderRadius: 24,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  actionTileText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  ctaMyTeams: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.15)',
    marginBottom: 16,
  },
  ctaGlassBg: {
    ...StyleSheet.absoluteFillObject,
  },
  ctaMyTeamsText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  footer: {
    fontSize: 13,
    color: 'rgba(235,235,245,0.4)',
  },
  pressed: { opacity: 0.8 },
  

});
