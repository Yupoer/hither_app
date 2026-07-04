import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useTheme } from '../state/PreferencesContext';
import { useTranslation } from '../i18n';
import { glass, accentMix } from '../glass';
import CrookIcon from '../components/CrookIcon';
import { DEMO_GROUP_ID } from '../api/demo';

type Props = NativeStackScreenProps<RootStackParamList, 'RoleSelect'>;

/**
 * First screen (design: "Role select"). Pick a role and drop straight into the
 * flow — no lobby. "Lead a group" → create a group as shepherd; "Join with a
 * code" → enter a code as flock. Both land on the Auth screen for a nickname.
 *
 * Always dark (the design's radial night sky) regardless of the map theme.
 */
export default function RoleSelectScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const accent = colors.accent;

  return (
    <LinearGradient
      colors={['#1f3050', '#0e1622', '#080b12']}
      locations={[0, 0.52, 1]}
      style={styles.fill}
    >
      {/* Only a guest (who reached here via navigate, not replace) can go
          back — to Login, to register instead. Authed users have no Login
          below them, so this stays hidden. */}
      {navigation.canGoBack() && (
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={[styles.back, { top: insets.top + 12 }]}
        >
          <Ionicons name="chevron-back" size={22} color="rgba(255,255,255,0.7)" />
        </Pressable>
      )}

      <View
        style={[
          styles.content,
          { paddingTop: insets.top + 96, paddingBottom: insets.bottom + 32 },
        ]}
      >
        <CrookIcon size={86} color={accent} glow style={styles.logo} />
        <Text style={styles.title}>Hither</Text>
        <Text style={styles.tagline}>{t('role.tagline')}</Text>

        <View style={styles.spacer} />

        <Pressable
          onPress={() => navigation.navigate('Auth', { role: 'leader' })}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.cta,
            {
              backgroundColor: accentMix(accent, 24),
              borderColor: accentMix(accent, 55),
            },
            pressed && styles.pressed,
          ]}
        >
          <CrookIcon size={22} color={accent} />
          <Text style={styles.ctaText}>{t('role.lead')}</Text>
        </Pressable>

        <Pressable
          onPress={() => navigation.navigate('Auth', { role: 'follower' })}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.cta,
            styles.ctaGhost,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.ctaText}>{t('role.join')}</Text>
        </Pressable>

        {__DEV__ && (
          <Pressable
            onPress={() => navigation.navigate('Map', { groupId: DEMO_GROUP_ID })}
            accessibilityRole="button"
            style={({ pressed }) => [styles.demo, pressed && styles.pressed]}
          >
            <Text style={styles.demoText}>{t('role.demo')}</Text>
          </Pressable>
        )}

        <Text style={styles.footer}>{t('role.footer')}</Text>
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
    paddingHorizontal: 30,
  },
  logo: { marginBottom: 4 },
  title: {
    fontSize: 42,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: '#fff',
    marginTop: 22,
  },
  tagline: {
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
    color: 'rgba(235,235,245,0.62)',
    marginTop: 10,
    maxWidth: 240,
  },
  spacer: { flex: 1 },
  cta: {
    width: '100%',
    height: 56,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  ctaGhost: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.18)',
  },
  ctaText: { fontSize: 17, fontWeight: '600', color: '#fff' },
  demo: { paddingVertical: 10, paddingHorizontal: 16 },
  demoText: { fontSize: 14, fontWeight: '600', color: 'rgba(235,235,245,0.55)' },
  pressed: { opacity: 0.85 },
  footer: {
    marginTop: 22,
    fontSize: 13,
    color: 'rgba(235,235,245,0.4)',
  },
});
