import React from 'react';
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../state/PreferencesContext';
import { accentMix, accentOver } from '../../glass';
import { HitherText } from '../../components/HitherText';
import { selectionTick } from '../../utils/haptics';

const IS_ANDROID = Platform.OS === 'android';

/**
 * Shared selectable card used by role/purpose/quiz/browser steps.
 *
 * Visual states are binary only: selected vs unselected. No press opacity,
 * no Material ripple, no colour fade — finger down does not change look until
 * selection state flips.
 *
 * Android: solid fills + padding-ring border; never elevation/translucent
 * fills with borderRadius (soft black frame). Soft glow is iOS only.
 */
export default function OptionCard({
  title,
  subtitle,
  icon,
  tileColor,
  selected,
  onPress,
}: {
  title: string;
  subtitle?: string;
  /** Leading claymorphic icon (onboarding art). */
  icon?: ImageSourcePropType;
  /** Fixed colour block behind the icon (e.g. per-category interest colours). */
  tileColor?: string;
  selected?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();

  const cardBg = selected
    ? IS_ANDROID
      ? accentOver(colors.accent, colors.surface, 16)
      : accentMix(colors.accent, 16)
    : colors.surface;

  const tileBg =
    tileColor ??
    (selected
      ? IS_ANDROID
        ? accentOver(colors.accent, colors.surface, 24)
        : accentMix(colors.accent, 24)
      : IS_ANDROID
        ? accentOver(colors.textSecondary, colors.surface, 10)
        : accentMix(colors.textSecondary, 10));

  const ringColor = selected ? colors.accent : colors.border;
  const ringWidth = selected ? 2 : StyleSheet.hairlineWidth * 2;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => {
        selectionTick();
        onPress();
      }}
      // Off: theme default ripple flashes square corners on rounded cards.
      android_ripple={IS_ANDROID ? { color: 'transparent' } : undefined}
      style={[
        styles.outer,
        {
          padding: ringWidth,
          backgroundColor: ringColor,
          elevation: 0,
          shadowOpacity: 0,
          shadowRadius: 0,
          shadowOffset: { width: 0, height: 0 },
          shadowColor: 'transparent',
        },
        selected &&
          !IS_ANDROID && {
            ...styles.glow,
            shadowColor: colors.accent,
          },
      ]}
    >
      <View
        style={[
          styles.card,
          {
            backgroundColor: cardBg,
            elevation: 0,
            shadowOpacity: 0,
          },
        ]}
        collapsable={false}
      >
        {icon ? (
          <View style={[styles.tile, { backgroundColor: tileBg }]}>
            <Image
              source={icon}
              style={styles.icon}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
          </View>
        ) : null}
        <View style={styles.textCol}>
          <HitherText
            typeRole="body"
            style={[styles.title, { color: colors.textPrimary }]}
            numberOfLines={2}
          >
            {title}
          </HitherText>
          {subtitle ? (
            <HitherText
              typeRole="footnote"
              style={[styles.subtitle, { color: colors.textSecondary }]}
              numberOfLines={2}
            >
              {subtitle}
            </HitherText>
          ) : null}
        </View>
        <View
          style={[
            styles.check,
            selected
              ? { backgroundColor: colors.accent, borderColor: colors.accent }
              : { borderColor: colors.border },
          ]}
        >
          {selected ? <Ionicons name="checkmark" size={15} color={colors.accentText} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  outer: {
    borderRadius: 20,
    marginBottom: 12,
    ...(IS_ANDROID ? { overflow: 'hidden' as const } : null),
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 84,
    borderRadius: 18,
    paddingVertical: 13,
    paddingHorizontal: 14,
    overflow: 'hidden',
  },
  glow: {
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
  },
  tile: {
    width: 68,
    height: 68,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  icon: { width: 56, height: 56 },
  textCol: { flex: 1, minWidth: 0 },
  title: { fontSize: 16.5, fontWeight: '700' },
  subtitle: { fontSize: 12.5, marginTop: 2 },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
