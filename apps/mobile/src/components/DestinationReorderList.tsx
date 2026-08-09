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
import { dateForTripDay, localDayKey, resolveVisibleStartDay } from '../utils/tripDay';
import { clampDateNotBeforeToday, startOfTodayLocal } from '../utils/meetTime';
import {
  accommodationBoundaryLocks,
  dayCollapseStorageKey,
  type AccommodationListItem,
} from '../utils/accommodationSemantics';
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
import { getColorForDay } from '../utils/destinationMarkerChrome';

const ROW_HEIGHT = 56;
const REVEAL_WIDTH = 76;

export interface DailyAccommodationView {
  stayDate: string;
  title: string;
  id: string;
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
  onReorder: (updates: { id: string; position: number; day: number }[]) => void;
  onDelete?: (id: string) => void;
  /** Per-stop emoji (+ optional markerColor). Day color is via day-header picker. */
  onUpdateEmojiColor?: (
    id: string,
    next: { emoji: string | null; markerColor?: string | null },
  ) => void | Promise<void>;
  onSync?: () => Promise<void>;
  colors: Palette;
  emptyLabel: string;
  dragHint?: string;
  onDragActiveChange?: (active: boolean) => void;
  /** Daily accommodation by calendar date (YYYY-MM-DD). */
  dailyByDate?: Record<string, DailyAccommodationView | undefined>;
  /** Leader: clear daily accommodation for a date (does not delete cards). */
  onClearDailyAccommodation?: (stayDate: string, day: number) => void;
  /** Leader: enter set-from-stop mode for a day. */
  onSetDailyFromDestination?: (destinationId: string, day: number) => void;
  /** Quick-add mid accommodation card for a day. */
  onQuickAddAccommodation?: (day: number) => void;
  /** Team auto-add switch (default true). */
  accommodationAutoAdd?: boolean;
  onToggleAutoAdd?: (enabled: boolean) => void;
  /** Account favorites for picker. */
  favoritePlaces?: FavoritePlaceView[];
  onPickFavorite?: (favorite: FavoritePlaceView, day: number) => void;
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
  colors,
  emptyLabel,
  dragHint,
  onDragActiveChange,
  dailyByDate,
  onClearDailyAccommodation,
  onSetDailyFromDestination,
  onQuickAddAccommodation,
  accommodationAutoAdd = true,
  onToggleAutoAdd,
  favoritePlaces,
  onPickFavorite,
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
  const pan = useRef(new Animated.Value(0)).current;

  const [showSettings, setShowSettings] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [editDays, setEditDays] = useState(tripDays ?? 1);
  const [editDate, setEditDate] = useState(departureDate ? new Date(departureDate) : new Date());
  /** Day number currently in "set stop as accommodation" radio mode. */
  const [setStayModeDay, setSetStayModeDay] = useState<number | null>(null);
  const [collapsedDays, setCollapsedDays] = useState<Record<number, boolean>>({});
  const [favoritesOpen, setFavoritesOpen] = useState(false);

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
      // Past trip days are hidden from the active itinerary; start headers at today.
      const startDay = Math.min(
        days,
        Math.max(1, resolveVisibleStartDay(departureDate, tripDays)),
      );
      // If the whole trip is already past, show no day headers (list may be empty).
      const gatePastTrip = resolveVisibleStartDay(departureDate, tripDays) > days;

      const sortedDests = [...destinations].sort((a, b) => {
        const dayA = a.day || 1;
        const dayB = b.day || 1;
        if (dayA !== dayB) return dayA - dayB;
        return a.order - b.order;
      });

      if (!gatePastTrip) {
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
      }
      const dangling = sortedDests.filter(
        (dest) => (dest.day || 1) > days || (dest.day || 1) < startDay,
      );
      // Only surface dangling future-over days; past days stay out of the active list.
      for (const dest of dangling.filter((d) => (d.day || 1) > days)) {
        nextOrder.push({ type: 'dest', item: dest, id: dest.id });
      }

      setOrder(nextOrder);
    }
  }, [destinations, tripDays, departureDate, t]);

  const dragBoundsRef = useRef<{ min: number; max: number } | null>(null);

  const handleGrant = useCallback(
    (id: string) => {
      draggingRef.current = true;
      onDragActiveChange?.(true);
      setActiveId(id);
      const startIdx = orderRef.current.findIndex((d) => d.id === id);
      startIndexRef.current = startIdx;

      if (startIdx !== -1 && orderRef.current[startIdx].type === 'header') {
         let min = 0;
         let max = orderRef.current.length - 1;
         for (let i = startIdx - 1; i >= 0; i--) {
            if (orderRef.current[i].type === 'header') {
               min = i + 1; break;
            }
         }
         for (let i = startIdx + 1; i < orderRef.current.length; i++) {
            if (orderRef.current[i].type === 'header') {
               max = i - 1; break;
            }
         }
         dragBoundsRef.current = { min, max };
      } else {
         dragBoundsRef.current = null;
      }

      pan.setValue(0);
    },
    [pan, onDragActiveChange],
  );

  const handleMove = useCallback(
    (id: string, dy: number) => {
      const startIndex = startIndexRef.current;
      const currentIndex = orderRef.current.findIndex((d) => d.id === id);
      const len = orderRef.current.length;
      let target = Math.round(startIndex + dy / ROW_HEIGHT);
      if (dragBoundsRef.current) {
         target = Math.max(dragBoundsRef.current.min, Math.min(target, dragBoundsRef.current.max));
      } else {
         target = Math.max(0, Math.min(target, len - 1));
      }

      if (target !== currentIndex && currentIndex !== -1) {
        const next = orderRef.current.slice();
        const [moved] = next.splice(currentIndex, 1);
        next.splice(target, 0, moved);
        orderRef.current = next;
        setOrder(next); // This triggers a re-render. With memo, it's fast.
      }

      const idxNow = orderRef.current.findIndex((d) => d.id === id);
      pan.setValue(dy + (startIndex - idxNow) * ROW_HEIGHT);
    },
    [pan],
  );

  const handleRelease = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    onDragActiveChange?.(false);

    setActiveId(null);
    pan.setValue(0);

    const updates: { id: string; position: number; day: number }[] = [];
    let currentDay = 1;
    let position = 0;
    for (const item of orderRef.current) {
      if (item.type === 'header') {
        currentDay = item.day;
      } else {
        updates.push({ id: item.id, position, day: currentDay });
        position++;
      }
    }

    let changed = false;
    const openIndexById = new Map(
      [...destinations]
        .sort((a, b) => a.order - b.order)
        .map((destination, index) => [destination.id, index]),
    );
    for (const u of updates) {
       const orig = destinations.find(d => d.id === u.id);
       if (!orig || openIndexById.get(u.id) !== u.position || (orig.day || 1) !== u.day) {
           changed = true;
           break;
       }
    }

    if (changed) {
      onReorder(updates);
    }
  }, [pan, onReorder, destinations, onDragActiveChange]);

  const handlersRef = useRef({ handleGrant, handleMove, handleRelease });
  handlersRef.current = { handleGrant, handleMove, handleRelease };
  const onGrant = useCallback((id: string) => handlersRef.current.handleGrant(id), []);
  const onMove = useCallback(
    (id: string, dy: number) => handlersRef.current.handleMove(id, dy),
    [],
  );
  const onRelease = useCallback(() => handlersRef.current.handleRelease(), []);

  return (
    <View>
      {(canReorder || onSync) && (
        <View style={styles.topActions}>
          {canReorder && <Pressable style={styles.setDaysBtn} onPress={() => {
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
              onPress={() => setFavoritesOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t('stay.favorites')}
            >
              <Ionicons name="star-outline" size={16} color={colors.accent} style={{ marginRight: 6 }} />
              <Text style={styles.setDaysText}>{t('stay.favorites')}</Text>
            </Pressable>
          ) : null}
          {onSync && <Pressable
            style={[styles.setDaysBtn, syncing && { opacity: 0.5 }]}
            onPress={() => void handleSync()}
            disabled={syncing}
            accessibilityRole="button"
            accessibilityLabel={t('map.syncDbA11y')}
          >
            <Ionicons name="refresh-outline" size={16} color={colors.accent} style={{ marginRight: 6 }} />
            <Text style={styles.setDaysText}>
              {syncing ? t('map.syncDbSyncing') : t('map.syncDb')}
            </Text>
          </Pressable>}
        </View>
      )}

      {canReorder && onToggleAutoAdd ? (
        <Pressable
          style={styles.autoAddRow}
          onPress={() => onToggleAutoAdd(!accommodationAutoAdd)}
          accessibilityRole="switch"
          accessibilityState={{ checked: accommodationAutoAdd }}
          accessibilityLabel={t('stay.autoAdd')}
        >
          <Text style={styles.autoAddLabel}>{t('stay.autoAdd')}</Text>
          <View style={[styles.autoAddSwitch, accommodationAutoAdd && styles.autoAddSwitchOn]}>
            <View style={[styles.autoAddKnob, accommodationAutoAdd && styles.autoAddKnobOn]} />
          </View>
        </Pressable>
      ) : null}

      {order.length === 0 ? (
         <Text style={styles.empty}>{emptyLabel}</Text>
      ) : (
        <View style={styles.list}>
          {order.map((item) => {
            if (item.type === 'header') {
               const bgColor = dayColors[item.day] || DAY_COLORS[(item.day - 1) % DAY_COLORS.length];
               const stayDate = stayDateForDay(item.day);
               const daily = stayDate && dailyByDate ? dailyByDate[stayDate] : undefined;
               const collapsed = Boolean(collapsedDays[item.day]);
               return (
                 <View key={item.id}>
                   <HeaderRow
                     item={item}
                     active={activeId === item.id}
                     canReorder={canReorder}
                     pan={pan}
                     styles={styles}
                     bgColor={bgColor}
                     canEditColors={canReorder}
                     onColorPress={onHeaderColorPress}
                     onGrant={onGrant}
                     onMove={onMove}
                     onRelease={onRelease}
                     dailyTitle={daily?.title}
                     onRemoveDaily={
                       canReorder && daily && onClearDailyAccommodation && stayDate
                         ? () => onClearDailyAccommodation(stayDate, item.day)
                         : undefined
                     }
                     collapsed={collapsed}
                     onToggleCollapse={() => void toggleDayCollapsed(item.day)}
                   />
                   {!collapsed && canReorder ? (
                     <View style={styles.dayActions}>
                       {onQuickAddAccommodation ? (
                         <Pressable
                           style={styles.dashedBtn}
                           onPress={() => onQuickAddAccommodation(item.day)}
                           accessibilityRole="button"
                           accessibilityLabel={t('stay.quickAdd')}
                         >
                           <Text style={[styles.dashedBtnText, { color: colors.accent }]}>
                             {t('stay.quickAdd')}
                           </Text>
                         </Pressable>
                       ) : null}
                       {onSetDailyFromDestination ? (
                         <Pressable
                           style={styles.dashedBtn}
                           onPress={() =>
                             setSetStayModeDay((d) => (d === item.day ? null : item.day))
                           }
                           accessibilityRole="button"
                           accessibilityLabel={
                             setStayModeDay === item.day
                               ? t('stay.finishSet')
                               : t('stay.setFromStop')
                           }
                         >
                           <Text style={[styles.dashedBtnText, { color: colors.accent }]}>
                             {setStayModeDay === item.day
                               ? t('stay.finishSet')
                               : t('stay.setFromStop')}
                           </Text>
                         </Pressable>
                       ) : null}
                     </View>
                   ) : null}
                 </View>
               );
            }
            if (collapsedDays[item.item.day || 1]) return null;
            const dayColor = getColorForDay(item.item.day, dayColors);
            const dayItems: AccommodationListItem[] = destinations
              .filter((d) => (d.day || 1) === (item.item.day || 1))
              .map((d) => ({
                id: d.id,
                kind: d.kind === 'accommodation' ? 'accommodation' : 'stop',
                order: d.order,
                day: d.day || 1,
                title: d.title,
              }));
            const { lockedIds } = accommodationBoundaryLocks(dayItems);
            const locked = item.item.kind === 'accommodation' && lockedIds.has(item.item.id);
            const inSetMode = setStayModeDay === (item.item.day || 1);
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
                isAccommodation={item.item.kind === 'accommodation'}
                showSelect={inSetMode && item.item.kind !== 'accommodation'}
                onSelectAsStay={
                  inSetMode && onSetDailyFromDestination
                    ? () => {
                        onSetDailyFromDestination(item.item.id, item.item.day || 1);
                        setSetStayModeDay(null);
                      }
                    : undefined
                }
                onEmojiPress={
                  canReorder && onUpdateEmojiColor && item.item.kind !== 'accommodation'
                    ? (id) => {
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
          })}
        </View>
      )}

      <Modal visible={favoritesOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('stay.favorites')}</Text>
            {(favoritePlaces ?? []).map((fav) => (
              <Pressable
                key={fav.id}
                style={styles.favRow}
                onPress={() => {
                  // Default: add to first visible day; parent may open date picker.
                  const day = Math.max(1, resolveVisibleStartDay(departureDate, tripDays));
                  onPickFavorite?.(fav, day);
                  setFavoritesOpen(false);
                }}
                accessibilityRole="button"
              >
                <Ionicons name="star" size={16} color={colors.accent} />
                <Text style={styles.favTitle} numberOfLines={1}>{fav.title}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => setFavoritesOpen(false)} style={styles.modalActionBtn}>
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
  active,
  canReorder,
  pan,
  styles,
  bgColor,
  canEditColors,
  onColorPress,
  onGrant,
  onMove,
  onRelease,
  dailyTitle,
  onRemoveDaily,
  collapsed,
  onToggleCollapse,
}: {
  item: any;
  active: boolean;
  canReorder: boolean;
  pan: Animated.Value;
  styles: any;
  bgColor: string;
  canEditColors: boolean;
  onColorPress: (day: number) => void;
  onGrant: (id: string) => void;
  onMove: (id: string, dy: number) => void;
  onRelease: () => void;
  dailyTitle?: string;
  onRemoveDaily?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { t } = useTranslation();
  const axisRef = useRef<null | 'v'>(null);
  const reorderable = canReorder && item.day > 1;
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt) => {
        if (!reorderable) return false;
        const screenWidth = Dimensions.get('window').width;
        if (evt.nativeEvent.pageX > screenWidth - 60) return true;
        return false;
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        const screenWidth = Dimensions.get('window').width;
        if (reorderable && evt.nativeEvent.pageX > screenWidth - 60) {
           axisRef.current = 'v';
           onGrant(item.id);
        }
      },
      onPanResponderMove: (_evt, g) => {
        if (axisRef.current === 'v') {
          onMove(item.id, g.dy);
        }
      },
      onPanResponderRelease: () => {
        if (axisRef.current === 'v') onRelease();
        axisRef.current = null;
      },
      onPanResponderTerminate: () => {
        if (axisRef.current === 'v') onRelease();
        axisRef.current = null;
      },
    })
  ).current;

  return (
    <View style={active && { zIndex: 10, elevation: 6 }}>
      <Animated.View
        style={[
          styles.headerRow,
          active && styles.rowActive,
          {
            transform: [{ translateY: active ? pan : 0 }],
          },
        ]}
        {...(reorderable ? responder.panHandlers : {})}
      >
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
            <Pressable
              onPress={() => onColorPress(item.day)}
              disabled={!canEditColors}
              accessibilityRole={canEditColors ? 'button' : undefined}
              accessibilityLabel={canEditColors ? 'change day color' : undefined}
              style={[styles.colorDot, { backgroundColor: bgColor }]}
            />
            <Text style={styles.headerTitle}>{item.title}</Text>
            {dailyTitle ? (
              <View style={styles.stayBadge}>
                <Ionicons name="bed-outline" size={12} color="#fff" />
                <Text style={styles.stayBadgeText} numberOfLines={1}>{dailyTitle}</Text>
              </View>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {onRemoveDaily ? (
              <Pressable onPress={onRemoveDaily} accessibilityRole="button" accessibilityLabel={t('stay.remove')}>
                <Text style={styles.removeStayText}>{t('stay.remove')}</Text>
              </Pressable>
            ) : null}
            <Text style={styles.headerDate}>{item.dateStr}</Text>
            {onToggleCollapse ? (
              <Pressable onPress={onToggleCollapse} accessibilityRole="button" hitSlop={8}>
                <Ionicons name={collapsed ? 'chevron-down' : 'chevron-up'} size={16} color="#999" />
              </Pressable>
            ) : null}
          </View>
        </View>
        {reorderable ? <Text style={styles.handle}>≡</Text> : null}
      </Animated.View>
    </View>
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
  showSelect,
  onSelectAsStay,
}: {
  item: Destination;
  active: boolean;
  canReorder: boolean;
  pan: Animated.Value;
  styles: ReturnType<typeof makeStyles>;
  dayColor: string;
  onGrant: (id: string) => void;
  onMove: (id: string, dy: number) => void;
  onRelease: () => void;
  onDelete?: (id: string) => void;
  onEmojiPress?: (id: string) => void;
  isAccommodation?: boolean;
  showSelect?: boolean;
  onSelectAsStay?: () => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const axisRef = useRef<null | 'h' | 'v'>(null);
  const openRef = useRef(false);
  const canSwipe = !!onDelete;

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

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt) => {
        if (!canReorder) return false;
        const screenWidth = Dimensions.get('window').width;
        if (evt.nativeEvent.pageX > screenWidth - 60) return true;
        return false;
      },
      onMoveShouldSetPanResponder: (_evt, g) =>
        canSwipe && Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        axisRef.current = null;
        const screenWidth = Dimensions.get('window').width;
        if (canReorder && evt.nativeEvent.pageX > screenWidth - 60) {
           axisRef.current = 'v';
           onGrant(item.id);
        }
      },
      onPanResponderMove: (_evt, g) => {
        if (axisRef.current === null && canSwipe && Math.abs(g.dx) > 6) {
          axisRef.current = 'h';
        }
        if (axisRef.current === 'h' && canSwipe) {
          const base = openRef.current ? -REVEAL_WIDTH : 0;
          const next = Math.max(-REVEAL_WIDTH, Math.min(0, base + g.dx));
          translateX.setValue(next);
        } else if (axisRef.current === 'v') {
          onMove(item.id, g.dy);
        }
      },
      onPanResponderRelease: (_evt, g) => {
        if (axisRef.current === 'h' && canSwipe) {
          const base = openRef.current ? -REVEAL_WIDTH : 0;
          const next = base + g.dx;
          snap(next < -REVEAL_WIDTH / 2);
        } else if (axisRef.current === 'v') {
          onRelease();
        }
        axisRef.current = null;
      },
      onPanResponderTerminate: () => {
        if (axisRef.current === 'v') onRelease();
        else if (axisRef.current === 'h') snap(openRef.current);
        axisRef.current = null;
      },
    }),
  ).current;

  return (
    <View style={active && { zIndex: 10, elevation: 6 }}>
      {canSwipe ? (
        <View style={styles.deleteBg}>
          <Animated.View
            style={{ opacity: translateX.interpolate({
              inputRange: [-REVEAL_WIDTH, -8, 0],
              outputRange: [1, 0, 0],
            }) }}
          >
            <Pressable
              onPress={() => {
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
            style={styles.selectRadio}
            hitSlop={8}
          >
            <Ionicons name="ellipse-outline" size={20} color={dayColor} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => onEmojiPress?.(item.id)}
          disabled={!onEmojiPress}
          accessibilityRole={onEmojiPress ? 'button' : undefined}
          accessibilityLabel={onEmojiPress ? 'dest emoji' : undefined}
          style={[
            styles.emojiBadge,
            { backgroundColor: isAccommodation ? '#555' : dayColor },
          ]}
        >
          <Text style={styles.emojiBadgeGlyph}>
            {isAccommodation
              ? '🛏️'
              : destinationEmojiDisplay(item.emoji, DESTINATION_EMOJI_FALLBACK)}
          </Text>
        </Pressable>
        <View style={styles.rowBody}>
          <Text style={[styles.rowTitle, isAccommodation && styles.rowTitleStay]} numberOfLines={1}>
            {item.title}
          </Text>
          {item.address ? (
            <Text style={styles.rowAddress} numberOfLines={1}>
              {item.address}
            </Text>
          ) : null}
        </View>
        {canReorder ? <Text style={styles.handle}>≡</Text> : null}
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
    autoAddRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.sm,
      paddingVertical: 6,
    },
    autoAddLabel: { color: colors.textSecondary, fontSize: 13, flex: 1 },
    autoAddSwitch: {
      width: 42,
      height: 24,
      borderRadius: 12,
      backgroundColor: 'rgba(255,255,255,0.15)',
      padding: 2,
      justifyContent: 'center',
    },
    autoAddSwitchOn: { backgroundColor: colors.accent },
    autoAddKnob: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: '#fff',
    },
    autoAddKnobOn: { alignSelf: 'flex-end' },
    dayActions: { gap: 8, marginBottom: spacing.sm, paddingHorizontal: 4 },
    dashedBtn: {
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.accent,
      borderRadius: radius.md,
      paddingVertical: 10,
      alignItems: 'center',
    },
    dashedBtnText: { fontSize: 13, fontWeight: '600' },
    stayBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: 'rgba(255,255,255,0.12)',
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 10,
      marginLeft: 8,
      maxWidth: 120,
    },
    stayBadgeText: { color: '#fff', fontSize: 11, flexShrink: 1 },
    removeStayText: { color: colors.accent, fontSize: 12, fontWeight: '600' },
    rowAccommodation: { backgroundColor: 'rgba(40,40,44,0.95)' },
    rowTitleStay: { textAlign: 'right' },
    selectRadio: { marginRight: 8 },
    favRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
    },
    favTitle: { color: colors.textPrimary, fontSize: 15, flex: 1 },
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
      height: ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      backgroundColor: colors.glass,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
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
