import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../state/PreferencesContext';
import { accentMix } from '../../glass';
import { selectionTick } from '../../utils/haptics';

/** Shared selectable card used by role/purpose/quiz/browser steps. */
export default function OptionCard({
  title,
  subtitle,
  emoji,
  selected,
  onPress,
}: {
  title: string;
  subtitle?: string;
  /** Optional leading emoji (temporary stand-in for step artwork). */
  emoji?: string;
  selected?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        selectionTick();
        onPress();
      }}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: selected ? accentMix(colors.accent, 20) : colors.surface,
          borderColor: selected ? colors.accent : colors.border,
        },
        pressed && { opacity: 0.85 },
      ]}
    >
      {emoji ? <Text style={styles.emoji}>{emoji}</Text> : null}
      <View style={styles.textCol}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 68,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 18,
    marginBottom: 14,
  },
  emoji: { fontSize: 32, marginRight: 14 },
  textCol: { flex: 1 },
  title: { fontSize: 17, fontWeight: '600' },
  subtitle: { fontSize: 14, marginTop: 4 },
});
