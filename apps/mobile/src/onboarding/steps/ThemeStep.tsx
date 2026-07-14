import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { themes, THEME_ORDER, type ThemeName } from '../../theme';
import { accentMix } from '../../glass';
import CrookIcon from '../../components/CrookIcon';
import { HitherText } from '../../components/HitherText';
import { usePreferences, useTheme } from '../../state/PreferencesContext';
import { useTranslation, type TranslationKey } from '../../i18n';
import type { StepProps } from '../types';
import StepShell from './StepShell';
import PrimaryButton from './PrimaryButton';
import { selectionTick } from '../../utils/haptics';

// Rounded display face shared with the map / gathering-point cards (Latin only;
// CJK falls back to system, just larger). Loaded in App.tsx.
const DISPLAY_FONT = 'Fredoka_600SemiBold';
// Warm off-white (米白) that replaces the stark pure-white of the light theme.
const MILK_WHITE = '#F5F0E4';

const THEME_LABEL_KEY: Record<ThemeName, TranslationKey> = {
  night: 'onboarding.theme.night',
  day: 'onboarding.theme.day',
  dusk: 'onboarding.theme.dusk',
  forest: 'onboarding.theme.forest',
};

/** Mini basemap gradients — map preview, not solid accent chips. */
const BASEMAP: Record<ThemeName, [string, string]> = {
  night: ['#0E1320', '#16264A'],
  day: ['#E8F0F8', '#F7F5F0'],
  dusk: ['#15101F', '#2A1B3D'],
  forest: ['#0D1A14', '#1A3326'],
};

function ThemePreviewCard({
  name,
  selected,
  onPress,
  label,
}: {
  name: ThemeName;
  selected: boolean;
  onPress: () => void;
  label: string;
}) {
  const palette = themes[name];
  const [from, to] = BASEMAP[name];
  const pathColor = accentMix(palette.textSecondary, name === 'day' ? 35 : 22);
  const glassBar =
    name === 'day' ? 'rgba(255,255,255,0.72)' : 'rgba(20,24,36,0.55)';
  const labelColor = name === 'day' ? palette.textPrimary : '#F5F7FB';

  // Soft one-shot / slow breath only while selected — not a frantic loop.
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (selected) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1.08, { duration: 1200 }),
          withTiming(1, { duration: 1200 }),
        ),
        -1,
        false,
      );
    } else {
      pulse.value = withTiming(1, { duration: 200 });
    }
  }, [selected, pulse]);

  const beaconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
    opacity: 0.85 + (pulse.value - 1) * 1.5,
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={selected ? `${label}, selected` : label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        selected && { ...styles.cardGlow, shadowColor: palette.accent },
        selected && { transform: [{ scale: 1.03 }] },
        pressed && { transform: [{ scale: 0.97 }], opacity: 0.95 },
        !selected && { opacity: 0.92 },
      ]}
    >
      <LinearGradient
        colors={[from, to]}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Soft path arc — polyline feel without MapView. */}
      <View style={[styles.path, { borderColor: pathColor }]} pointerEvents="none" />

      {/* Accent beacon + crook. */}
      <Animated.View style={[styles.beaconWrap, beaconStyle]} pointerEvents="none">
        <View style={[styles.beaconRing, { borderColor: accentMix(palette.accent, 45) }]}>
          <View style={[styles.beaconDot, { backgroundColor: palette.accent }]} />
        </View>
        <CrookIcon size={22} color={palette.accent} style={styles.crook} />
      </Animated.View>

      {/* Fake glass sheet strip at bottom of the mini map. */}
      <View style={[styles.glassBar, { backgroundColor: glassBar }]} pointerEvents="none">
        <View style={[styles.glassGrabber, { backgroundColor: accentMix(palette.accent, 40) }]} />
        <HitherText
          typeRole="title"
          style={[styles.cardLabel, { color: labelColor, fontFamily: DISPLAY_FONT }]}
          numberOfLines={2}
        >
          {label}
        </HitherText>
      </View>

      {/* Accent soft ring — never pure white sticker border. */}
      {selected ? (
        <View
          style={[styles.cardRing, { borderColor: accentMix(palette.accent, 50) }]}
          pointerEvents="none"
        />
      ) : null}

      {selected ? (
        <View style={[styles.cardCheck, { backgroundColor: palette.accent }]}>
          <Ionicons name="checkmark" size={12} color={palette.accentText} />
        </View>
      ) : null}
    </Pressable>
  );
}

export default function ThemeStep({ answers, onAnswer, onSkip, onBack }: StepProps) {
  const { colors, themeName } = useTheme();
  const { setThemeName } = usePreferences();
  const { t } = useTranslation();

  // The light ("day") theme's near-white background reads too stark here — warm
  // it to 米白. Dark themes keep their own background so text stays readable.
  const background = themeName === 'day' ? MILK_WHITE : colors.background;

  return (
    <StepShell
      step="theme"
      role={answers.role}
      kicker={t('onboarding.theme.kicker')}
      title={t('onboarding.theme.title')}
      subtitle={t('onboarding.theme.subtitle')}
      onBack={onBack}
      onSkip={onSkip}
      background={background}
      footer={
        <PrimaryButton
          label={t('onboarding.continue')}
          onPress={() => onAnswer({ theme: themeName })}
        />
      }
    >
      <View style={styles.grid}>
        {THEME_ORDER.map((name) => (
          <ThemePreviewCard
            key={name}
            name={name}
            selected={themeName === name}
            label={t(THEME_LABEL_KEY[name])}
            onPress={() => {
              selectionTick();
              setThemeName(name);
            }}
          />
        ))}
      </View>
    </StepShell>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    justifyContent: 'space-between',
  },
  card: {
    width: '47%',
    aspectRatio: 0.92,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#0E1320',
  },
  cardGlow: {
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 8,
  },
  path: {
    position: 'absolute',
    left: '12%',
    right: '18%',
    top: '28%',
    height: 48,
    borderRadius: 40,
    borderWidth: 2,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    transform: [{ rotate: '-12deg' }],
  },
  beaconWrap: {
    position: 'absolute',
    top: '34%',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  beaconRing: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  beaconDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  crook: {
    position: 'absolute',
    right: -14,
    top: -10,
  },
  glassBar: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    alignItems: 'center',
  },
  glassGrabber: {
    width: 28,
    height: 3,
    borderRadius: 2,
    marginBottom: 6,
    opacity: 0.7,
  },
  cardLabel: {
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  cardRing: {
    position: 'absolute',
    top: 5,
    left: 5,
    right: 5,
    bottom: 5,
    borderRadius: 20,
    borderWidth: 2,
  },
  cardCheck: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
