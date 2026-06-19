import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { liquidGlass } from '../native';
import { useTranslation } from '../i18n';
import { radius, spacing, type Palette } from '../theme';

/**
 * In-app banner mirroring the iOS Live Activity, shown along the bottom of the
 * map while the journey is going. Same data the Live Activity carries
 * (status + gathering point + distance/ETA) so the in-app and lock-screen views
 * stay consistent. Rendered only when the leader has pressed Start and a
 * gathering point + distance are known.
 */
export default function JourneyBanner({
  gatheringTitle,
  distanceEta,
  colors,
  tintColor,
  onCancel,
  cancelLabel,
}: {
  gatheringTitle: string;
  distanceEta: string | null;
  colors: Palette;
  /** Optional dark glass veil so the banner reads dark-toned over the map. */
  tintColor?: string;
  /** When provided, renders a cancel/stop button (leader only). */
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  const { t } = useTranslation();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <liquidGlass.GlassView tintColor={tintColor} style={styles.banner}>
      <View style={styles.dot} />
      <View style={styles.texts}>
        <Text style={styles.status}>{t('map.bannerGoing')}</Text>
        <Text style={styles.title} numberOfLines={1}>
          {gatheringTitle}
        </Text>
      </View>
      {distanceEta ? <Text style={styles.meta}>{distanceEta}</Text> : null}
      {onCancel ? (
        <Pressable
          style={styles.cancel}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel={cancelLabel}
          hitSlop={8}
        >
          <Text style={styles.cancelText}>{cancelLabel}</Text>
        </Pressable>
      ) : null}
    </liquidGlass.GlassView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      overflow: 'hidden',
      borderRadius: radius.lg,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    dot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.accent,
    },
    texts: { flex: 1, gap: 2 },
    status: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1,
      color: colors.accent,
    },
    // Light text: banner sits on the forced-dark glass veil over the map.
    title: { fontSize: 16, fontWeight: '700', color: '#F5F7FC' },
    meta: { fontSize: 13, color: 'rgba(255,255,255,0.72)' },
    cancel: {
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.danger,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    cancelText: { color: colors.danger, fontSize: 13, fontWeight: '700' },
  });
