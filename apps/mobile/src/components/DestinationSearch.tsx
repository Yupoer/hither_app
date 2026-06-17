import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { maps, type PlaceResult, type MapRegion } from '../native';
import { colors, radius, spacing } from '../theme';

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
export default function DestinationSearch({
  visible,
  onClose,
  biasRegion,
  onPick,
}: DestinationSearchProps) {
  const insets = useSafeAreaInsets();
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
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.handle} />
          <Text style={styles.label}>NEXT GATHERING POINT · 搜尋下一集合點</Text>

          <View style={styles.searchRow}>
            <TextInput
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder="輸入地址或地點名稱"
              placeholderTextColor={colors.textSecondary}
              autoFocus
              returnKeyType="search"
              accessibilityLabel="搜尋地址"
            />
            <Pressable
              onPress={onClose}
              style={styles.cancel}
              accessibilityRole="button"
            >
              <Text style={styles.cancelText}>取消</Text>
            </Pressable>
          </View>

          {searching ? (
            <View style={styles.statusRow}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.statusText}>搜尋中…</Text>
            </View>
          ) : query.trim() && results.length === 0 ? (
            <Text style={styles.statusText}>找不到相符的地點</Text>
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
                <Text style={styles.resultEmoji}>🏮</Text>
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
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    maxHeight: '80%',
    gap: spacing.md,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    color: colors.accent,
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 17,
    color: colors.textPrimary,
  },
  cancel: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  cancelText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusText: { color: colors.textSecondary, fontSize: 14 },
  list: { flexGrow: 0 },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  resultPressed: { opacity: 0.6 },
  resultEmoji: { fontSize: 24 },
  resultText: { flex: 1, gap: 2 },
  resultName: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  resultAddress: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
});
