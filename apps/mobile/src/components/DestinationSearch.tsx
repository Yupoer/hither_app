import { useForegroundUi } from '../state/foregroundUi';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { maps, type PlaceResult, type MapRegion } from '../native';
import { useTheme } from '../state/PreferencesContext';
import { useTranslation } from '../i18n';
import { radius, spacing, type Palette } from '../theme';
import { glass } from '../glass';
import { extractPlusCode } from '../utils/plusCode';
import { classifyOperationError } from '../utils/operationError';
import { normalizePlaceSearchResults, placeSearchResultKey } from '../utils/normalizePlaceSearchResults';
import CrookIcon from './CrookIcon';
import OverlaySheet from './OverlaySheet';

const DEBOUNCE_MS = 450;

function normalizeSearchInput(value: string): string {
  return extractPlusCode(value) ?? value;
}

export interface DestinationSearchProps {
  visible: boolean;
  onClose: () => void;
  /** Fires after the sheet open animation finishes (OverlaySheet). */
  onOpenComplete?: () => void;
  /** Bias search results toward what the user is looking at, when known. */
  biasRegion?: MapRegion;
  /**
   * Called when a place is chosen. Should resolve once the destination is
   * persisted; the sheet shows a spinner until it does, then closes.
   */
  onPick: (place: PlaceResult) => Promise<void>;
}

/**
 * Address / place search sheet used to set the group's next gathering point.
 *
 * Typing debounces into `maps.searchPlaces` (native MapKit on a Dev Build, or
 * the Nominatim fallback in Expo Go). Picking a result calls `onPick`, which
 * persists it as the next destination.
 *
 * Dismiss via Done, scrim, or pull-down (OverlaySheet). Long-press map remains
 * the alternate add-place path — shown as a hint here.
 */
export default React.memo(function DestinationSearch({
  visible,
  onClose,
  onOpenComplete,
  biasRegion,
  onPick,
}: DestinationSearchProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  // Guards against a stale debounced search resolving after we've moved on.
  const foreground = useForegroundUi();
  const seqRef = useRef(0);
  const searchRegionRef = useRef(biasRegion);
  const [searchError, setSearchError] = useState<'failed' | 'quota' | null>(null);
  const selectionRef = useRef({ query, results, searching, visible, submitting: false, epoch: 0 });
  const epoch = selectionRef.current.epoch + (selectionRef.current.visible !== visible ? 1 : 0);
  selectionRef.current = { query, results, searching, visible, epoch,
    submitting: selectionRef.current.epoch === epoch && selectionRef.current.submitting };

  // Reset everything whenever the sheet is opened afresh.
  useEffect(() => {
    if (visible) {
      searchRegionRef.current = biasRegion;
      setQuery('');
      setResults([]);
      setSearching(false);
      setSubmittingId(null);
      setSearchError(null);
    }
    // GPS updates must not restart a query while this sheet is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Debounced search as the query changes.
  useEffect(() => {
    if (!foreground) return;
    const trimmed = query.trim();
    const seq = ++seqRef.current;
    setSearchError(null);
    if (!visible || !trimmed) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    setResults([]);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const handle = setTimeout(async () => {
      try {
        const hits = await Promise.race([
          maps.searchPlaces(trimmed, searchRegionRef.current, { throwOnError: true }),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('search_timeout')), 20_000);
          }),
        ]);
        if (seq === seqRef.current) setResults(normalizePlaceSearchResults(hits));
      } catch (error) {
        if (seq === seqRef.current) {
          setResults([]);
          setSearchError(classifyOperationError(error).kind === 'quota' ? 'quota' : 'failed');
        }
      } finally {
        clearTimeout(timeout);
        if (seq === seqRef.current) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      ++seqRef.current;
      clearTimeout(handle);
      clearTimeout(timeout);
    };
  }, [foreground, query, visible]);

  async function handlePick(place: PlaceResult) {
    const selection = selectionRef.current;
    if (!selection.visible || selection.searching || selection.submitting
      || !selection.results.includes(place)) {
      return;
    }
    selectionRef.current.submitting = true;
    const selectedQuery = selection.query;
    const selectedEpoch = selection.epoch;
    setSubmittingId(placeSearchResultKey(place));
    try {
      await onPick(place);
      if (selectionRef.current.visible && selectionRef.current.epoch === selectedEpoch
        && selectionRef.current.query === selectedQuery && selectionRef.current.results.includes(place)) onClose();
    } finally {
      if (selectionRef.current.epoch === selectedEpoch) {
        selectionRef.current.submitting = false;
        setSubmittingId(null);
      }
    }
  }

  return (
    <OverlaySheet
      visible={visible}
      onClose={onClose}
      onOpenComplete={onOpenComplete}
      title={t('search.sheetTitle')}
      accent={colors.accent}
      doneLabel={t('common.cancel')}
      doneSystemImage="xmark"
      material="mapSheet"
      edgeToEdge
    >
      <View style={styles.body}>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={(value) => {
              const next = normalizeSearchInput(value);
              if (next === selectionRef.current.query) return;
              selectionRef.current.searching = true;
              setQuery(next);
            }}
            placeholder={t('search.placeholder')}
            placeholderTextColor={glass.textTertiary}
            keyboardAppearance="dark"
            autoFocus
            returnKeyType="search"
            accessibilityLabel={t('search.placeholder')}
          />
        </View>

        <Text style={styles.hint}>{t('search.longPressHint')}</Text>

        <View style={styles.statusRow} testID="search-status">
          {searching ? <ActivityIndicator color={colors.accent} /> : null}
          <Text style={styles.statusText}>{searching ? t('search.searching')
            : query.trim() && results.length === 0
              ? t(searchError === 'quota' ? 'search.quota' : searchError === 'failed' ? 'search.failed' : 'search.noResults') : ''}</Text>
        </View>

        <FlatList
          data={results}
          keyExtractor={placeSearchResultKey}
          keyboardShouldPersistTaps="handled"
          style={styles.list}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [
                styles.resultRow,
                pressed && styles.resultPressed,
              ]}
              onPress={() => handlePick(item)}
              disabled={searching || submittingId !== null}
              accessibilityState={{ disabled: searching || submittingId !== null }}
              accessibilityRole="button"
            >
              <View style={styles.resultIcon}>
                <CrookIcon size={22} color={colors.accent} />
              </View>
              <View style={styles.resultText}>
                <Text style={styles.resultName} numberOfLines={1}>
                  {item.name}
                </Text>
                {item.address ? (
                  <Text style={styles.resultAddress} numberOfLines={2}>
                    {item.address}
                  </Text>
                ) : null}
              </View>
              {submittingId === placeSearchResultKey(item) ? (
                <ActivityIndicator color={colors.accent} />
              ) : null}
            </Pressable>
          )}
        />
      </View>
    </OverlaySheet>
  );
});

// Dark "Liquid Glass" surface to match the map's sheet/overlays (opened from
// there), independent of the light/dark map theme. Accent still follows theme.
const makeStyles = (colors: Palette) => StyleSheet.create({
  body: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: {
    flex: 1,
    backgroundColor: glass.fillStrong,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hairlineStrong,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 17,
    color: '#fff',
  },
  hint: {
    color: glass.textTertiary,
    fontSize: 13,
    lineHeight: 18,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 24 },
  statusText: { color: glass.textSecondary, fontSize: 14 },
  list: { flex: 1 },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.hairlineSoft,
  },
  resultPressed: { opacity: 0.6 },
  resultIcon: {
    width: 40,
    height: 40,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: glass.fill,
  },
  resultText: { flex: 1, gap: 2 },
  resultName: { color: '#fff', fontSize: 16, fontWeight: '600' },
  resultAddress: { color: glass.textSecondary, fontSize: 13, lineHeight: 18 },
});
