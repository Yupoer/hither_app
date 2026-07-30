import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import OverlaySheet from './OverlaySheet';
import { useTranslation, type TranslationKey } from '../i18n';
import { useTheme } from '../state/PreferencesContext';
import { glass, accentMix } from '../glass';
import { kmlIo } from '../native';
import type { KmlPlacemark } from '../utils/kml';
import {
  kmlErrorI18nKey,
  loadKmlKmzFromAsset,
  type KmlLoadErrorCode,
} from '../utils/kmlLoad';
import { FREE_LIMITS, remainingDestinationSlots } from '../entitlements';
import { diagnostics } from '../state/diagnostics';

type Step =
  | { kind: 'intro' }
  | { kind: 'preview'; items: KmlPlacemark[] }
  | { kind: 'importing'; done: number; total: number }
  | { kind: 'done' }
  | { kind: 'error'; code: KmlLoadErrorCode };

/**
 * Google My Maps KML import: teaching screen → file picker → preview (locked
 * past the free-plan cap) → progress → done. Mirrors PaywallSheet/OverlaySheet
 * conventions used elsewhere on the map screen.
 */
export default React.memo(function KmlImportSheet({
  visible,
  onClose,
  currentCount,
  extraCredits = 0,
  isPro,
  onImport,
  onUpgrade,
}: {
  visible: boolean;
  onClose: () => void;
  /** Open (unfinished) gathering points in scope — not total including closed. */
  currentCount: number;
  /** Team one-shot extra point credits remaining. */
  extraCredits?: number;
  isPro: boolean;
  onImport: (items: KmlPlacemark[], onProgress: (done: number) => void) => Promise<void>;
  onUpgrade: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const accent = colors.accent;
  const [step, setStep] = useState<Step>({ kind: 'intro' });

  const reset = useCallback(() => {
    setStep({ kind: 'intro' });
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const pickFile = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/vnd.google-earth.kml+xml', 'application/vnd.google-earth.kmz', '*/*'],
      copyToCacheDirectory: true,
    });
    if (result.canceled) {
      // Cancel is not an error — stay on intro.
      return;
    }
    const asset = result.assets?.[0];
    if (!asset?.uri) return;

    const loaded = await loadKmlKmzFromAsset(asset, kmlIo.createDefaultKmlLoadIo());
    if (loaded.kind === 'cancelled') return;

    if (loaded.kind === 'error') {
      void diagnostics
        .write({
          // Allow-listed event; stage/code in reason — never path or body.
          event: 'diagnostic_error',
          source: 'kml_import',
          success: false,
          errorCode: loaded.code,
          reason: `${loaded.stage}:${loaded.code}`,
          count: loaded.meta.sizeBytes ?? undefined,
        })
        .catch(() => undefined);
      setStep({ kind: 'error', code: loaded.code });
      return;
    }

    setStep({ kind: 'preview', items: loaded.items });
  }, []);

  const runImport = useCallback(async (items: KmlPlacemark[]) => {
    setStep({ kind: 'importing', done: 0, total: items.length });
    try {
      await onImport(items, (done) => setStep({ kind: 'importing', done, total: items.length }));
      setStep({ kind: 'done' });
      setTimeout(handleClose, 1000);
    } catch {
      setStep({ kind: 'error', code: 'unknown' });
    }
  }, [onImport, handleClose]);

  const allowedFor = (items: KmlPlacemark[]) => {
    if (isPro) return items.length;
    const remaining = remainingDestinationSlots({
      isPro: false,
      openCount: currentCount,
      extraCredits,
    });
    // Cap a single import batch by both remaining Free+credit slots and KML free batch size.
    const batchCap = Math.max(
      0,
      Math.min(FREE_LIMITS.kmlImportPoints + Math.max(0, extraCredits), remaining),
    );
    return Math.min(items.length, batchCap);
  };

  const errorCopy = (code: KmlLoadErrorCode): string => {
    const key = kmlErrorI18nKey(code) as TranslationKey;
    const translated = t(key);
    if (!translated || translated === key) return t('kml.parseError');
    return translated;
  };

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
            <Text style={styles.errorText}>{errorCopy(step.code)}</Text>
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
});

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
