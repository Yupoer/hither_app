import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  Modal,
  Dimensions,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import type { Destination } from '../types';
import { radius, spacing, DAY_COLORS, type Palette } from '../theme';
import { readOnboardingState } from '../onboarding/sync';
import { usePreferences } from '../state/PreferencesContext';
import { useTranslation } from '../i18n';
import { dateForTripDay, localDayKey } from '../utils/tripDay';
import { clampDateNotBeforeToday, startOfTodayLocal } from '../utils/meetTime';
import {
  accommodationBoundaryLocks,
  applyPureIndexAnchors,
  dayCollapseStorageKey,
  DEFAULT_REORDER_LAYOUT,
  dragTargetIndexFromOffset,
  legalDragIndicesForList,
  moveDayBlockBefore,
  orderAfterDragMove,
  reorderRowCenterY,
  snapToLegalDragIndex,
  type AccommodationListItem,
  type MeasuredReorderGeometry,
  type ReorderListEntry,
} from '../utils/accommodationSemantics';
import { eligibleFavoriteDateOptions } from '../utils/favoriteDates';
import { placeExactMatchKey } from '../utils/placeIdentity';
import { lightTap, mediumTap, selectionTick } from '../utils/haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DESTINATION_EMOJI_CATEGORIES,
  DESTINATION_EMOJI_FALLBACK,
  DESTINATION_EMOJI_PRESETS,
  destinationEmojiDisplay,
  presetsForCategory,
  resolveDestinationEmoji,
  type DestinationEmojiCategory,
} from '../utils/destinationEmojiColor';
import { getColorForDay, STAY_MARKER_EMOJI } from '../utils/destinationMarkerChrome';

const ROW_HEIGHT = DEFAULT_REORDER_LAYOUT.rowHeight;
const REORDER_LAYOUT = DEFAULT_REORDER_LAYOUT;
const REVEAL_WIDTH = 76;
/** Low-sat terracotta for stay emoji badge (works on dark glass; not Day1 #E5575C). */
const STAY_BADGE_BG = '#8B6F6A';
/** Auto-scroll parent when finger is within this distance of screen edges. */
const DRAG_EDGE_PX = 160;
const DRAG_SCROLL_STEP = 22;

export interface DailyAccommodationView {
  stayDate: string;
  title: string;
  id: string;
  coordinates?: { latitude: number; longitude: number };
}

export interface FavoritePlaceView {
  id: string;
  title: string;
  address?: string;
  coordinates: { latitude: number; longitude: number };
}

interface Props {
  groupId?: string;
  destinations: Destination[];
  canReorder: boolean;
  tripDays?: number;
  departureDate?: string;
  onUpdateTripDetails: (days: number, date: string) => void;
  onReorder: (
    updates: { id: string; position: number; day: number; stayAnchor?: boolean }[],
  ) => void;
  onDelete?: (id: string) => void;
  /** Per-stop emoji (+ optional markerColor). Day color is via day-header picker. */
  onUpdateEmojiColor?: (
    id: string,
    next: { emoji: string | null; markerColor?: string | null },
  ) => void | Promise<void>;
  onSync?: () => Promise<void>;
  /** Open KML/KMZ import sheet (replaces header sync CTA). */
  onImport?: () => void;
  /** When true, show retry sync affordance after silent open-sync failure. */
  syncFailed?: boolean;
  colors: Palette;
  emptyLabel: string;
  dragHint?: string;
  onDragActiveChange?: (active: boolean) => void;
  /**
   * While dragging near the screen edge, parent should scroll by `deltaY`
   * (content coordinates). Enables reaching other day blocks off-screen.
   */
  onDragAutoScroll?: (deltaY: number) => void;
  /** Daily accommodation by calendar date (YYYY-MM-DD). */
  dailyByDate?: Record<string, DailyAccommodationView | undefined>;
  /** Leader: clear daily accommodation for a date (does not delete cards). */
  onClearDailyAccommodation?: (stayDate: string, day: number) => void;
  /** Leader: enter set-from-stop mode for a day. */
  onSetDailyFromDestination?: (destinationId: string, day: number) => void;
  /** Quick-add mid accommodation card for a day. */
  onQuickAddAccommodation?: (day: number) => void;
  /** Account favorites for picker. */
  favoritePlaces?: FavoritePlaceView[];
  onPickFavorite?: (favorite: FavoritePlaceView, day: number) => void;
  /** Remove a favorite from the account list. */
  onDeleteFavorite?: (favorite: FavoritePlaceView) => void;
  accountId?: string;
}

type ListItem =
  | { type: 'header'; day: number; id: string; title: string; dateStr: string }
  | { type: 'dest'; item: Destination; id: string };

export default function DestinationReorderList({
  groupId,
  destinations,
  canReorder,
  tripDays,
  departureDate,
  onUpdateTripDetails,
  onReorder,
  onDelete,
  onUpdateEmojiColor,
  onSync,
  onImport,
  syncFailed = false,
  colors,
  emptyLabel,
  dragHint,
  onDragActiveChange,
  onDragAutoScroll,
  dailyByDate,
  onClearDailyAccommodation,
  onSetDailyFromDestination,
  onQuickAddAccommodation,
  favoritePlaces,
  onPickFavorite,
  onDeleteFavorite,
  accountId,
}: Props) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { t } = useTranslation();
  const { dayColors, setDayColor } = usePreferences();

  const [order, setOrder] = useState<ListItem[]>([]);
  const orderRef = useRef(order);
  orderRef.current = order;

  const draggingRef = useRef(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [colorPickerDay, setColorPickerDay] = useState<number | null>(null);
  const [emojiPickerDestId, setEmojiPickerDestId] = useState<string | null>(null);
  const [emojiDraft, setEmojiDraft] = useState(DESTINATION_EMOJI_FALLBACK);
  const [emojiCategory, setEmojiCategory] = useState<DestinationEmojiCategory>('common');
  const [emojiPreviewDayColor, setEmojiPreviewDayColor] = useState(DAY_COLORS[0]);
  const [emojiSaveError, setEmojiSaveError] = useState(false);
  const [emojiSaving, setEmojiSaving] = useState(false);
  const emojiGridPresets = useMemo(
    () => presetsForCategory(emojiCategory),
    [emojiCategory],
  );
  const { language } = usePreferences();
  const isZh = language === 'zh';
  // Stable so memo(HeaderRow) is not busted by a new lambda each parent render.
  const onHeaderColorPress = useCallback((day: number) => {
    setColorPickerDay(day);
  }, []);
  const startIndexRef = useRef(0);
  /** List-space center Y of the row at drag grant (for finger tracking). */
  const startCenterYRef = useRef(0);
  /** Extra dy from programmatic parent scroll during drag. */
  const scrollAccumRef = useRef(0);
  /**
   * Legal full-list indices cached at grant. Ghost drag never mutates order mid-
   * pan, so this set stays valid for the whole gesture (no O(n²) recompute).
   */
  const legalIndicesRef = useRef<number[]>([]);
  /** Aim index while ghost-dragging (applied once on release). */
  const dropTargetIndexRef = useRef(0);
  const lastDropHapticIndexRef = useRef(-1);
  /** Coalesce edge auto-scroll to one scrollTo per animation frame. */
  const autoScrollRafRef = useRef<number | null>(null);
  const pendingAutoScrollRef = useRef(0);
  const pan = useRef(new Animated.Value(0)).current;
  /** Insertion line under finger aim (null when not dragging). */
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  /** onLayout heights so drag aim matches real header / stay / quick-add sizes. */
  const measuredHeightByIdRef = useRef(new Map<string, number>());
  const measuredGapByDayRef = useRef(new Map<number, number>());
  const [, setMeasureTick] = useState(0);

  const getMeasuredGeometry = useCallback((): MeasuredReorderGeometry => ({
    heightById: measuredHeightByIdRef.current,
    gapByDay: measuredGapByDayRef.current,
  }), []);

  const recordMeasuredHeight = useCallback((id: string, height: number) => {
    if (!(height > 0)) return;
    const prev = measuredHeightByIdRef.current.get(id);
    if (prev != null && Math.abs(prev - height) < 0.5) return;
    measuredHeightByIdRef.current.set(id, height);
    // Refresh geometry used by idle layout (drag reads refs directly).
    setMeasureTick((n) => n + 1);
  }, []);

  const recordMeasuredGap = useCallback((day: number, height: number) => {
    if (!(height > 0)) return;
    const prev = measuredGapByDayRef.current.get(day);
    if (prev != null && Math.abs(prev - height) < 0.5) return;
    measuredGapByDayRef.current.set(day, height);
    setMeasureTick((n) => n + 1);
  }, []);

  const [showSettings, setShowSettings] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [editDays, setEditDays] = useState(tripDays ?? 1);
  const [editDate, setEditDate] = useState(departureDate ? new Date(departureDate) : new Date());
  /** Day number currently in "set stop as accommodation" radio mode. */
  const [setStayModeDay, setSetStayModeDay] = useState<number | null>(null);
  /**
   * Pending stay pick while in set-stay mode. Checkbox only updates this;
   * commit happens when the header control shows「完成」and is pressed.
   */
  const [pendingStayDestId, setPendingStayDestId] = useState<string | null>(null);
  const [collapsedDays, setCollapsedDays] = useState<Record<number, boolean>>({});
  /**
   * Day2+ header chrome: default collapse; left-swipe toggles drag handle.
   * Only one affordance shows at a time. Day1 is collapse-only (no swipe).
   */
  const [headerAffordanceByDay, setHeaderAffordanceByDay] = useState<
    Record<number, 'collapse' | 'drag'>
  >({});
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  /** Favorite selected; date must be confirmed before write. */
  const [favoritePending, setFavoritePending] = useState<FavoritePlaceView | null>(null);

  const endDragSession = useCallback(() => {
    draggingRef.current = false;
    legalIndicesRef.current = [];
    scrollAccumRef.current = 0;
    pendingAutoScrollRef.current = 0;
    dropTargetIndexRef.current = 0;
    lastDropHapticIndexRef.current = -1;
    if (autoScrollRafRef.current != null) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
    // Always re-enable parent scroll even if release races with unmount.
    onDragActiveChange?.(false);
    setActiveId(null);
    setDropTargetIndex(null);
    pan.setValue(0);
  }, [onDragActiveChange, pan]);

  const openAndroidDatePicker = useCallback(() => {
    if (Platform.OS !== 'android') return;
    DateTimePickerAndroid.open({
      value: editDate,
      mode: 'date',
      display: 'default',
      minimumDate: startOfTodayLocal(),
      onChange: (_event, date) => {
        if (date) setEditDate(clampDateNotBeforeToday(date));
      },
    });
  }, [editDate]);

  // Local collapse prefs: account + group + calendar date (first open = expanded).
  useEffect(() => {
    if (!accountId || !groupId || !departureDate || !tripDays) return;
    let cancelled = false;
    (async () => {
      const next: Record<number, boolean> = {};
      const days = Math.max(1, tripDays);
      for (let d = 1; d <= days; d++) {
        const date = dateForTripDay(departureDate, d);
        if (!date) continue;
        const key = dayCollapseStorageKey(accountId, groupId, localDayKey(date));
        try {
          const raw = await AsyncStorage.getItem(key);
          if (raw === '1') next[d] = true;
        } catch {
          // ignore
        }
      }
      if (!cancelled) setCollapsedDays(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, groupId, departureDate, tripDays]);

  const toggleDayCollapsed = useCallback(
    async (day: number) => {
      setCollapsedDays((prev) => {
        const nextCollapsed = !prev[day];
        const next = { ...prev, [day]: nextCollapsed };
        if (accountId && groupId && departureDate) {
          const date = dateForTripDay(departureDate, day);
          if (date) {
            const key = dayCollapseStorageKey(accountId, groupId, localDayKey(date));
            void AsyncStorage.setItem(key, nextCollapsed ? '1' : '0').catch(() => {});
          }
        }
        return next;
      });
    },
    [accountId, groupId, departureDate],
  );

  const stayDateForDay = useCallback(
    (day: number): string | null => {
      const date = dateForTripDay(departureDate, day);
      return date ? localDayKey(date) : null;
    },
    [departureDate],
  );

  const handleSync = useCallback(async () => {
    if (!onSync || syncing) return;
    // onSync is MapScreen.syncFromDatabaseAndUploadLogs (runUiAction swallows
    // errors and surfaces recovery via the global banner). Local busy only.
    setSyncing(true);
    try {
      await onSync();
    } finally {
      setSyncing(false);
    }
  }, [onSync, syncing]);

  // Wait for onboarding
  useEffect(() => {
    if (canReorder && !tripDays) {
      readOnboardingState().then((state) => {
        if (state?.completed && state.answers.days) {
           const dDays = state.answers.days;
           const dDate = state.answers.departureDate ?? new Date().toISOString();
           onUpdateTripDetails(dDays, dDate);
           setEditDays(dDays);
           setEditDate(new Date(dDate));
        }
      }).catch(() => {});
    }
  }, [tripDays, canReorder, onUpdateTripDetails]);

  useEffect(() => {
    if (!draggingRef.current) {
      const nextOrder: ListItem[] = [];
      const days = Math.max(1, tripDays || 1);
      // Route editor always shows the full trip (day 1..N). Day-gating belongs
      // to the carousel only — hiding past days here caused Day1→Day2 after 完成.
      const startDay = 1;

      const sortedDests = [...destinations].sort((a, b) => {
        const dayA = a.day || 1;
        const dayB = b.day || 1;
        if (dayA !== dayB) return dayA - dayB;
        return a.order - b.order;
      });

      for (let d = startDay; d <= days; d++) {
        let dateStr = '';
        if (departureDate) {
          const dateObj = /^\d{4}-\d{2}-\d{2}$/.test(departureDate.trim())
            ? new Date(`${departureDate.trim()}T12:00:00`)
            : new Date(departureDate);
          if (!Number.isNaN(dateObj.getTime())) {
            dateObj.setDate(dateObj.getDate() + (d - 1));
            dateStr = t('map.tripDayDate', { month: dateObj.getMonth() + 1, day: dateObj.getDate() });
          }
        }
        nextOrder.push({
          type: 'header',
          day: d,
          id: `header-${d}`,
          title: t('trip.dayTitle', { day: d }),
          dateStr,
        });
        const dayDests = sortedDests.filter((dest) => (dest.day || 1) === d);
        for (const dest of dayDests) {
          nextOrder.push({ type: 'dest', item: dest, id: dest.id });
        }
      }
      // Destinations past tripDays still surface as orphans.
      for (const dest of sortedDests.filter((d) => (d.day || 1) > days)) {
        nextOrder.push({ type: 'dest', item: dest, id: dest.id });
      }

      setOrder(nextOrder);
    }
  }, [destinations, tripDays, departureDate, t]);

  const toReorderEntries = useCallback((list: ListItem[]): ReorderListEntry[] => {
    return list.map((entry) => {
      if (entry.type === 'header') {
        return { type: 'header' as const, day: entry.day, id: entry.id };
      }
      return {
        type: 'dest' as const,
        id: entry.item.id,
        day: entry.item.day || 1,
        kind: entry.item.kind === 'accommodation' ? 'accommodation' : 'stop',
        stayAnchor: entry.item.stayAnchor,
        title: entry.item.title,
      };
    });
  }, []);

  const handleGrant = useCallback(
    (id: string) => {
      const startIdx = orderRef.current.findIndex((d) => d.id === id);
      if (startIdx === -1) return;
      const entry = orderRef.current[startIdx];
      // Day1 header is fixed; Day2…last may drag.
      if (entry.type === 'header' && entry.day <= 1) return;
      draggingRef.current = true;
      onDragActiveChange?.(true);
      setActiveId(id);
      startIndexRef.current = startIdx;
      dropTargetIndexRef.current = startIdx;
      lastDropHapticIndexRef.current = startIdx;
      scrollAccumRef.current = 0;
      pendingAutoScrollRef.current = 0;
      const entries = toReorderEntries(orderRef.current);
      const measured = getMeasuredGeometry();
      startCenterYRef.current = reorderRowCenterY(
        entries,
        startIdx,
        REORDER_LAYOUT,
        measured,
      );
      // Ghost drag: order is frozen mid-gesture → legal slots stay valid for the whole drag.
      legalIndicesRef.current = legalDragIndicesForList(entries, id);
      setDropTargetIndex(startIdx);
      pan.setValue(0);
      selectionTick();
    },
    [pan, onDragActiveChange, toReorderEntries, getMeasuredGeometry],
  );

  const handleMove = useCallback(
    (id: string, dy: number, pageY?: number) => {
      if (!draggingRef.current) return;
      const startIndex = startIndexRef.current;
      // Ghost drag: row stays in DOM place; only pan follows the finger.
      // Do NOT setOrder mid-move — that re-parented rows under new day headers
      // and left deleteBg + pan offsets broken (red bar / freeze screenshot).

      // Edge auto-scroll so other day blocks off-screen stay reachable.
      // Proximity scales step so the further into the edge band, the faster.
      if (typeof pageY === 'number' && onDragAutoScroll) {
        const winH = Dimensions.get('window').height;
        let step = 0;
        if (pageY < DRAG_EDGE_PX) {
          const t = 1 - pageY / DRAG_EDGE_PX;
          step = -Math.max(DRAG_SCROLL_STEP, Math.round(DRAG_SCROLL_STEP * (1 + t * 1.5)));
        } else if (pageY > winH - DRAG_EDGE_PX) {
          const t = 1 - (winH - pageY) / DRAG_EDGE_PX;
          step = Math.max(DRAG_SCROLL_STEP, Math.round(DRAG_SCROLL_STEP * (1 + t * 1.5)));
        }
        if (step !== 0) {
          scrollAccumRef.current += step;
          pendingAutoScrollRef.current += step;
          if (autoScrollRafRef.current == null) {
            autoScrollRafRef.current = requestAnimationFrame(() => {
              autoScrollRafRef.current = null;
              const delta = pendingAutoScrollRef.current;
              pendingAutoScrollRef.current = 0;
              if (!draggingRef.current || delta === 0) return;
              onDragAutoScroll(delta);
            });
          }
        }
      }

      const effectiveDy = dy + scrollAccumRef.current;
      const entries = toReorderEntries(orderRef.current);
      const measured = getMeasuredGeometry();
      const rawTarget = dragTargetIndexFromOffset(
        entries,
        startIndex,
        effectiveDy,
        REORDER_LAYOUT,
        measured,
      );
      const direction = effectiveDy === 0 ? 0 : effectiveDy > 0 ? 1 : -1;
      const legal =
        legalIndicesRef.current.length > 0
          ? legalIndicesRef.current
          : legalDragIndicesForList(entries, id);
      // Allow aiming past the last row (append) — clamp to max legal if needed.
      const legalOrSelf = legal.length > 0 ? legal : [startIndex];
      const maxLegal = legalOrSelf[legalOrSelf.length - 1];
      const aim =
        rawTarget > maxLegal && maxLegal === entries.length - 1
          ? maxLegal
          : rawTarget;
      const target = snapToLegalDragIndex(legalOrSelf, aim, direction);
      dropTargetIndexRef.current = target;
      if (target !== lastDropHapticIndexRef.current) {
        lastDropHapticIndexRef.current = target;
        selectionTick();
        setDropTargetIndex(target);
      }

      // Pure finger offset — order/layout Y never changes during the gesture.
      pan.setValue(effectiveDy);
    },
    [pan, toReorderEntries, onDragAutoScroll, getMeasuredGeometry],
  );

  const handleRelease = useCallback(() => {
    if (!draggingRef.current) return;

    const updates: {
      id: string;
      position: number;
      day: number;
      stayAnchor?: boolean;
    }[] = [];
    try {
      const startIndex = startIndexRef.current;
      const target = dropTargetIndexRef.current;
      const moving = orderRef.current[startIndex];
      // Commit ghost drop once: single splice, single setOrder, no mid-drag thrash.
      if (target !== startIndex) {
        let next: ListItem[];
        if (moving?.type === 'header') {
          // Whole day block (header + all dests) — never move a bare header.
          next = moveDayBlockBefore(orderRef.current, startIndex, target);
          let dayCounter = 0;
          next = next.map((item) => {
            if (item.type === 'header') {
              dayCounter += 1;
              return {
                ...item,
                day: dayCounter,
                id: `header-${dayCounter}`,
                title: t('trip.dayTitle', { day: dayCounter }),
              };
            }
            // Stamp nested destination day from the preceding header.
            return {
              ...item,
              item: { ...item.item, day: dayCounter > 0 ? dayCounter : 1 },
            };
          });
        } else {
          next = orderAfterDragMove(orderRef.current, startIndex, target);
        }
        orderRef.current = next;
        setOrder(next);
      }

      let currentDay = 1;
      let position = 0;
      const byDay = new Map<number, AccommodationListItem[]>();
      for (const item of orderRef.current) {
        if (item.type === 'header') {
          currentDay = item.day;
        } else {
          updates.push({ id: item.id, position, day: currentDay });
          const list = byDay.get(currentDay) ?? [];
          list.push({
            id: item.item.id,
            kind: item.item.kind === 'accommodation' ? 'accommodation' : 'stop',
            order: position,
            day: currentDay,
            title: item.item.title,
            stayAnchor: item.item.stayAnchor,
          });
          byDay.set(currentDay, list);
          position++;
        }
      }

      // After drop: pure-index edges become stay anchors (persisted via reorder).
      for (const [day, dayItems] of byDay) {
        const anchored = applyPureIndexAnchors(dayItems);
        for (const a of anchored) {
          const u = updates.find((x) => x.id === a.id);
          if (u && a.kind === 'accommodation') {
            u.stayAnchor = Boolean(a.stayAnchor);
          }
        }
        void day;
      }

      let changed = false;
      const openIndexById = new Map(
        [...destinations]
          .sort((a, b) => a.order - b.order)
          .map((destination, index) => [destination.id, index]),
      );
      for (const u of updates) {
        const orig = destinations.find((d) => d.id === u.id);
        if (
          !orig
          || openIndexById.get(u.id) !== u.position
          || (orig.day || 1) !== u.day
          || (u.stayAnchor !== undefined
            && Boolean(orig.stayAnchor) !== Boolean(u.stayAnchor)
            && orig.kind === 'accommodation')
        ) {
          changed = true;
          break;
        }
      }

      if (changed) {
        lightTap();
        onReorder(updates);
      }
    } finally {
      // Unlock parent ScrollView even if update computation throws.
      endDragSession();
    }
  }, [onReorder, destinations, endDragSession, t]);

  const handlersRef = useRef({ handleGrant, handleMove, handleRelease });
  handlersRef.current = { handleGrant, handleMove, handleRelease };
  const onGrant = useCallback((id: string) => handlersRef.current.handleGrant(id), []);
  const onMove = useCallback(
    (id: string, dy: number, pageY?: number) =>
      handlersRef.current.handleMove(id, dy, pageY),
    [],
  );
  const onRelease = useCallback(() => handlersRef.current.handleRelease(), []);

  return (
    <View>
      {(canReorder || onImport || (syncFailed && onSync)) && (
        <View style={styles.topActions}>
          {canReorder && <Pressable style={styles.setDaysBtn} onPress={() => {
            lightTap();
            setEditDays(tripDays ?? 1);
            setEditDate(departureDate ? new Date(departureDate) : new Date());
            setShowSettings(true);
          }}>
            <Ionicons name="calendar-outline" size={16} color={colors.accent} style={{ marginRight: 6 }} />
            <Text style={styles.setDaysText}>{t('trip.setDaysAndDate')}</Text>
          </Pressable>}
          {canReorder && onPickFavorite && (favoritePlaces?.length ?? 0) > 0 ? (
            <Pressable
              style={styles.setDaysBtn}
              onPress={() => {
                lightTap();
                setFavoritesOpen(true);
              }}
              accessibilityRole="button"
              accessibilityLabel={t('stay.favorites')}
            >
              <Ionicons name="star-outline" size={16} color={colors.accent} style={{ marginRight: 6 }} />
              <Text style={styles.setDaysText}>{t('stay.favorites')}</Text>
            </Pressable>
          ) : null}
          {onImport && <Pressable
            style={styles.setDaysBtn}
            onPress={() => {
              lightTap();
              onImport();
            }}
            accessibilityRole="button"
            accessibilityLabel={t('kml.entry')}
          >
            <Ionicons name="cloud-upload-outline" size={16} color={colors.accent} style={{ marginRight: 6 }} />
            <Text style={styles.setDaysText}>{t('kml.entry')}</Text>
          </Pressable>}
          {syncFailed && onSync && <Pressable
            style={[styles.setDaysBtn, syncing && { opacity: 0.5 }]}
            onPress={() => void handleSync()}
            disabled={syncing}
            accessibilityRole="button"
            accessibilityLabel={t('map.syncDbA11y')}
          >
            <Ionicons name="refresh-outline" size={16} color={colors.accent} style={{ marginRight: 6 }} />
            <Text style={styles.setDaysText}>
              {syncing ? t('map.syncDbSyncing') : t('map.syncDbRetry')}
            </Text>
          </Pressable>}
        </View>
      )}

      {order.length === 0 ? (
         <Text style={styles.empty}>{emptyLabel}</Text>
      ) : (
        <View style={styles.list}>
          {(() => {
            // Group into day blocks: header + dests (+ quick-add at end of each day).
            type DayBlock =
              | { kind: 'day'; header: Extract<ListItem, { type: 'header' }>; dests: Extract<ListItem, { type: 'dest' }>[] }
              | { kind: 'orphan'; dest: Extract<ListItem, { type: 'dest' }> };
            const blocks: DayBlock[] = [];
            let current: Extract<DayBlock, { kind: 'day' }> | null = null;
            for (const item of order) {
              if (item.type === 'header') {
                current = { kind: 'day', header: item, dests: [] };
                blocks.push(current);
              } else if (current) {
                current.dests.push(item);
              } else {
                blocks.push({ kind: 'orphan', dest: item });
              }
            }

            const renderDestRow = (
              item: Extract<ListItem, { type: 'dest' }>,
              /** Day block this row is rendered under (may differ from item.day mid-drag). */
              blockDay?: number,
            ) => {
              const visualDay = blockDay ?? item.item.day ?? 1;
              if (collapsedDays[visualDay] || collapsedDays[item.item.day || 1]) return null;
              const dayColor = getColorForDay(visualDay, dayColors);
              const dayItems: AccommodationListItem[] = destinations
                .filter((d) => (d.day || 1) === visualDay)
                .map((d) => ({
                  id: d.id,
                  kind: d.kind === 'accommodation' ? 'accommodation' : 'stop',
                  order: d.order,
                  day: d.day || 1,
                  title: d.title,
                  stayAnchor: d.stayAnchor,
                }));
              const { lockedIds } = accommodationBoundaryLocks(dayItems);
              // Stay cards stay free to drag/swipe (auto-add edge locks disabled).
              const locked = false;
              void lockedIds;
              const inSetMode = setStayModeDay === visualDay;
              const stayDateKey = stayDateForDay(visualDay);
              const dailyForDay = stayDateKey && dailyByDate
                ? dailyByDate[stayDateKey]
                : undefined;
              // Bed badge for accommodation cards (quick-add / copies).
              // Background highlight only when name+coords match the day's daily stay.
              const isStayCard = item.item.kind === 'accommodation';
              const stayHighlight = Boolean(
                dailyForDay
                && item.item.coordinates
                && dailyForDay.coordinates
                && placeExactMatchKey(item.item.title, item.item.coordinates)
                  === placeExactMatchKey(dailyForDay.title, dailyForDay.coordinates),
              );
              return (
                <Row
                  key={item.id}
                  item={item.item}
                  active={activeId === item.id}
                  canReorder={canReorder && !locked}
                  pan={pan}
                  styles={styles}
                  dayColor={dayColor}
                  onGrant={onGrant}
                  onMove={onMove}
                  onRelease={onRelease}
                  onDelete={onDelete}
                  isAccommodation={isStayCard}
                  stayHighlight={stayHighlight}
                  boundaryLocked={locked}
                  // Stops and accommodation cards are both valid set-stay sources.
                  showSelect={inSetMode}
                  selectSelected={pendingStayDestId === item.item.id}
                  onSelectAsStay={
                    inSetMode
                      ? () => {
                          // Local draft only — commit on header「完成」.
                          // Does not remove or convert the source destination.
                          selectionTick();
                          setPendingStayDestId(item.item.id);
                        }
                      : undefined
                  }
                  onLayoutHeight={(h) => recordMeasuredHeight(item.id, h)}
                  onEmojiPress={
                    // Stay cards always show a fixed bed — no emoji picker.
                    canReorder
                    && onUpdateEmojiColor
                    && !isStayCard
                      ? (id) => {
                          lightTap();
                          const dest = destinations.find((d) => d.id === id);
                          setEmojiDraft(resolveDestinationEmoji(dest?.emoji));
                          setEmojiCategory('common');
                          setEmojiPreviewDayColor(getColorForDay(dest?.day, dayColors));
                          setEmojiSaveError(false);
                          setEmojiSaving(false);
                          setEmojiPickerDestId(id);
                        }
                      : undefined
                  }
                />
              );
            };

            // Flat index walk matches order[] for ghost drop indicator.
            let flatIndex = 0;
            const blockNodes = blocks.map((block, blockIndex) => {
              if (block.kind === 'orphan') {
                const line =
                  dropTargetIndex === flatIndex ? (
                    <View
                      key={`drop-${flatIndex}`}
                      style={[styles.dropLine, { backgroundColor: colors.accent }]}
                    />
                  ) : null;
                const row = renderDestRow(block.dest);
                flatIndex += 1;
                return (
                  <React.Fragment key={block.dest.id}>
                    {line}
                    {row}
                  </React.Fragment>
                );
              }
              const item = block.header;
              const bgColor = dayColors[item.day] || DAY_COLORS[(item.day - 1) % DAY_COLORS.length];
              const stayDate = stayDateForDay(item.day);
              const daily = stayDate && dailyByDate ? dailyByDate[stayDate] : undefined;
              const collapsed = Boolean(collapsedDays[item.day]);
              const dayStopCount = block.dests.length;
              const hasDaily = Boolean(daily);
              // Quick-add stay card only after daily accommodation is set
              // (avoids mis-taps while dragging day blocks with no stay yet).
              const showQuickAdd =
                !collapsed
                && canReorder
                && onQuickAddAccommodation != null
                && dayStopCount > 0
                && hasDaily;
              // Day1: collapse only. Day2+: left-swipe toggles collapse ↔ drag.
              const headerAffordance = headerAffordanceByDay[item.day] ?? 'collapse';
              const canSwipeToggle = canReorder && item.day > 1;
              const showCollapseAffordance =
                item.day <= 1 || headerAffordance === 'collapse';
              const showDragAffordance =
                canReorder && item.day > 1 && headerAffordance === 'drag';
              // Drop on a header index = first slot of that day → draw AFTER header,
              // never between previous day's quick-add and this header.
              const headerIndex = flatIndex;
              const dropAfterHeader = dropTargetIndex === headerIndex;
              flatIndex += 1; // header occupies one order slot
              const destNodes = !collapsed
                ? block.dests.map((destItem, destIdx) => {
                    // First dest: header already claimed the "after header" line.
                    const line =
                      dropTargetIndex === flatIndex
                      && !(dropAfterHeader && destIdx === 0)
                        ? (
                          <View
                            key={`drop-${flatIndex}`}
                            style={[styles.dropLine, { backgroundColor: colors.accent }]}
                          />
                        )
                        : null;
                    const row = renderDestRow(destItem, item.day);
                    flatIndex += 1;
                    return (
                      <React.Fragment key={destItem.id}>
                        {line}
                        {row}
                      </React.Fragment>
                    );
                  })
                : (() => {
                    flatIndex += block.dests.length;
                    return null;
                  })();
              return (
                <View
                  key={item.id}
                  style={[
                    styles.dayBlock,
                    blockIndex > 0 ? styles.dayBlockSpaced : null,
                  ]}
                  testID={`day-block-${item.day}`}
                >
                  <HeaderRow
                    item={item}
                    styles={styles}
                    bgColor={bgColor}
                    canEditColors={canReorder}
                    onColorPress={onHeaderColorPress}
                    dailyTitle={daily?.title}
                    onRemoveDaily={
                      canReorder && hasDaily && onClearDailyAccommodation && stayDate
                        ? () => {
                            lightTap();
                            onClearDailyAccommodation(stayDate, item.day);
                          }
                        : undefined
                    }
                    collapsed={collapsed}
                    onToggleCollapse={
                      showCollapseAffordance
                        ? () => {
                            selectionTick();
                            void toggleDayCollapsed(item.day);
                          }
                        : undefined
                    }
                    canDragHeader={showDragAffordance}
                    canSwipeToggleAffordance={canSwipeToggle}
                    onSwipeToggleAffordance={() => {
                      mediumTap();
                      setHeaderAffordanceByDay((prev) => {
                        const cur = prev[item.day] ?? 'collapse';
                        return {
                          ...prev,
                          [item.day]: cur === 'collapse' ? 'drag' : 'collapse',
                        };
                      });
                    }}
                    onHeaderGrant={
                      showDragAffordance
                        ? () => onGrant(item.id)
                        : undefined
                    }
                    onHeaderMove={
                      showDragAffordance
                        ? (dy, pageY) => onMove(item.id, dy, pageY)
                        : undefined
                    }
                    onHeaderRelease={
                      showDragAffordance ? () => onRelease() : undefined
                    }
                    onHeaderCancel={
                      showDragAffordance ? () => endDragSession() : undefined
                    }
                    headerActive={activeId === item.id}
                    headerPan={pan}
                    setStayLabel={
                      canReorder
                      && !hasDaily
                      && onSetDailyFromDestination
                      && dayStopCount > 0
                        ? setStayModeDay === item.day
                          ? t('stay.finishSet')
                          : t('stay.setFromStop')
                        : undefined
                    }
                    setStayActive={setStayModeDay === item.day}
                    onToggleSetStay={
                      canReorder
                      && !hasDaily
                      && onSetDailyFromDestination
                      && dayStopCount > 0
                        ? () => {
                            lightTap();
                            if (setStayModeDay === item.day) {
                              // Header「完成」: commit pending radio selection, then exit.
                              if (pendingStayDestId && onSetDailyFromDestination) {
                                const pick = block.dests.find(
                                  (d) => d.item.id === pendingStayDestId,
                                );
                                // Allow accommodation cards as stay source
                                // (moved cross-day stay copies keep kind).
                                if (pick) {
                                  onSetDailyFromDestination(pick.item.id, item.day);
                                }
                              }
                              setPendingStayDestId(null);
                              setSetStayModeDay(null);
                            } else {
                              setPendingStayDestId(null);
                              setSetStayModeDay(item.day);
                            }
                          }
                        : undefined
                    }
                    accent={colors.accent}
                    onLayoutHeight={(h) => recordMeasuredHeight(item.id, h)}
                  />
                  {dropAfterHeader ? (
                    <View
                      key={`drop-after-header-${item.day}`}
                      style={[styles.dropLine, { backgroundColor: colors.accent }]}
                      testID={`drop-after-header-${item.day}`}
                    />
                  ) : null}
                  {destNodes}
                  {/* Quick-add only when the day already has gathering points. */}
                  {showQuickAdd ? (
                    <View
                      style={styles.dayActions}
                      onLayout={(e) => recordMeasuredGap(item.day, e.nativeEvent.layout.height)}
                    >
                      <Pressable
                        style={styles.dashedBtn}
                        onPress={() => {
                          lightTap();
                          onQuickAddAccommodation(item.day);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={t('stay.quickAdd')}
                      >
                        <Text style={[styles.dashedBtnText, { color: colors.accent }]}>
                          {t('stay.quickAdd')}
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              );
            });
            // Insertion line after the last row (aim past last midpoint).
            const endDrop =
              dropTargetIndex === flatIndex ? (
                <View
                  key={`drop-end-${flatIndex}`}
                  style={[styles.dropLine, { backgroundColor: colors.accent }]}
                />
              ) : null;
            return (
              <>
                {blockNodes}
                {endDrop}
              </>
            );
          })()}
        </View>
      )}

      <Modal
        visible={favoritesOpen && !favoritePending}
        transparent
        animationType="fade"
        onRequestClose={() => setFavoritesOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalTitleRow}>
              <Text style={[styles.modalTitle, styles.modalTitleGrow]}>{t('stay.favorites')}</Text>
              <Pressable
                onPress={() => setFavoritesOpen(false)}
                accessibilityRole="button"
                accessibilityLabel={t('common.cancel')}
                hitSlop={8}
                style={styles.modalTitleCancel}
              >
                <Text style={styles.modalActionText}>{t('common.cancel')}</Text>
              </Pressable>
            </View>
            {(favoritePlaces ?? []).map((fav) => (
              <View key={fav.id} style={styles.favRow}>
                <Pressable
                  style={styles.favRowMain}
                  onPress={() => {
                    // #160: show eligible-date picker first; write only after confirm.
                    setFavoritePending(fav);
                  }}
                  accessibilityRole="button"
                >
                  <Ionicons name="star" size={16} color={colors.accent} />
                  <Text style={styles.favTitle} numberOfLines={1}>{fav.title}</Text>
                </Pressable>
                {onDeleteFavorite ? (
                  <Pressable
                    onPress={() => {
                      lightTap();
                      onDeleteFavorite(fav);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t('stay.unfavoriteA11y')}
                    hitSlop={8}
                    style={styles.favDeleteBtn}
                  >
                    <Ionicons name="trash-outline" size={18} color="#FF5A5F" />
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        </View>
      </Modal>

      <Modal
        visible={favoritePending != null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          // Cancel: write nothing.
          setFavoritePending(null);
          setFavoritesOpen(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {favoritePending?.title ?? t('stay.favorites')}
            </Text>
            <Text style={styles.modalLabel}>{t('stay.pickDate')}</Text>
            {eligibleFavoriteDateOptions({
              departureDate,
              tripDays,
            }).map((opt) => (
              <Pressable
                key={opt.dateKey}
                style={styles.favRow}
                onPress={() => {
                  const fav = favoritePending;
                  if (fav) {
                    onPickFavorite?.(fav, opt.day);
                  }
                  setFavoritePending(null);
                  setFavoritesOpen(false);
                }}
                accessibilityRole="button"
              >
                <Ionicons name="calendar-outline" size={16} color={colors.accent} />
                <Text style={styles.favTitle}>
                  {t('trip.dayTitle', { day: opt.day })} · {opt.dateKey}
                </Text>
              </Pressable>
            ))}
            {eligibleFavoriteDateOptions({ departureDate, tripDays }).length === 0 ? (
              <Text style={styles.empty}>{t('stay.noEligibleDates')}</Text>
            ) : null}
            <Pressable
              onPress={() => {
                // Cancel / ended-trip path: write nothing.
                setFavoritePending(null);
                setFavoritesOpen(false);
              }}
              style={styles.modalActionBtn}
              accessibilityRole="button"
            >
              <Text style={styles.modalActionText}>{t('common.cancel')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={showSettings} transparent animationType="fade">
         <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
               <Text style={styles.modalTitle}>{t('trip.setDaysTitle')}</Text>
               <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>{t('trip.departureDate')}</Text>
                  {Platform.OS === 'android' ? (
                    <Pressable onPress={openAndroidDatePicker} style={styles.datePickerButton}>
                      <Ionicons name="calendar-outline" size={18} color={colors.accent} />
                      <Text style={styles.datePickerText}>
                        {editDate.toLocaleDateString()}
                      </Text>
                    </Pressable>
                  ) : (
                    <DateTimePicker
                       value={editDate}
                       mode="date"
                       display="default"
                       minimumDate={startOfTodayLocal()}
                       onChange={(_event, date) => {
                           if (date) setEditDate(clampDateNotBeforeToday(date));
                       }}
                    />
                  )}
               </View>
               <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>{t('trip.totalDays')}</Text>
                  <View style={styles.daysControls}>
                     <Pressable onPress={() => setEditDays(Math.max(1, editDays - 1))} style={styles.daysBtn}>
                        <Text style={styles.daysBtnText}>-</Text>
                     </Pressable>
                     <Text style={styles.daysValue}>{editDays}</Text>
                     <Pressable onPress={() => setEditDays(editDays + 1)} style={styles.daysBtn}>
                        <Text style={styles.daysBtnText}>+</Text>
                     </Pressable>
                  </View>
               </View>
               <View style={styles.modalActions}>
                  <Pressable onPress={() => setShowSettings(false)} style={styles.modalActionBtn}>
                     <Text style={styles.modalActionText}>{t('common.cancel')}</Text>
                  </Pressable>
                  <Pressable onPress={() => {
                      setShowSettings(false);
                      // New picks are clamped to ≥ today; an already-past trip
                      // start is kept if the user never changed the date.
                      const min = startOfTodayLocal();
                      const existing = departureDate ? new Date(departureDate) : null;
                      const unchangedPast =
                        existing &&
                        !Number.isNaN(existing.getTime()) &&
                        editDate.getFullYear() === existing.getFullYear() &&
                        editDate.getMonth() === existing.getMonth() &&
                        editDate.getDate() === existing.getDate() &&
                        editDate.getTime() < min.getTime();
                      const toSave = unchangedPast
                        ? existing
                        : clampDateNotBeforeToday(editDate);
                      onUpdateTripDetails(editDays, toSave.toISOString());
                  }} style={[styles.modalActionBtn, { backgroundColor: colors.accent }]}>
                     <Text style={[styles.modalActionText, { color: '#fff' }]}>{t('trip.save')}</Text>
                  </Pressable>
               </View>
            </View>
         </View>
      </Modal>

      <Modal visible={colorPickerDay !== null} transparent animationType="fade">
         <Pressable style={styles.modalOverlay} onPress={() => setColorPickerDay(null)}>
            <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
               <Text style={styles.modalTitle}>{t('trip.dayFlagColor', { day: colorPickerDay ?? 1 })}</Text>
               <View style={styles.colorPickerContainer}>
                  {DAY_COLORS.map(c => (
                     <Pressable
                        key={c}
                        onPress={() => { setDayColor(colorPickerDay!, c); setColorPickerDay(null); }}
                        style={[styles.colorPickerDot, { backgroundColor: c }]}
                     />
                  ))}
               </View>
            </Pressable>
         </Pressable>
      </Modal>

      <Modal visible={emojiPickerDestId !== null} transparent animationType="fade">
        <Pressable
          style={styles.emojiSheetOverlay}
          onPress={() => {
            if (emojiSaving) return;
            setEmojiPickerDestId(null);
            setEmojiSaveError(false);
          }}
        >
          <Pressable style={styles.emojiSheetCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.emojiSheetTitle}>{t('destEmoji.title')}</Text>
            <Text style={styles.emojiSheetHint}>{t('destEmoji.preview')}</Text>

            {/* Large map-pin style preview (matches design mockup). */}
            <View style={styles.emojiPinPreviewWrap} testID="dest-emoji-preview">
              <View style={styles.emojiPinPreview}>
                <View style={styles.emojiPinHead}>
                  <Text style={styles.emojiPinGlyph}>{emojiDraft}</Text>
                </View>
                <View style={styles.emojiPinStem} />
                <View style={styles.emojiPinDot} />
              </View>
            </View>

            {/* Category tabs: 常用 / 餐飲 / 景點 / 交通 / 自然 / 活動 */}
            <View style={styles.emojiCategoryRow}>
              {DESTINATION_EMOJI_CATEGORIES.map((cat) => {
                const selected = cat.id === emojiCategory;
                return (
                  <Pressable
                    key={cat.id}
                    onPress={() => setEmojiCategory(cat.id)}
                    style={[
                      styles.emojiCategoryTab,
                      selected && {
                        backgroundColor: `${colors.accent}28`,
                        borderColor: colors.accent,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={isZh ? cat.labelZh : cat.labelEn}
                  >
                    <Text
                      style={[
                        styles.emojiCategoryTabText,
                        selected && { color: colors.accent, fontWeight: '700' },
                      ]}
                      numberOfLines={1}
                    >
                      {isZh ? cat.labelZh : cat.labelEn}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.emojiPresetGrid} testID="dest-emoji-grid">
              {emojiGridPresets.map((preset) => {
                const selected = preset.emoji === emojiDraft;
                return (
                  <Pressable
                    key={preset.emoji}
                    onPress={() => {
                      setEmojiDraft(preset.emoji);
                      setEmojiSaveError(false);
                    }}
                    style={[
                      styles.emojiPresetCell,
                      {
                        // Ticket 07: every cell uses the same accent border.
                        // Selection is background, not a different border color/width.
                        borderColor: selected ? colors.accent : 'rgba(255,255,255,0.12)',
                        borderWidth: 2,
                        backgroundColor: selected
                          ? `${colors.accent}33`
                          : 'rgba(255,255,255,0.06)',
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={isZh ? preset.labelZh : preset.labelEn}
                  >
                    <Text style={styles.emojiPresetGlyph}>{preset.emoji}</Text>
                  </Pressable>
                );
              })}
            </View>
            {emojiSaveError ? (
              <Text style={styles.emojiError} testID="dest-emoji-save-error">
                {t('destEmoji.saveFailed')}
              </Text>
            ) : null}
            <View style={styles.emojiSheetActions}>
              <Pressable
                onPress={() => {
                  if (emojiSaving) return;
                  setEmojiPickerDestId(null);
                  setEmojiSaveError(false);
                }}
                style={styles.emojiSheetCancel}
                accessibilityRole="button"
                accessibilityLabel={t('common.cancel')}
              >
                <Text style={styles.emojiSheetCancelText}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (!emojiPickerDestId || !onUpdateEmojiColor || emojiSaving) return;
                  const destId = emojiPickerDestId;
                  const emoji = emojiDraft;
                  setEmojiSaving(true);
                  setEmojiSaveError(false);
                  void (async () => {
                    try {
                      await onUpdateEmojiColor(destId, { emoji });
                      setEmojiPickerDestId(null);
                      setEmojiSaveError(false);
                    } catch (e) {
                      if (__DEV__) {
                        // Surface reason in metro for intermittent save failures.
                        console.warn('[destEmoji] save failed', e);
                      }
                      setEmojiSaveError(true);
                    } finally {
                      setEmojiSaving(false);
                    }
                  })();
                }}
                style={[
                  styles.emojiSheetConfirm,
                  { backgroundColor: colors.accent },
                  emojiSaving && { opacity: 0.6 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={t('common.confirm')}
                accessibilityState={{ disabled: emojiSaving, busy: emojiSaving }}
                testID="dest-emoji-confirm"
              >
                <Text style={styles.emojiSheetConfirmText}>
                  {t('common.confirm')}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const HeaderRow = memo(function HeaderRow({
  item,
  styles,
  bgColor,
  canEditColors,
  onColorPress,
  dailyTitle,
  onRemoveDaily,
  collapsed,
  onToggleCollapse,
  canDragHeader,
  canSwipeToggleAffordance,
  onSwipeToggleAffordance,
  onHeaderGrant,
  onHeaderMove,
  onHeaderRelease,
  onHeaderCancel,
  headerActive,
  headerPan,
  setStayLabel,
  setStayActive,
  onToggleSetStay,
  accent,
  onLayoutHeight,
}: {
  item: { day: number; title: string; dateStr: string };
  styles: any;
  bgColor: string;
  canEditColors: boolean;
  onColorPress: (day: number) => void;
  dailyTitle?: string;
  onRemoveDaily?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  canDragHeader?: boolean;
  /** Day2+: left-swipe toggles collapse ↔ drag (only one shown at a time). */
  canSwipeToggleAffordance?: boolean;
  onSwipeToggleAffordance?: () => void;
  onHeaderGrant?: () => void;
  onHeaderMove?: (dy: number, pageY?: number) => void;
  /** Finger released — commit drop. */
  onHeaderRelease?: () => void;
  /** Gesture stolen/cancelled — do not commit. */
  onHeaderCancel?: () => void;
  headerActive?: boolean;
  headerPan?: Animated.Value;
  /** Label for set-stay control placed after day title (not dashed). */
  setStayLabel?: string;
  setStayActive?: boolean;
  onToggleSetStay?: () => void;
  accent: string;
  onLayoutHeight?: (height: number) => void;
}) {
  const { t } = useTranslation();
  const hasStay = Boolean(dailyTitle);
  const canDragHeaderRef = useRef(canDragHeader);
  canDragHeaderRef.current = canDragHeader;
  const canSwipeToggleRef = useRef(canSwipeToggleAffordance);
  canSwipeToggleRef.current = canSwipeToggleAffordance;
  const onSwipeToggleRef = useRef(onSwipeToggleAffordance);
  onSwipeToggleRef.current = onSwipeToggleAffordance;
  const onHeaderGrantRef = useRef(onHeaderGrant);
  onHeaderGrantRef.current = onHeaderGrant;
  const onHeaderMoveRef = useRef(onHeaderMove);
  onHeaderMoveRef.current = onHeaderMove;
  const onHeaderReleaseRef = useRef(onHeaderRelease);
  onHeaderReleaseRef.current = onHeaderRelease;
  const onHeaderCancelRef = useRef(onHeaderCancel);
  onHeaderCancelRef.current = onHeaderCancel;
  const swipeX = useRef(new Animated.Value(0)).current;
  const headerAxisRef = useRef<null | 'h' | 'v'>(null);
  const dragResponder = useRef(
    PanResponder.create({
      // Only claim from the ≡ handle itself (vertical drag).
      onStartShouldSetPanResponder: () => Boolean(canDragHeaderRef.current),
      onMoveShouldSetPanResponder: (_e, g) =>
        Boolean(canDragHeaderRef.current)
        && Math.abs(g.dy) > 4
        && Math.abs(g.dy) > Math.abs(g.dx),
      // Keep ownership for the whole gesture so ScrollView cannot mid-commit.
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => onHeaderGrantRef.current?.(),
      onPanResponderMove: (_e, g) => onHeaderMoveRef.current?.(g.dy, g.moveY),
      onPanResponderRelease: () => onHeaderReleaseRef.current?.(),
      // Stolen/cancelled → cancel without reorder commit.
      onPanResponderTerminate: () => onHeaderCancelRef.current?.(),
    }),
  ).current;

  const swipeResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) =>
        Boolean(canSwipeToggleRef.current)
        && Math.abs(g.dx) > 8
        && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        headerAxisRef.current = null;
      },
      onPanResponderMove: (_e, g) => {
        if (!canSwipeToggleRef.current) return;
        if (headerAxisRef.current == null && Math.abs(g.dx) > 6) {
          headerAxisRef.current = 'h';
        }
        if (headerAxisRef.current === 'h') {
          const next = Math.max(-REVEAL_WIDTH, Math.min(0, g.dx));
          swipeX.setValue(next);
        }
      },
      onPanResponderRelease: (_e, g) => {
        if (headerAxisRef.current === 'h' && canSwipeToggleRef.current) {
          const crossed = g.dx < -REVEAL_WIDTH / 2;
          Animated.spring(swipeX, {
            toValue: 0,
            useNativeDriver: false,
            bounciness: 6,
            speed: 18,
          }).start();
          if (crossed) {
            onSwipeToggleRef.current?.();
          }
        } else {
          swipeX.setValue(0);
        }
        headerAxisRef.current = null;
      },
      onPanResponderTerminate: () => {
        Animated.spring(swipeX, {
          toValue: 0,
          useNativeDriver: false,
          bounciness: 0,
        }).start();
        headerAxisRef.current = null;
      },
    }),
  ).current;

  return (
    <Animated.View
      onLayout={(e) => onLayoutHeight?.(e.nativeEvent.layout.height)}
      style={
        headerActive && headerPan
          ? { transform: [{ translateY: headerPan }], zIndex: 10, elevation: 6 }
          : undefined
      }
      {...(canSwipeToggleAffordance ? swipeResponder.panHandlers : {})}
    >
      {/* Row 1: day title, date, collapse OR drag (swipe toggles). */}
      <Animated.View
        style={[
          styles.headerRow,
          hasStay && styles.headerRowCompact,
          { transform: [{ translateX: swipeX }] },
        ]}
      >
        <View style={styles.headerRowInner}>
          <View style={styles.headerLeft}>
            <Pressable
              onPress={() => onColorPress(item.day)}
              disabled={!canEditColors}
              accessibilityRole={canEditColors ? 'button' : undefined}
              accessibilityLabel={canEditColors ? 'change day color' : undefined}
              style={[styles.colorDot, { backgroundColor: bgColor }]}
            />
            <Text style={styles.headerTitle}>{item.title}</Text>
            {!hasStay && onToggleSetStay && setStayLabel ? (
              <Pressable
                style={[
                  styles.headerSetStayBtn,
                  setStayActive && { backgroundColor: accent },
                ]}
                onPress={onToggleSetStay}
                accessibilityRole="button"
                accessibilityState={{ selected: !!setStayActive }}
                accessibilityLabel={setStayLabel}
              >
                <Text
                  style={[
                    styles.headerSetStayText,
                    { color: setStayActive ? '#111' : accent },
                  ]}
                  numberOfLines={1}
                >
                  {setStayLabel}
                </Text>
              </Pressable>
            ) : null}
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.headerDate}>{item.dateStr}</Text>
            {onToggleCollapse ? (
              <Pressable onPress={onToggleCollapse} accessibilityRole="button" hitSlop={8}>
                <Ionicons name={collapsed ? 'chevron-down' : 'chevron-up'} size={16} color="#999" />
              </Pressable>
            ) : null}
            {canDragHeader ? (
              <View {...dragResponder.panHandlers} hitSlop={12}>
                <Text style={styles.handle}>≡</Text>
              </View>
            ) : null}
          </View>
        </View>
      </Animated.View>
      {/* Row 2: accommodation place + remove (only when stay is set). */}
      {hasStay ? (
        <View style={styles.headerStayRow}>
          <View style={styles.stayBadge}>
            <Ionicons name="bed-outline" size={12} color="#fff" />
            <Text style={styles.stayBadgeText} numberOfLines={1}>{dailyTitle}</Text>
          </View>
          {onRemoveDaily ? (
            <Pressable
              onPress={onRemoveDaily}
              accessibilityRole="button"
              accessibilityLabel={t('stay.remove')}
              hitSlop={8}
            >
              <Text style={styles.removeStayText}>{t('stay.remove')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Animated.View>
  );
});

const Row = memo(function Row({
  item,
  active,
  canReorder,
  pan,
  styles,
  dayColor,
  onGrant,
  onMove,
  onRelease,
  onDelete,
  onEmojiPress,
  isAccommodation,
  stayHighlight,
  boundaryLocked,
  showSelect,
  selectSelected,
  onSelectAsStay,
  onLayoutHeight,
}: {
  item: Destination;
  active: boolean;
  canReorder: boolean;
  pan: Animated.Value;
  styles: ReturnType<typeof makeStyles>;
  dayColor: string;
  onGrant: (id: string) => void;
  onMove: (id: string, dy: number, pageY?: number) => void;
  onRelease: () => void;
  onDelete?: (id: string) => void;
  onEmojiPress?: (id: string) => void;
  isAccommodation?: boolean;
  /** Same name+coords as daily stay — distinct row background. */
  stayHighlight?: boolean;
  /** Head/tail stay card: always-visible trash, no swipe-to-delete. */
  boundaryLocked?: boolean;
  showSelect?: boolean;
  /** Local pending stay selection (not yet committed). */
  selectSelected?: boolean;
  onSelectAsStay?: () => void;
  onLayoutHeight?: (height: number) => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const axisRef = useRef<null | 'h' | 'v'>(null);
  const openRef = useRef(false);
  // Boundary-locked stays use a permanent trash control — no horizontal swipe.
  const canSwipe = !!onDelete && !boundaryLocked;
  const canSwipeRef = useRef(canSwipe);
  canSwipeRef.current = canSwipe;
  const canReorderRef = useRef(canReorder);
  canReorderRef.current = canReorder;
  const itemIdRef = useRef(item.id);
  itemIdRef.current = item.id;
  const onGrantRef = useRef(onGrant);
  onGrantRef.current = onGrant;
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const onReleaseRef = useRef(onRelease);
  onReleaseRef.current = onRelease;

  const snap = useCallback(
    (open: boolean) => {
      openRef.current = open;
      Animated.spring(translateX, {
        toValue: open ? -REVEAL_WIDTH : 0,
        useNativeDriver: false,
        bounciness: 0,
      }).start();
    },
    [translateX],
  );
  const snapRef = useRef(snap);
  snapRef.current = snap;

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt) => {
        if (!canReorderRef.current) return false;
        const screenWidth = Dimensions.get('window').width;
        if (evt.nativeEvent.pageX > screenWidth - 60) return true;
        return false;
      },
      onMoveShouldSetPanResponder: (_evt, g) =>
        canSwipeRef.current && Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        axisRef.current = null;
        const screenWidth = Dimensions.get('window').width;
        if (canReorderRef.current && evt.nativeEvent.pageX > screenWidth - 60) {
           axisRef.current = 'v';
           onGrantRef.current(itemIdRef.current);
        }
      },
      onPanResponderMove: (_evt, g) => {
        if (axisRef.current === null && canSwipeRef.current && Math.abs(g.dx) > 6) {
          axisRef.current = 'h';
        }
        if (axisRef.current === 'h' && canSwipeRef.current) {
          const base = openRef.current ? -REVEAL_WIDTH : 0;
          const next = Math.max(-REVEAL_WIDTH, Math.min(0, base + g.dx));
          translateX.setValue(next);
        } else if (axisRef.current === 'v') {
          onMoveRef.current(itemIdRef.current, g.dy, g.moveY);
        }
      },
      onPanResponderRelease: (_evt, g) => {
        if (axisRef.current === 'h' && canSwipeRef.current) {
          const base = openRef.current ? -REVEAL_WIDTH : 0;
          const next = base + g.dx;
          snapRef.current(next < -REVEAL_WIDTH / 2);
        } else if (axisRef.current === 'v') {
          onReleaseRef.current();
        }
        axisRef.current = null;
      },
      onPanResponderTerminate: () => {
        if (axisRef.current === 'v') onReleaseRef.current();
        else if (axisRef.current === 'h') snapRef.current(openRef.current);
        axisRef.current = null;
      },
    }),
  ).current;

  return (
    <View
      style={active && { zIndex: 10, elevation: 6 }}
      onLayout={(e) => onLayoutHeight?.(e.nativeEvent.layout.height)}
    >
      {/* Hide delete strip while vertically dragging — otherwise red full-width
          bar stays in the original slot while the row floats (screenshot bug). */}
      {canSwipe && !active ? (
        <View style={styles.deleteBg}>
          <Animated.View
            style={{ opacity: translateX.interpolate({
              inputRange: [-REVEAL_WIDTH, -8, 0],
              outputRange: [1, 0, 0],
            }) }}
          >
            <Pressable
              onPress={() => {
                lightTap();
                snap(false);
                onDelete?.(item.id);
              }}
              hitSlop={8}
              accessibilityRole="button"
              style={styles.deleteHit}
            >
              <Ionicons name="trash" size={20} color="#FFFFFF" />
            </Pressable>
          </Animated.View>
        </View>
      ) : null}
      <Animated.View
        style={[
          styles.row,
          isAccommodation && styles.rowAccommodation,
          stayHighlight && styles.rowStayMatch,
          active && styles.rowActive,
          {
            transform: [
              { translateX: canSwipe ? translateX : 0 },
              { translateY: active ? pan : 0 },
            ],
          },
        ]}
        {...(canReorder || canSwipe ? responder.panHandlers : {})}
      >
        {showSelect ? (
          <Pressable
            onPress={onSelectAsStay}
            accessibilityRole="radio"
            accessibilityState={{ selected: !!selectSelected }}
            style={styles.selectRadio}
            hitSlop={8}
          >
            <Ionicons
              name={selectSelected ? 'checkmark-circle' : 'ellipse-outline'}
              size={20}
              color={dayColor}
            />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => onEmojiPress?.(item.id)}
          disabled={!onEmojiPress}
          accessibilityRole={onEmojiPress ? 'button' : undefined}
          accessibilityLabel={onEmojiPress ? 'dest emoji' : undefined}
          style={[
            styles.emojiBadge,
            // Stay cards: muted bed badge (not high-sat day red).
            { backgroundColor: isAccommodation ? STAY_BADGE_BG : dayColor },
          ]}
        >
          <Text style={styles.emojiBadgeGlyph}>
            {isAccommodation
              ? STAY_MARKER_EMOJI
              : destinationEmojiDisplay(item.emoji, DESTINATION_EMOJI_FALLBACK)}
          </Text>
        </Pressable>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {item.title}
          </Text>
          {item.address ? (
            <Text style={styles.rowAddress} numberOfLines={1}>
              {item.address}
            </Text>
          ) : null}
        </View>
        {boundaryLocked && onDelete ? (
          <Pressable
            onPress={() => onDelete(item.id)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="delete"
            style={styles.inlineTrash}
          >
            <Ionicons name="trash-outline" size={20} color="#FF5A5F" />
          </Pressable>
        ) : canReorder ? (
          <Text style={styles.handle}>≡</Text>
        ) : null}
      </Animated.View>
    </View>
  );
});

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    topActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: spacing.sm,
      marginBottom: spacing.sm,
      flexWrap: 'wrap',
    },
    dayBlock: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    dayBlockSpaced: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    dayActions: {
      gap: 8,
      marginTop: spacing.xs,
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    dashedBtn: {
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.accent,
      borderRadius: radius.md,
      paddingVertical: 10,
      alignItems: 'center',
    },
    dashedBtnText: { fontSize: 13, fontWeight: '600' },
    headerSetStayBtn: {
      borderWidth: 1.5,
      borderColor: colors.accent,
      borderRadius: radius.md,
      paddingHorizontal: 14,
      paddingVertical: 8,
      minHeight: 34,
      maxWidth: 200,
      justifyContent: 'center',
    },
    headerSetStayText: { fontSize: 14, fontWeight: '700' },
    dropLine: {
      height: 3,
      borderRadius: 2,
      marginVertical: 2,
      marginHorizontal: spacing.sm,
      opacity: 0.9,
    },
    stayBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: 'rgba(255,255,255,0.12)',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 10,
      flexShrink: 1,
      maxWidth: '70%',
    },
    stayBadgeText: { color: '#fff', fontSize: 12, flexShrink: 1 },
    removeStayText: { color: colors.accent, fontSize: 12, fontWeight: '600' },
    /** Accommodation card row: very soft low-sat wash (not a match highlight). */
    rowAccommodation: { backgroundColor: 'rgba(100, 90, 86, 0.10)' },
    /** Name+coords match the day's daily stay — muted low sat/brightness tint. */
    rowStayMatch: { backgroundColor: 'rgba(100, 90, 86, 0.16)' },
    // Stay cards share left alignment with gathering-point rows.
    rowTitleStay: { textAlign: 'left' },
    selectRadio: { marginRight: 8 },
    favRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
    },
    favRowMain: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    favDeleteBtn: {
      paddingHorizontal: 6,
      paddingVertical: 4,
    },
    favTitle: { color: colors.textPrimary, fontSize: 15, flex: 1 },
    modalTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: spacing.sm,
      gap: 8,
    },
    modalTitleGrow: { flex: 1, marginBottom: 0 },
    modalTitleCancel: { flexShrink: 0 },
    hint: {
      color: colors.textSecondary,
      fontSize: 12,
      marginBottom: spacing.sm,
    },
    empty: {
      color: colors.textSecondary,
      fontSize: 14,
      paddingVertical: spacing.md,
    },
    list: {
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: 'hidden',
    },
    headerRow: {
      minHeight: ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      backgroundColor: colors.glass,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerRowCompact: {
      minHeight: 44,
      borderBottomWidth: 0,
    },
    headerRowInner: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingRight: 4,
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 1,
      gap: 6,
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexShrink: 0,
    },
    headerStayRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingBottom: 10,
      paddingTop: 2,
      backgroundColor: colors.glass,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      gap: 8,
    },
    headerTitle: {
      color: colors.textPrimary,
      fontSize: 15,
      fontWeight: '700',
    },
    headerDate: {
      color: colors.textSecondary,
      fontSize: 14,
    },
    inlineTrash: {
      paddingHorizontal: spacing.xs,
      paddingVertical: 4,
    },
    row: {
      height: ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    rowActive: {
      backgroundColor: colors.glass,
      borderRadius: radius.md,
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
    },
    rowIndex: {
      color: colors.accent,
      fontSize: 15,
      fontWeight: '700',
      width: 20,
      textAlign: 'center',
    },
    rowBody: { flex: 1 },
    rowTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
    rowAddress: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
    emojiBadge: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 8,
    },
    emojiBadgeGlyph: {
      fontSize: 16,
    },
    emojiSheetOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 20,
    },
    emojiSheetCard: {
      width: '100%',
      maxWidth: 360,
      borderRadius: 28,
      paddingTop: 22,
      paddingBottom: 18,
      paddingHorizontal: 16,
      backgroundColor: '#1A1A22',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.1)',
    },
    emojiSheetTitle: {
      color: '#fff',
      fontSize: 18,
      fontWeight: '700',
      textAlign: 'center',
      marginBottom: 4,
    },
    emojiSheetHint: {
      color: 'rgba(255,255,255,0.45)',
      fontSize: 13,
      textAlign: 'center',
      marginBottom: 16,
    },
    emojiPinPreviewWrap: {
      alignItems: 'center',
      marginBottom: 18,
      minHeight: 88,
      justifyContent: 'center',
    },
    emojiPinPreview: {
      alignItems: 'center',
    },
    emojiPinHead: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: 'rgba(255,255,255,0.08)',
      borderWidth: 2,
      borderColor: 'rgba(255,255,255,0.18)',
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.35,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
    },
    emojiPinGlyph: {
      fontSize: 30,
    },
    emojiPinStem: {
      width: 3,
      height: 14,
      backgroundColor: 'rgba(255,255,255,0.35)',
      marginTop: -1,
      borderRadius: 2,
    },
    emojiPinDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: 'rgba(255,255,255,0.45)',
      marginTop: 2,
    },
    emojiCategoryRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: 6,
      marginBottom: 14,
    },
    emojiCategoryTab: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.12)',
      backgroundColor: 'rgba(255,255,255,0.04)',
    },
    emojiCategoryTabText: {
      color: 'rgba(255,255,255,0.55)',
      fontSize: 12,
      fontWeight: '600',
    },
    emojiPresetGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: 10,
      paddingHorizontal: 4,
      marginBottom: spacing.md,
      minHeight: 120,
    },
    emojiPresetCell: {
      width: 52,
      height: 52,
      borderRadius: 14,
      borderWidth: 2,
      borderColor: 'rgba(255,255,255,0.12)',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.06)',
    },
    emojiPresetGlyph: {
      fontSize: 26,
    },
    emojiSheetActions: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 4,
    },
    emojiSheetCancel: {
      flex: 1,
      height: 46,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.08)',
    },
    emojiSheetCancelText: {
      color: 'rgba(255,255,255,0.75)',
      fontSize: 16,
      fontWeight: '600',
    },
    emojiSheetConfirm: {
      flex: 1,
      height: 46,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emojiSheetConfirmText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '700',
    },
    emojiError: {
      color: colors.danger,
      fontSize: 13,
      marginBottom: spacing.sm,
      textAlign: 'center',
    },
    handle: { color: colors.textSecondary, fontSize: 22, paddingHorizontal: spacing.xs },
    deleteBg: {
      ...StyleSheet.absoluteFill,
      backgroundColor: colors.danger,
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    deleteHit: {
      width: REVEAL_WIDTH,
      height: ROW_HEIGHT,
      alignItems: 'center',
      justifyContent: 'center',
    },
    setDaysBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      paddingHorizontal: 12,
      backgroundColor: colors.glass,
      borderRadius: 16,
    },
    setDaysText: {
      color: colors.accent,
      fontWeight: '600',
      fontSize: 13,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    modalCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.xl,
      width: '80%',
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: 'bold',
      color: colors.textPrimary,
      marginBottom: spacing.lg,
    },
    modalRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.lg,
    },
        modalLabel: {
          fontSize: 16,
          color: colors.textPrimary,
        },
        datePickerButton: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.xs,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs,
          borderRadius: radius.md,
          backgroundColor: colors.glass,
        },
        datePickerText: {
          color: colors.textPrimary,
          fontSize: 15,
        },
    daysControls: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.glass,
      borderRadius: radius.md,
      overflow: 'hidden',
    },
    daysBtn: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      backgroundColor: colors.border,
    },
    daysBtnText: {
      fontSize: 18,
      fontWeight: 'bold',
      color: colors.textPrimary,
    },
    daysValue: {
      fontSize: 16,
      fontWeight: 'bold',
      color: colors.textPrimary,
      paddingHorizontal: 16,
    },
    modalActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginTop: spacing.md,
    },
    modalActionBtn: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      marginLeft: spacing.sm,
    },
    modalActionText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    colorDot: {
      width: 16,
      height: 16,
      borderRadius: 8,
      marginRight: 8,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.2)',
    },
    colorPickerContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 16,
      justifyContent: 'center',
      marginBottom: spacing.md,
    },
    colorPickerDot: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 2,
      borderColor: 'rgba(255,255,255,0.2)',
    }
  });
