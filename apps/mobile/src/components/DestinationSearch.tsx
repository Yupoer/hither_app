import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { liquidGlass, maps, type PlaceResult, type MapRegion } from '../native';
import { useTheme } from '../state/PreferencesContext';
import { useTranslation } from '../i18n';
import { radius, spacing, type Palette } from '../theme';
import { glass } from '../glass';
import CrookIcon from './CrookIcon';

const DEBOUNCE_MS = 450;

export interface DestinationSearchProps {
  visible: boolean;
  onClose: () => void;
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
 */
export default React.memo(function DestinationSearch({
  visible,
  onClose,
  biasRegion,
  onPick,
}: DestinationSearchProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
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
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.flex}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        {/* Near-full-height panel (Apple Maps: tapping search sends the sheet
            to the top) with the search field first, right under the grabber. */}
        <liquidGlass.GlassView
          tintColor={glass.overlay}
          style={[
            styles.sheet,
            {
              height: windowHeight - insets.top - 6,
              paddingBottom: insets.bottom + spacing.lg,
            },
          ]}
        >
          <View style={styles.handle} />

          <View style={styles.searchRow}>
            <TextInput
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder={t('search.placeholder')}
              placeholderTextColor={glass.textTertiary}
              keyboardAppearance="dark"
              autoFocus
              returnKeyType="search"
              accessibilityLabel={t('search.placeholder')}
            />
            <Pressable
              onPress={onClose}
              style={styles.cancel}
              accessibilityRole="button"
            >
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </Pressable>
          </View>

          {searching ? (
            <View style={styles.statusRow}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.statusText}>{t('search.searching')}</Text>
            </View>
          ) : query.trim() && results.length === 0 ? (
            <Text style={styles.statusText}>{t('search.noResults')}</Text>
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
        </liquidGlass.GlassView>
      </View>
    </Modal>
  );
});

// Dark "Liquid Glass" surface to match the map's sheet/overlays (opened from
// there), independent of the light/dark map theme. Accent still follows theme.
const makeStyles = (colors: Palette) => StyleSheet.create({
  flex: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: glass.scrim },
  sheet: {
    overflow: 'hidden',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hairlineSoft,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: glass.grabber,
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
  cancel: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  cancelText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
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
