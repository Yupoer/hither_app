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
import type { Destination } from '../../../types';
import {
  isDebugRouteActive,
  startDebugRoute,
  stopDebugRoute,
} from '../../../native/debugLocation';

interface DiagnosticsOverlayProps {
  visible: boolean;
  onClose: () => void;
  accent: string;
  navigationSessionId: string | null;
  trackingMode: string;
  liveActivityStatus: string;
  destinations?: Destination[];
  activeDestinationId?: string | null;
}

const EMPTY_SUMMARY: DiagnosticSummary = {
  total: 0,
  pending: 0,
  lastTimestamp: null,
  byEvent: {},
};

const DURATION_MINUTES = [1, 5, 15, 30] as const;
const PLAYBACK_RATES = [1, 5, 20] as const;

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
  destinations = [],
  activeDestinationId = null,
}: DiagnosticsOverlayProps) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<DiagnosticSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [routeActive, setRouteActive] = useState(false);
  const [durationMin, setDurationMin] = useState<(typeof DURATION_MINUTES)[number]>(5);
  const [playbackRate, setPlaybackRate] = useState<(typeof PLAYBACK_RATES)[number]>(5);
  const [selectedDestId, setSelectedDestId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSummary(await diagnostics.summary());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      void refresh();
      setRouteActive(isDebugRouteActive());
    }
  }, [refresh, visible]);

  useEffect(() => {
    if (!visible) return;
    const defaultId =
      activeDestinationId && destinations.some((d) => d.id === activeDestinationId)
        ? activeDestinationId
        : destinations[0]?.id ?? null;
    setSelectedDestId((prev) => {
      if (prev && destinations.some((d) => d.id === prev)) return prev;
      return defaultId;
    });
  }, [activeDestinationId, destinations, visible]);

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

  const selectedDestination = destinations.find((d) => d.id === selectedDestId);

  const onStartDebug = useCallback(() => {
    if (!__DEV__ || !selectedDestination) return;
    startDebugRoute({
      destination: selectedDestination.coordinates,
      simulatedDurationMs: durationMin * 60_000,
      playbackRate,
    });
    setRouteActive(true);
  }, [durationMin, playbackRate, selectedDestination]);

  const onStopDebug = useCallback(() => {
    stopDebugRoute();
    setRouteActive(false);
  }, []);

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

        {__DEV__ ? (
          <View style={styles.debugSection}>
            <Text style={styles.debugTitle}>{t('debugLocation.title')}</Text>
            <Text style={styles.warning}>{t('debugLocation.warning')}</Text>

            <Text style={styles.chipLabel}>{t('debugLocation.destination')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
              {destinations.map((dest) => {
                const selected = dest.id === selectedDestId;
                return (
                  <TouchableOpacity
                    key={dest.id}
                    style={[
                      styles.chip,
                      selected && { backgroundColor: accent, borderColor: accent },
                    ]}
                    onPress={() => setSelectedDestId(dest.id)}
                    accessibilityRole="button"
                    accessibilityLabel={dest.title}
                  >
                    <Text
                      style={[styles.chipText, selected && styles.chipTextSelected]}
                      numberOfLines={1}
                    >
                      {dest.title}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={styles.chipLabel}>{t('debugLocation.duration')}</Text>
            <View style={styles.chipWrap}>
              {DURATION_MINUTES.map((min) => {
                const selected = durationMin === min;
                return (
                  <TouchableOpacity
                    key={min}
                    style={[
                      styles.chip,
                      selected && { backgroundColor: accent, borderColor: accent },
                    ]}
                    onPress={() => setDurationMin(min)}
                    accessibilityRole="button"
                    accessibilityLabel={`${min} min`}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {min}m
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.chipLabel}>{t('debugLocation.playbackRate')}</Text>
            <View style={styles.chipWrap}>
              {PLAYBACK_RATES.map((rate) => {
                const selected = playbackRate === rate;
                return (
                  <TouchableOpacity
                    key={rate}
                    style={[
                      styles.chip,
                      selected && { backgroundColor: accent, borderColor: accent },
                    ]}
                    onPress={() => setPlaybackRate(rate)}
                    accessibilityRole="button"
                    accessibilityLabel={`${rate}x`}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {rate}x
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {routeActive ? (
              <Text style={styles.activeLabel}>{t('debugLocation.active')}</Text>
            ) : null}

            <View style={styles.debugActions}>
              <TouchableOpacity
                style={[styles.button, styles.halfButton, { backgroundColor: accent }]}
                onPress={onStartDebug}
                disabled={!selectedDestination}
                accessibilityRole="button"
                accessibilityLabel={t('debugLocation.start')}
              >
                <Text style={styles.buttonText}>{t('debugLocation.start')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.halfButton, styles.stopButton]}
                onPress={onStopDebug}
                accessibilityRole="button"
                accessibilityLabel={t('debugLocation.stop')}
              >
                <Text style={styles.buttonText}>{t('debugLocation.stop')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
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
  debugSection: { gap: 10, marginTop: 4 },
  debugTitle: { color: glass.textPrimary, fontSize: 16, fontWeight: '700' },
  warning: { color: glass.textSecondary, fontSize: 12, lineHeight: 17 },
  chipLabel: { color: glass.textTertiary, fontSize: 12, fontWeight: '600' },
  chipRow: { flexGrow: 0 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hairline,
    backgroundColor: glass.card,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    maxWidth: 180,
  },
  chipText: { color: glass.textPrimary, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
  activeLabel: { color: glass.textSecondary, fontSize: 13, fontWeight: '600' },
  debugActions: { flexDirection: 'row', gap: 10 },
  halfButton: { flex: 1 },
  stopButton: { backgroundColor: 'rgba(120,120,128,0.55)' },
});
