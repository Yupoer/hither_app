import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
}: {
  gatheringTitle: string;
  distanceEta: string | null;
  colors: Palette;
}) {
  const { t } = useTranslation();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <liquidGlass.GlassView style={styles.banner}>
      <View style={styles.dot} />
      <View style={styles.texts}>
        <Text style={styles.status}>{t('map.bannerGoing')}</Text>
        <Text style={styles.title} numberOfLines={1}>
          {gatheringTitle}
        </Text>
      </View>
      {distanceEta ? <Text style={styles.meta}>{distanceEta}</Text> : null}
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
      borderWidth: 1,
      borderColor: colors.accent,
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
    title: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
    meta: { fontSize: 13, color: colors.textSecondary },
  });
