import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Share as Sharing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import OverlaySheet from '../../../components/OverlaySheet';
import { useTranslation } from '../../../i18n';
import { diagnostics, type DiagnosticSummary } from '../../../state/diagnostics';
import { glass } from '../../../glass';

interface DiagnosticsOverlayProps {
  visible: boolean;
  onClose: () => void;
  accent: string;
  navigationSessionId: string | null;
  trackingMode: string;
  liveActivityStatus: string;
}

const EMPTY_SUMMARY: DiagnosticSummary = {
  total: 0,
  pending: 0,
  lastTimestamp: null,
  byEvent: {},
};

function eventCount(summary: DiagnosticSummary, predicate: (name: string) => boolean) {
  return Object.entries(summary.byEvent).reduce(
    (count, [name, value]) => count + (predicate(name) ? value : 0),
    0,
  );
}

export const DiagnosticsOverlay = React.memo(function DiagnosticsOverlay({
  visible,
  onClose,
  accent,
  navigationSessionId,
  trackingMode,
  liveActivityStatus,
}: DiagnosticsOverlayProps) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<DiagnosticSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSummary(await diagnostics.summary());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) void refresh();
  }, [refresh, visible]);

  const callbackCount = summary.byEvent.location_callback ?? 0;
  const uploadCount = eventCount(summary, (name) => name === 'location_upload_succeeded');
  const errorCount = eventCount(
    summary,
    (name) => name.includes('failed') || name.includes('error') || name.includes('rejected'),
  );
  const buildNumber = Constants.nativeBuildVersion ?? 'development';

  const rows = useMemo(
    () => [
      [t('diagnostics.build'), `${Constants.expoConfig?.version ?? 'development'} (${buildNumber})`],
      [t('diagnostics.session'), navigationSessionId ?? t('diagnostics.none')],
      [t('diagnostics.mode'), trackingMode],
      [t('diagnostics.callbacks'), String(callbackCount)],
      [t('diagnostics.uploads'), `${uploadCount} / ${summary.pending} pending`],
      [t('diagnostics.errors'), String(errorCount)],
      [t('diagnostics.liveActivity'), liveActivityStatus],
      [
        t('diagnostics.lastEvent'),
        summary.lastTimestamp
          ? new Date(summary.lastTimestamp).toLocaleString()
          : t('diagnostics.none'),
      ],
    ],
    [
      buildNumber,
      callbackCount,
      errorCount,
      liveActivityStatus,
      navigationSessionId,
      summary.lastTimestamp,
      summary.pending,
      t,
      trackingMode,
      uploadCount,
    ],
  );

  const exportBundle = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const json = await diagnostics.exportJson();
      await Sharing.share({ message: json });
    } catch {
      Alert.alert(t('diagnostics.exportFailed'));
    } finally {
      setExporting(false);
    }
  }, [exporting, t]);

  return (
    <OverlaySheet
      visible={visible}
      onClose={onClose}
      title={t('diagnostics.title')}
      accent={accent}
      doneLabel={t('map.done')}
    >
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.notice}>{t('diagnostics.redactionNotice')}</Text>
        {loading ? <ActivityIndicator color={accent} /> : null}
        <View style={styles.card}>
          {rows.map(([label, value]) => (
            <View key={label} style={styles.row}>
              <Text style={styles.label}>{label}</Text>
              <Text selectable style={styles.value}>{value}</Text>
            </View>
          ))}
        </View>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: accent, opacity: exporting ? 0.65 : 1 }]}
          onPress={exportBundle}
          disabled={exporting}
          accessibilityRole="button"
          accessibilityLabel={t('diagnostics.export')}
        >
          <Text style={styles.buttonText}>
            {exporting ? t('diagnostics.exporting') : t('diagnostics.export')}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </OverlaySheet>
  );
});

const styles = StyleSheet.create({
  body: { paddingHorizontal: 18, paddingBottom: 40, gap: 14 },
  notice: { color: glass.textSecondary, fontSize: 13, lineHeight: 19 },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hairline,
    backgroundColor: glass.card,
    overflow: 'hidden',
  },
  row: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.hairline,
  },
  label: { color: glass.textTertiary, fontSize: 12, fontWeight: '600' },
  value: { color: glass.textPrimary, fontSize: 14 },
  button: { borderRadius: 14, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
