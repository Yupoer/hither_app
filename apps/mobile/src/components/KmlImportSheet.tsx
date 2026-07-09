import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import OverlaySheet from './OverlaySheet';
import { useTranslation } from '../i18n';
import { useTheme } from '../state/PreferencesContext';
import { glass, accentMix } from '../glass';
import { parseKml, type KmlPlacemark } from '../utils/kml';
import { FREE_LIMITS } from '../entitlements';

type Step =
  | { kind: 'intro' }
  | { kind: 'preview'; items: KmlPlacemark[] }
  | { kind: 'importing'; done: number; total: number }
  | { kind: 'done' }
  | { kind: 'error' };

/**
 * Google My Maps KML import: teaching screen → file picker → preview (locked
 * past the free-plan cap) → progress → done. Mirrors PaywallSheet/OverlaySheet
 * conventions used elsewhere on the map screen.
 */
export default function KmlImportSheet({
  visible,
  onClose,
  currentCount,
  isPro,
  onImport,
  onUpgrade,
}: {
  visible: boolean;
  onClose: () => void;
  currentCount: number;
  isPro: boolean;
  onImport: (items: KmlPlacemark[], onProgress: (done: number) => void) => Promise<void>;
  onUpgrade: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const accent = colors.accent;
  const [step, setStep] = useState<Step>({ kind: 'intro' });

  function reset() {
    setStep({ kind: 'intro' });
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function pickFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/vnd.google-earth.kml+xml', '*/*'],
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const uri = result.assets?.[0]?.uri;
    if (!uri) return;
    try {
      const xml = await fetch(uri).then((r) => r.text());
      const items = parseKml(xml);
      if (items.length === 0) {
        setStep({ kind: 'error' });
        return;
      }
      setStep({ kind: 'preview', items });
    } catch {
      setStep({ kind: 'error' });
    }
  }

  async function runImport(items: KmlPlacemark[]) {
    setStep({ kind: 'importing', done: 0, total: items.length });
    try {
      await onImport(items, (done) => setStep({ kind: 'importing', done, total: items.length }));
      setStep({ kind: 'done' });
      setTimeout(handleClose, 1000);
    } catch {
      setStep({ kind: 'error' });
    }
  }

  const allowedFor = (items: KmlPlacemark[]) =>
    isPro
      ? items.length
      : Math.max(
          0,
          Math.min(FREE_LIMITS.kmlImportPoints, FREE_LIMITS.destinationsPerItinerary - currentCount),
        );

  return (
    <OverlaySheet
      visible={visible}
      onClose={handleClose}
      title={t('kml.entry')}
      accent={accent}
      doneLabel={t('common.cancel')}
    >
      <ScrollView contentContainerStyle={styles.body}>
        {step.kind === 'intro' && (
          <>
            <Text style={styles.stepText}>1. {t('kml.step1')}</Text>
            <Text style={styles.stepText}>2. {t('kml.step2')}</Text>
            <Text style={styles.stepText}>3. {t('kml.step3')}</Text>
            <Pressable
              style={[styles.cta, { backgroundColor: accentMix(accent, 90), borderColor: accentMix(accent, 50) }]}
              onPress={pickFile}
              accessibilityRole="button"
            >
              <Text style={styles.ctaText}>{t('kml.pick')}</Text>
            </Pressable>
          </>
        )}

        {step.kind === 'error' && (
          <>
            <Text style={styles.errorText}>{t('kml.parseError')}</Text>
            <Pressable
              style={[styles.cta, { backgroundColor: accentMix(accent, 90), borderColor: accentMix(accent, 50) }]}
              onPress={reset}
              accessibilityRole="button"
            >
              <Text style={styles.ctaText}>{t('kml.retry')}</Text>
            </Pressable>
          </>
        )}

        {step.kind === 'preview' &&
          (() => {
            const allowed = allowedFor(step.items);
            return (
              <>
                {allowed < step.items.length && (
                  <Pressable onPress={onUpgrade}>
                    <Text style={[styles.lockedNote, { color: accent }]}>
                      {t('kml.lockedNote', { n: allowed })}
                    </Text>
                  </Pressable>
                )}
                {allowed === 0 && <Text style={styles.errorText}>{t('kml.noRoom')}</Text>}
                <View style={styles.list}>
                  {step.items.map((item, i) => (
                    <View key={`${item.name}-${i}`} style={[styles.row, i >= allowed && styles.rowLocked]}>
                      <Text style={styles.rowName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.rowCoords}>
                        {item.latitude.toFixed(4)}, {item.longitude.toFixed(4)}
                      </Text>
                    </View>
                  ))}
                </View>
                <Pressable
                  style={[
                    styles.cta,
                    { backgroundColor: accentMix(accent, 90), borderColor: accentMix(accent, 50) },
                    allowed === 0 && styles.ctaDisabled,
                  ]}
                  onPress={() => runImport(step.items.slice(0, allowed))}
                  disabled={allowed === 0}
                  accessibilityRole="button"
                >
                  <Text style={styles.ctaText}>{t('kml.importN', { n: allowed })}</Text>
                </Pressable>
              </>
            );
          })()}

        {step.kind === 'importing' && (
          <>
            <Text style={styles.stepText}>{t('kml.importing', { done: step.done, total: step.total })}</Text>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { backgroundColor: accent, width: `${(step.done / step.total) * 100}%` },
                ]}
              />
            </View>
            <ActivityIndicator color={accent} />
          </>
        )}

        {step.kind === 'done' && <Text style={styles.stepText}>{t('kml.done')}</Text>}
      </ScrollView>
    </OverlaySheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 18, paddingBottom: 24, gap: 14 },
  stepText: { fontSize: 15, color: '#fff', lineHeight: 22 },
  errorText: { fontSize: 14, color: glass.textSecondary, lineHeight: 20 },
  lockedNote: { fontSize: 13, lineHeight: 18 },
  cta: {
    height: 50,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  list: {
    backgroundColor: glass.fill,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hairlineStrong,
    overflow: 'hidden',
  },
  row: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.hairlineStrong,
  },
  rowLocked: { opacity: 0.4 },
  rowName: { fontSize: 14, fontWeight: '600', color: '#fff' },
  rowCoords: { fontSize: 12, color: glass.textTertiary, marginTop: 2 },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: glass.fill,
    overflow: 'hidden',
  },
  progressFill: { height: 6, borderRadius: 3 },
});
