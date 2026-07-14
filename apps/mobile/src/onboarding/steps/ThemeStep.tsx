import React, { useEffect } from 'react';
import { PixelRatio, Pressable, StyleSheet, View } from 'react-native';
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

/** 1px physical hairline that stays sharp on 2x/3x screens. */
const HAIR = StyleSheet.hairlineWidth * 2;
const BORDER = Math.max(1.5, PixelRatio.roundToNearestPixel(1.5));

const THEME_LABEL_KEY: Record<ThemeName, TranslationKey> = {
  night: 'onboarding.theme.night',
  day: 'onboarding.theme.day',
  dusk: 'onboarding.theme.dusk',
  forest: 'onboarding.theme.forest',
};

/** 3-stop basemap — smoother than 2-stop, less banding on OLED. */
const BASEMAP: Record<ThemeName, [string, string, string]> = {
  night: ['#0B101C', '#141E36', '#1A2A4A'],
  day: ['#DCE8F4', '#EBF1F6', '#F6F4EE'],
  dusk: ['#120C1A', '#1F152E', '#2E1F42'],
  forest: ['#0A1510', '#12241A', '#1A3326'],
};

/** Soft landmass / water blobs for map depth (not solid accent chips). */
const LAND: Record<ThemeName, string> = {
  night: 'rgba(80, 110, 160, 0.12)',
  day: 'rgba(120, 160, 120, 0.18)',
  dusk: 'rgba(140, 100, 180, 0.14)',
  forest: 'rgba(70, 140, 90, 0.16)',
};
const WATER: Record<ThemeName, string> = {
  night: 'rgba(90, 140, 200, 0.14)',
  day: 'rgba(100, 160, 210, 0.22)',
  dusk: 'rgba(100, 120, 180, 0.12)',
  forest: 'rgba(70, 130, 150, 0.14)',
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
  const [c0, c1, c2] = BASEMAP[name];
  const road = accentMix(palette.textSecondary, name === 'day' ? 28 : 18);
  const roadStrong = accentMix(palette.textSecondary, name === 'day' ? 40 : 28);
  // Label sits on basemap directly (no glass sheet chrome / grabber bar).
  const labelColor = name === 'day' ? palette.textPrimary : '#F5F7FB';
  const labelVeil =
    name === 'day' ? ['rgba(247,245,240,0)', 'rgba(247,245,240,0.88)'] : ['rgba(10,14,22,0)', 'rgba(10,14,22,0.78)'];

  // Soft breath on the beacon ring only — never scale the whole card
  // (card-level scale + overflow:hidden rasterizes soft / low-res on iOS).
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (selected) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1.06, { duration: 1300 }),
          withTiming(1, { duration: 1300 }),
        ),
        -1,
        false,
      );
    } else {
      pulse.value = withTiming(1, { duration: 200 });
    }
  }, [selected, pulse]);

  const ringPulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
    opacity: 0.55 + (pulse.value - 1) * 4,
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={selected ? `${label}, selected` : label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.card,
        selected && { ...styles.cardGlow, shadowColor: palette.accent },
        // Press only — no permanent selected scale (keeps edges crisp).
        pressed && { transform: [{ scale: 0.98 }], opacity: 0.96 },
        !selected && !pressed && { opacity: 0.94 },
      ]}
    >
      {/* In-flow scaffold: absolute-only kids collapse to 0 height in Yoga. */}
      <View style={styles.cardScaffold} pointerEvents="none" collapsable={false} />

      <LinearGradient
        colors={[c0, c1, c2]}
        locations={[0, 0.45, 1]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* Map terrain — soft water + land masses for depth without bitmaps. */}
      <View
        style={[styles.waterBlob, { backgroundColor: WATER[name] }]}
        pointerEvents="none"
      />
      <View
        style={[styles.landBlob, { backgroundColor: LAND[name] }]}
        pointerEvents="none"
      />
      <View
        style={[styles.landBlobSm, { backgroundColor: LAND[name] }]}
        pointerEvents="none"
      />

      {/* Road grid — thin native strokes stay sharp at @2x/@3x. */}
      <View style={[styles.roadH, { backgroundColor: road }]} pointerEvents="none" />
      <View style={[styles.roadH2, { backgroundColor: road }]} pointerEvents="none" />
      <View style={[styles.roadV, { backgroundColor: road }]} pointerEvents="none" />
      <View style={[styles.roadArc, { borderColor: roadStrong }]} pointerEvents="none" />

      {/* Building blocks — tiny sharp rects, map-chip feel. */}
      <View style={[styles.block, styles.blockA, { backgroundColor: road }]} pointerEvents="none" />
      <View style={[styles.block, styles.blockB, { backgroundColor: road }]} pointerEvents="none" />
      <View style={[styles.block, styles.blockC, { backgroundColor: road }]} pointerEvents="none" />

      <View style={styles.beaconWrap} pointerEvents="none">
        <Animated.View
          style={[
            styles.beaconRingOuter,
            { borderColor: accentMix(palette.accent, 35) },
            ringPulseStyle,
          ]}
        />
        <View style={[styles.beaconRing, { borderColor: accentMix(palette.accent, 55) }]}>
          <View style={[styles.beaconDot, { backgroundColor: palette.accent }]} />
        </View>
        <CrookIcon size={20} color={palette.accent} style={styles.crook} />
      </View>

      {/* Soft bottom veil so the name stays readable — no framed sheet / grabber. */}
      <LinearGradient
        colors={labelVeil as [string, string]}
        style={styles.labelVeil}
        pointerEvents="none"
      />
      <HitherText
        typeRole="title"
        style={[styles.cardLabel, { color: labelColor, fontFamily: DISPLAY_FONT }]}
        numberOfLines={2}
      >
        {label}
      </HitherText>

      {selected ? (
        <View
          style={[styles.cardRing, { borderColor: accentMix(palette.accent, 55) }]}
          pointerEvents="none"
        />
      ) : null}

      {selected ? (
        <View style={[styles.cardCheck, { backgroundColor: palette.accent }]} pointerEvents="none">
          <Ionicons name="checkmark" size={13} color={palette.accentText} />
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
      {/* Two fixed rows (not flexWrap + % width) so Yoga always gets a width
          for flex:1 + aspectRatio — matches L3DepartureStep tile layout. */}
      <View style={styles.grid}>
        {[THEME_ORDER.slice(0, 2), THEME_ORDER.slice(2, 4)].map((row, rowIndex) => (
          <View key={rowIndex} style={styles.row}>
            {row.map((name) => (
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
        ))}
      </View>
    </StepShell>
  );
}

const styles = StyleSheet.create({
  grid: {
    gap: 14,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 14,
  },
  card: {
    flex: 1,
    aspectRatio: 0.92,
    minHeight: 156,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#0E1320',
  },
  // In-flow box so absolute decorative layers have a non-zero parent.
  cardScaffold: {
    width: '100%',
    aspectRatio: 0.92,
  },
  cardGlow: {
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 8,
  },
  waterBlob: {
    position: 'absolute',
    width: '42%',
    height: '28%',
    borderRadius: 40,
    top: '12%',
    right: '6%',
  },
  landBlob: {
    position: 'absolute',
    width: '48%',
    height: '34%',
    borderRadius: 28,
    top: '38%',
    left: '4%',
  },
  landBlobSm: {
    position: 'absolute',
    width: '26%',
    height: '18%',
    borderRadius: 18,
    top: '18%',
    left: '38%',
  },
  roadH: {
    position: 'absolute',
    left: '8%',
    right: '10%',
    top: '42%',
    height: HAIR,
    borderRadius: 1,
  },
  roadH2: {
    position: 'absolute',
    left: '18%',
    right: '22%',
    top: '58%',
    height: HAIR,
    borderRadius: 1,
  },
  roadV: {
    position: 'absolute',
    top: '22%',
    bottom: '36%',
    left: '48%',
    width: HAIR,
    borderRadius: 1,
  },
  roadArc: {
    position: 'absolute',
    left: '14%',
    right: '20%',
    top: '26%',
    height: 52,
    borderRadius: 40,
    borderWidth: BORDER,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    transform: [{ rotate: '-14deg' }],
  },
  block: {
    position: 'absolute',
    borderRadius: 2,
  },
  blockA: { width: 10, height: 8, top: '30%', left: '22%' },
  blockB: { width: 8, height: 12, top: '48%', left: '62%' },
  blockC: { width: 12, height: 7, top: '52%', left: '28%' },
  beaconWrap: {
    position: 'absolute',
    top: '32%',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  beaconRingOuter: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: BORDER,
  },
  beaconRing: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  beaconDot: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
  },
  crook: {
    position: 'absolute',
    right: -12,
    top: -8,
  },
  labelVeil: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '34%',
  },
  cardLabel: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 14,
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
    borderWidth: BORDER,
  },
  cardCheck: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
});
