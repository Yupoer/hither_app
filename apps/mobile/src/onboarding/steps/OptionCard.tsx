import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../state/PreferencesContext';
import { accentMix } from '../../glass';
import { selectionTick } from '../../utils/haptics';

/**
 * Shared selectable card used by role/purpose/quiz/browser steps: an emoji
 * tile, the label (+ optional subtitle) and a trailing check circle that fills
 * with the accent when selected. Selecting no longer advances on its own — a
 * step's Continue button carries the flow (goal-gradient pattern).
 */
export default function OptionCard({
  title,
  subtitle,
  emoji,
  tileColor,
  selected,
  onPress,
}: {
  title: string;
  subtitle?: string;
  /** Optional leading emoji (temporary stand-in for step artwork). */
  emoji?: string;
  /** Fixed colour block behind the emoji (e.g. per-category interest colours). */
  tileColor?: string;
  selected?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => {
        selectionTick();
        onPress();
      }}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: selected ? accentMix(colors.accent, 16) : colors.surface,
          borderColor: selected ? colors.accent : colors.border,
        },
        selected && { ...styles.glow, shadowColor: colors.accent },
        pressed && { opacity: 0.85 },
      ]}
    >
      {emoji ? (
        <View
          style={[
            styles.tile,
            {
              backgroundColor:
                tileColor ??
                (selected ? accentMix(colors.accent, 24) : accentMix(colors.textSecondary, 10)),
            },
          ]}
        >
          <Text style={styles.emoji}>{emoji}</Text>
        </View>
      ) : null}
      <View style={styles.textCol}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
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
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 68,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: 18,
    paddingVertical: 13,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  // Soft accent glow around the selected card (iOS shadow + Android elevation).
  glow: {
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  tile: {
    width: 46,
    height: 46,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: { fontSize: 24 },
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
