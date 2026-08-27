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
  const seqRef = useRef(0);

  // Reset everything whenever the sheet is opened afresh.
  useEffect(() => {
    if (visible) {
      setQuery('');
      setResults([]);
      setSearching(false);
      setSubmittingId(null);
    }
  }, [visible]);

  // Debounced search as the query changes.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++seqRef.current;
    const handle = setTimeout(async () => {
      const hits = await maps.searchPlaces(trimmed, biasRegion);
      if (seq === seqRef.current) {
        setResults(hits);
        setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, biasRegion]);

  async function handlePick(place: PlaceResult) {
    if (submittingId) {
      return;
    }
    setSubmittingId(place.id);
    try {
      await onPick(place);
      onClose();
    } finally {
      setSubmittingId(null);
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
            onChangeText={(value) => setQuery(normalizeSearchInput(value))}
            placeholder={t('search.placeholder')}
            placeholderTextColor={glass.textTertiary}
            keyboardAppearance="dark"
            autoFocus
            returnKeyType="search"
            accessibilityLabel={t('search.placeholder')}
          />
        </View>

        <Text style={styles.hint}>{t('search.longPressHint')}</Text>

        {searching ? (
          <View style={styles.statusRow}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.statusText}>{t('search.searching')}</Text>
          </View>
        ) : query.trim() && results.length === 0 ? (
          <Text style={styles.statusText}>{t('search.quotaOrOffline')}</Text>
        ) : null}

        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          style={styles.list}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [
                styles.resultRow,
                pressed && styles.resultPressed,
              ]}
              onPress={() => handlePick(item)}
              disabled={submittingId !== null}
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
              {submittingId === item.id ? (
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
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
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
