import { APP_TEXT_SIZE } from '../../../theme/typeScale';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Modal,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { AppText as Text } from '../../../components/AppText';
import Pressable from '../../../components/MotionPressable';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import type { SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SwiftUIGlassSurface from '../../../components/SwiftUIGlassSurface';
import SheetHeaderAction from '../../../components/SheetHeaderAction';
import { MAP_FLOATING_EDGE_INSET, MAP_SHEET_CORNER_RADIUS, MAP_SHEET_ACTION_HIT_SIZE, SHEET_CORNER_ACTION_INSET } from '../../../components/mapSheetChrome';
import { useMountEffect } from '../../../hooks/useMountEffect';
import { useTranslation } from '../../../i18n';
import type { DailyAccommodation, Destination } from '../../../types';
import { destinationEmojiDisplay } from '../../../utils/destinationEmojiColor';
import { lightTap } from '../../../utils/haptics';
import { localDayKey, openDestinationsForReorder, parseDateOnlyLocal } from '../../../utils/tripDay';
import { d6DayRows, d6DropLabel, d6Reorder, d6TripDays, type D6RouteRow as RouteRow } from '../d6Itinerary';
import type { ReorderUpdate } from '../itineraryReorder';
import { D6RouteDates } from './D6RouteDates';
import { D6RouteRow, D6RowFlash, type D6Point } from './D6RouteRow';

type Suggestion = { id: string; title: string; avatar?: string; avatarColor?: string };
export type D6RouteSelection = {
  count: number;
  canAct: boolean;
  onCancel: () => void;
  onPool: () => void;
  onDelete: () => void;
};

export interface D6RoutePaneProps {
  accent: string;
  displayFont?: string;
  destinations: readonly Destination[];
  dailyAccommodations: readonly DailyAccommodation[];
  departureDate?: string;
  tripDays?: number;
  selectedDay: number;
  onSelectDay: (day: number) => void;
  activeDestinationId?: string | null;
  canEdit: boolean;
  canEditDates?: boolean;
  dayColors: Readonly<Record<number, string>>;
  onDayColor: (day: number, color: string) => void;
  suggestions: readonly Suggestion[];
  onSuggestion: (id: string, approve: boolean, day: number) => void;
  onOpenStop: (destination: Destination) => void;
  onAdd: (day: number, kind: 'stop' | 'accommodation') => void;
  onCompleteEarly?: () => void;
  onManageArrivals?: () => void;
  onImport: () => void;
  onReorder: (updates: ReorderUpdate[]) => Promise<boolean>;
  onDelete: (ids: string[]) => Promise<boolean>;
  onTripDetails: (days: number, departureDate: string) => Promise<boolean>;
  onAccommodation: (accommodation: DailyAccommodation, action: 'delete' | 'pool') => Promise<boolean>;
  onSelectionChange?: (selection: D6RouteSelection | null) => void;
  legacyContent?: React.ReactNode;
  flashId?: string | null;
  poolFlashKey?: number;
  error?: string | null;
}

type Bounds = D6Point & { width: number; height: number };
type DragTarget =
  | { kind: 'day'; day: number }
  | { kind: 'row'; id: string; edge: 'above' | 'below' };

type DragSession = {
  row: RouteRow;
  point: D6Point;
  offset: D6Point;
  root: Bounds;
  source: Bounds;
  strip: Bounds;
  days: { day: number; bounds: Bounds }[];
  rows: { id: string; bounds: Bounds }[];
};

function measure(view: View | null | undefined): Promise<Bounds | null> {
  return new Promise((resolve) => {
    if (!view) { resolve(null); return; }
    view.measureInWindow((x, y, width, height) => resolve(width > 0 && height > 0
      ? { x, y, width, height } : null));
  });
}

function contains(bounds: Bounds, point: D6Point) {
  return point.x >= bounds.x && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y && point.y <= bounds.y + bounds.height;
}

function findTarget(session: DragSession, point: D6Point): DragTarget | null {
  if (contains(session.strip, point)) {
    const day = session.days.find((entry) => contains(entry.bounds, point));
    return day ? { kind: 'day', day: day.day } : null;
  }
  if (point.x < session.root.x || point.x > session.root.x + session.root.width) return null;
  const first = session.rows[0];
  const last = session.rows[session.rows.length - 1];
  if (!first || !last || point.y < Math.max(first.bounds.y - 16, session.strip.y + session.strip.height)
    || point.y > Math.min(last.bounds.y + last.bounds.height + 48, session.root.y + session.root.height)) return null;
  const row = session.rows.find((entry) => point.y < entry.bounds.y + entry.bounds.height / 2);
  return row ? { kind: 'row', id: row.id, edge: 'above' } : { kind: 'row', id: last.id, edge: 'below' };
}

const WEEKDAYS_ZH = ['日', '一', '二', '三', '四', '五', '六'];
const WEEKDAYS_EN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export function D6RoutePane({
  accent, displayFont, destinations, dailyAccommodations, departureDate, tripDays, selectedDay,
  onSelectDay, activeDestinationId, canEdit, canEditDates = canEdit, dayColors, onDayColor,
  suggestions, onSuggestion, onOpenStop, onAdd, onCompleteEarly, onManageArrivals, onImport, onReorder, onDelete, onTripDetails,
  onAccommodation, onSelectionChange, legacyContent, flashId, poolFlashKey, error,
}: D6RoutePaneProps) {
  const { language, t } = useTranslation();
  const chinese = language === 'zh';
  const weekdays = chinese ? WEEKDAYS_ZH : WEEKDAYS_EN;
  const [today] = useState(() => new Date());
  const departure = useMemo(() => parseDateOnlyLocal(departureDate) ?? today, [departureDate, today]);
  const outgoing = localDayKey(departure);
  const count = Math.max(1, Math.floor(tripDays ?? Math.max(1, ...destinations.map((destination) => destination.day ?? 0))));
  const days = useMemo(() => d6TripDays(departure, count, dayColors), [count, dayColors, departure]);
  const day = days[Math.max(0, Math.min(count - 1, selectedDay - 1))];
  const rows = useMemo(() => d6DayRows(destinations, day, dailyAccommodations), [dailyAccommodations, day, destinations]);
  const selectableRows = useMemo(() => rows.filter((row) => row.kind === 'destination' || canEditDates), [canEditDates, rows]);
  const pool = useMemo(() => openDestinationsForReorder(destinations).filter((destination) => destination.day == null), [destinations]);
  const completed = useMemo(() => destinations.filter((item) => item.closedAt && item.day === day.number)
    .sort((left, right) => left.order - right.order), [day.number, destinations]);
  const [popup, setPopup] = useState<'menu' | 'dates' | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [poolFold, setPoolFold] = useState<{ key: number | undefined; open: boolean; flash: string | null }>(() =>
    ({ key: poolFlashKey, open: !!poolFlashKey, flash: poolFlashKey ? pool.at(-1)?.id ?? null : null }));
  if (poolFold.key !== poolFlashKey) setPoolFold({ key: poolFlashKey, open: true, flash: pool.at(-1)?.id ?? null });
  const showPool = poolFold.open;
  const [showLegacy, setShowLegacy] = useState(false);
  const [flashed, setFlashed] = useState<string | null>(null);
  const [flashedDay, setFlashedDay] = useState<number | null>(null);
  const flashTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dayTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [removing, setRemoving] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [transparencyReduced, setTransparencyReduced] = useState(false);
  const [stripMore, setStripMore] = useState(false);
  const stripScroll = useRef<ScrollView | null>(null);
  const revealNewDay = useRef(false);
  const stripMetrics = useRef({ offset: 0, width: 0, content: 0 });
  const [drag, setDrag] = useState<{ session: DragSession; target: DragTarget | null } | null>(null);
  const dragSession = useRef<DragSession | null>(null);
  const dragGeneration = useRef(0);
  const latestPoint = useRef<D6Point | null>(null);
  const rootRef = useRef<View>(null);
  const stripRef = useRef<View>(null);
  const rowViews = useRef(new Map<string, View>());
  const dayViews = useRef(new Map<number, View>());
  const openSwipe = useRef<SwipeableMethods | null>(null);
  const insets = useSafeAreaInsets();

  const focusRow = useCallback((id: string) => {
    if (flashTimeout.current) clearTimeout(flashTimeout.current);
    setFlashed(id);
    flashTimeout.current = setTimeout(() => { setFlashed(null); }, 1500);
  }, []);

  useMountEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceTransparencyEnabled().then((value) => {
      if (active) setTransparencyReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setTransparencyReduced);
    return () => {
      active = false;
      subscription.remove();
      if (flashTimeout.current) clearTimeout(flashTimeout.current);
      if (dayTimeout.current) clearTimeout(dayTimeout.current);
    };
  });

  const updateStrip = useCallback((event?: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (event) {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      stripMetrics.current = { offset: contentOffset.x, width: layoutMeasurement.width, content: contentSize.width };
    }
    const { offset, width, content } = stripMetrics.current;
    setStripMore(width > 0 && content - width - offset > 4);
  }, []);

  function scrollToDay() {
    if (day.number > 1) {
      const { width, offset } = stripMetrics.current;
      const position = (day.number - 1) * 52;
      if (width > 0 && (position < offset || position + 52 > offset + width)) {
        stripScroll.current?.scrollTo({ x: Math.max(0, position - width / 2 + 26), animated: true });
      }
    }
  }

  const write = useCallback(async (action: () => Promise<boolean>) => {
    if (writing.current) return false;
    writing.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const saved = await action();
      if (!saved) setFailure(t('map.setFailedTitle'));
      return saved;
    } catch {
      setFailure(t('map.setFailedTitle'));
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }, [t]);

  const removeRows = useCallback(async (ids: readonly string[], action: 'delete' | 'pool') => {
    if (ids.length === 0) return;
    const targets = rows.filter((row) => ids.includes(row.id));
    if (action === 'pool' && targets.some((row) => row.destination?.id === activeDestinationId)) {
      setFailure(t('trip.endBeforePool'));
      return;
    }
    await write(async () => {
      openSwipe.current?.close();
      setRemoving(new Set(ids));
      await new Promise<void>((resolve) => { setTimeout(resolve, 220); });
      try {
        const destinationIds = targets.flatMap((row) => row.kind === 'destination' ? [row.id] : []);
        const stays = targets.flatMap((row) => row.kind === 'accommodation' ? [row.accommodation] : []);
        let saved = true;
        if (destinationIds.length > 0) {
          if (action === 'delete') saved = await onDelete(destinationIds);
          else {
            const updates = d6Reorder(destinations, { ids: destinationIds, day: null });
            if (updates.length) saved = await onReorder(updates);
          }
        }
        for (const stay of stays) {
          if (!saved) break;
          saved = await onAccommodation(stay, action);
        }
        if (saved) setSelection(null);
        return saved;
      } finally {
        setRemoving(new Set());
      }
    });
  }, [activeDestinationId, destinations, onAccommodation, onDelete, onReorder, rows, t, write]);

  const selectedIds = useMemo(() => selection
    ? selectableRows.filter((row) => selection.has(row.id)).map((row) => row.id)
    : [], [selectableRows, selection]);
  const selectionMode = canEdit && selection !== null;
  const selectionCount = selectedIds.length;

  function openRow(row: RouteRow) {
    if (selection && canEdit) {
      setSelection((current) => {
        const next = new Set(current);
        if (next.has(row.id)) next.delete(row.id);
        else next.add(row.id);
        return next;
      });
      return;
    }
    if (row.destination) onOpenStop(row.destination);
    else if (row.kind === 'accommodation') onOpenStop({
      id: row.accommodation.id,
      day: day.number,
      order: Number.MAX_SAFE_INTEGER,
      title: row.accommodation.title,
      address: row.accommodation.address,
      coordinates: row.accommodation.coordinates,
      kind: 'accommodation',
    });
  }

  function changeDay(next: number) {
    if (next === day.number) return;
    openSwipe.current?.close();
    setSelection((current) => current ? new Set() : null);
    setShowCompleted(false);
    onSelectDay(next);
  }

  function move(row: RouteRow, target: DragTarget) {
    if (target.kind === 'row' && target.id === row.id) return;
    const ordinary = rows.filter((item) => item.id !== row.id && item.kind === 'destination' && !item.isLegacyStay);
    const beforeId = target.kind === 'row'
      ? target.edge === 'above' ? target.id : ordinary[ordinary.findIndex((item) => item.id === target.id) + 1]?.id
      : undefined;
    const targetDay = target.kind === 'day' ? target.day : day.number;
    const updates = d6Reorder(destinations, { ids: [row.id], day: targetDay, beforeId });
    if (target.kind === 'day') {
      if (dayTimeout.current) clearTimeout(dayTimeout.current);
      setFlashedDay(target.day);
      dayTimeout.current = setTimeout(() => setFlashedDay(null), 650);
    }
    if (updates.length > 0) void write(() => onReorder(updates));
  }

  async function startDrag(row: RouteRow, point: D6Point) {
    if (writing.current) return;
    openSwipe.current?.close();
    const generation = ++dragGeneration.current;
    latestPoint.current = point;
    const candidates = rows.filter((item) => item.id !== row.id && item.kind === 'destination' && !item.isLegacyStay);
    const [root, source, strip, dayBounds, rowBounds] = await Promise.all([
      measure(rootRef.current), measure(rowViews.current.get(row.id)), measure(stripRef.current),
      Promise.all(days.map(async (item) => ({ day: item.number, bounds: await measure(dayViews.current.get(item.number)) }))),
      Promise.all(candidates.map(async (item) => ({ id: item.id, bounds: await measure(rowViews.current.get(item.id)) }))),
    ]);
    if (generation !== dragGeneration.current || !root || !source || !strip) return;
    const session: DragSession = {
      row,
      point: latestPoint.current ?? point,
      offset: { x: point.x - source.x, y: point.y - source.y },
      root,
      source,
      strip,
      days: dayBounds.flatMap((entry) => entry.bounds ? [{ day: entry.day, bounds: entry.bounds }] : []),
      rows: rowBounds.flatMap((entry) => entry.bounds ? [{ id: entry.id, bounds: entry.bounds }] : []),
    };
    dragSession.current = session;
    setDrag({ session, target: findTarget(session, session.point) });
  }

  function dragMove(point: D6Point) {
    latestPoint.current = point;
    if (!dragSession.current) return;
    const session = { ...dragSession.current, point };
    dragSession.current = session;
    setDrag({ session, target: findTarget(session, point) });
  }

  function endDrag(point?: D6Point) {
    const session = dragSession.current;
    dragSession.current = null;
    ++dragGeneration.current;
    latestPoint.current = null;
    setDrag(null);
    if (!point || !session) return;
    const target = findTarget(session, point);
    if (target) move(session.row, target);
  }

  function changeRange(nextCount: number, nextDeparture: string) {
    return write(async () => {
      const saved = await onTripDetails(nextCount, nextDeparture);
      if (saved && selectedDay > nextCount) onSelectDay(nextCount);
      return saved;
    });
  }

  const ordinaryRows = rows.filter(row => row.kind === 'destination' && !row.isLegacyStay);
  const accommodationRows = rows.filter(row => row.kind === 'accommodation' || row.isLegacyStay);
  const selectedAll = selectableRows.length > 0 && selectionCount === selectableRows.length;
  const moreActions = canEdit || canEditDates || !!onManageArrivals || !!legacyContent;
  const hasStay = rows.some((row) => row.kind === 'accommodation' || row.isLegacyStay);
  const showStaySlot = canEdit && canEditDates && !selectionMode && day.number < count && !hasStay;
  const status = error ?? failure;

  const renderRouteRow = (row: RouteRow, index: number) => {
    const canDrag = canEdit && !selectionMode && !busy && row.kind === 'destination' && !row.isLegacyStay;
    const editable = canEdit && (row.kind === 'destination' || canEditDates);
    const canSwipe = editable && !selectionMode && (!busy || removing.has(row.id));
    return <D6RouteRow
      key={row.id}
      row={row}
      color={day.color}
      accent={accent}
      active={!!activeDestinationId && row.destination?.id === activeDestinationId}
      connectAbove={row.kind === 'destination' && !row.isLegacyStay && index > 0}
      connectBelow={row.kind === 'destination' && !row.isLegacyStay && index < ordinaryRows.length - 1}
      selected={selectionMode && editable ? selectedIds.includes(row.id) : undefined}
      dragging={drag?.session.row.id === row.id}
      insertion={drag?.target?.kind === 'row' && drag.target.id === row.id ? drag.target.edge : undefined}
      removing={removing.has(row.id)}
      flash={flashId === row.id || flashed === row.id || (!!row.destination && flashId === row.destination.id)
        || (row.kind === 'accommodation' && flashId === `stay-date:${row.accommodation.stayDate}`)}
      chinese={chinese}
      onOpen={!selectionMode || editable ? () => openRow(row) : undefined}
      onSelect={editable && !selectionMode && !busy ? () => {
        lightTap();
        openSwipe.current?.close();
        setSelection(new Set([row.id]));
      } : undefined}
      onPool={canSwipe ? () => { void removeRows([row.id], 'pool'); } : undefined}
      onDelete={canSwipe ? () => { void removeRows([row.id], 'delete'); } : undefined}
      onSwipe={(methods) => {
        if (openSwipe.current && openSwipe.current !== methods) openSwipe.current.close();
        openSwipe.current = methods;
      }}
      viewRef={(element) => { if (element) rowViews.current.set(row.id, element); else rowViews.current.delete(row.id); }}
      drag={canDrag ? {
        onStart: (point) => { void startDrag(row, point); },
        onMove: dragMove,
        onEnd: endDrag,
        onCancel: endDrag,
        onStep: (step) => {
          const other = ordinaryRows[index + step];
          if (other?.kind === 'destination' && !other.isLegacyStay) {
            move(row, { kind: 'row', id: other.id, edge: step < 0 ? 'above' : 'below' });
          }
        },
      } : undefined}
    />;
  };

  return (
    <View ref={rootRef} collapsable={false} style={styles.root} testID="d6-route-pane">
      <D6RouteDayScroll key={day.number} onScrollToDay={scrollToDay} />
      <D6SelectionFooter
        key={`${selectionMode}-${selectionCount}-${busy}`}
        active={selectionMode}
        count={selectionCount}
        busy={busy}
        onSelectionChange={onSelectionChange}
        onCancel={() => setSelection(null)}
        onAction={(action) => { void removeRows(selectedIds, action); }}
      />
      <View style={styles.strip}>
        <View style={styles.month} accessibilityElementsHidden>
          <Text style={styles.monthText}>{days[0].date.getMonth() + 1}</Text>
          <Text style={styles.monthText}>{chinese ? '月' : ''}</Text>
        </View>
        <View ref={stripRef} collapsable={false} style={styles.stripInner}>
          <ScrollView
            ref={stripScroll}
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollEnabled={!drag}
            scrollEventThrottle={32}
            onScroll={updateStrip}
            onLayout={({ nativeEvent: { layout } }) => { stripMetrics.current.width = layout.width; updateStrip(); scrollToDay(); }}
            onContentSizeChange={(width) => {
              stripMetrics.current.content = width;
              updateStrip();
              if (revealNewDay.current) {
                revealNewDay.current = false;
                stripScroll.current?.scrollToEnd({ animated: true });
              }
            }}
            contentContainerStyle={styles.dayList}
          >
            {days.map((item) => {
              const selected = item.number === day.number;
              const drop = (drag?.target?.kind === 'day' && drag.target.day === item.number) || flashedDay === item.number;
              return (
                <Pressable
                  key={item.number}
                  ref={(element) => { if (element) dayViews.current.set(item.number, element); else dayViews.current.delete(item.number); }}
                  testID={`d6-route-day-${item.number}`}
                  accessibilityRole="button"
                  accessibilityLabel={item.date.toLocaleDateString(chinese ? 'zh-TW' : 'en', { month: 'long', day: 'numeric', weekday: 'long' })}
                  accessibilityState={{ selected, disabled: busy }}
                  disabled={busy}
                  onPress={() => changeDay(item.number)}
                  style={[styles.day, selected && styles.daySelected, drop && styles.dropDay, drop && { borderColor: accent }]}
                >
                  <Text style={[styles.weekday, selected && styles.daySelectedText]}>{weekdays[item.date.getDay()]}</Text>
                  <Text style={[
                    styles.date, selected && styles.daySelectedText,
                    displayFont ? { fontFamily: displayFont, fontWeight: 'normal', fontStyle: 'normal' } : null,
                  ]}>{item.date.getDate()}</Text>
                  <View style={[styles.color, { backgroundColor: item.color }]} />
                </Pressable>
              );
            })}
            {canEditDates && !selectionMode ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={chinese ? '增加一天' : 'Add a day'}
                disabled={busy}
                testID="d6-route-add-day"
                style={styles.addDay}
                onPress={() => {
                  revealNewDay.current = true;
                  void changeRange(count + 1, outgoing).then((saved) => { if (!saved) revealNewDay.current = false; });
                }}
              >
                <Ionicons name="add" size={23} color="rgba(255,255,255,.65)" />
              </Pressable>
            ) : null}
          </ScrollView>
          {stripMore ? <LinearGradient
            pointerEvents="none"
            colors={['rgba(30,40,38,0)', 'rgba(30,40,38,.82)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.fade}
          /> : null}
        </View>
        {selectionMode ? (
          <Pressable
            style={styles.selectAll}
            accessibilityRole="button"
            testID="d6-route-select-all"
            onPress={() => setSelection(new Set(selectedAll ? [] : selectableRows.map((row) => row.id)))}
          >
            <Text style={styles.selectAllText}>{chinese ? selectedAll ? '取消全選' : '全選' : selectedAll ? 'Deselect all' : 'Select all'}</Text>
          </Pressable>
        ) : moreActions ? (
          <SheetHeaderAction action="more" accessibilityLabel={chinese ? '更多' : 'More'}
            testID="d6-route-options" onPress={() => setPopup('menu')} />
        ) : null}
      </View>

      <ScrollView
        testID="d6-route-scroll"
        style={styles.list}
        contentContainerStyle={styles.listContent}
        scrollEnabled={!drag}
        showsVerticalScrollIndicator={false}
      >
        {canEdit && !selectionMode ? suggestions.map((suggestion) => (
          <View key={suggestion.id} style={styles.suggestion}>
            <View style={[styles.suggestionAvatar, { backgroundColor: suggestion.avatarColor ?? '#CDE2F1' }]}>
              {suggestion.avatar ? <Text style={styles.glyph}>{suggestion.avatar}</Text> : <Ionicons name="person" size={16} color="#273D4B" />}
            </View>
            <Text style={styles.rowTitle} numberOfLines={1}>{suggestion.title}</Text>
            <RouteIcon label={chinese ? '略過建議' : 'Dismiss suggestion'} icon="close" onPress={() => onSuggestion(suggestion.id, false, day.number)} />
            <RouteIcon label={chinese ? '加入建議' : 'Add suggestion'} icon="add" primary onPress={() => onSuggestion(suggestion.id, true, day.number)} />
          </View>
        )) : null}

        {completed.length > 0 && !selectionMode ? <>
          <Fold
            title={chinese ? `已完成 ${completed.length}` : `Completed ${completed.length}`}
            open={showCompleted}
            onPress={() => setShowCompleted(!showCompleted)}
          />
          {showCompleted ? completed.map((destination) => <D6RouteRow
            key={destination.id}
            row={{ kind: 'destination', id: destination.id, destination }}
            accent={accent}
            color={day.color}
            completed
            chinese={chinese}
          />) : null}
        </> : null}

        {ordinaryRows.map(renderRouteRow)}
        {accommodationRows.length > 0 || showStaySlot ? <View testID="d6-accommodation-section" style={styles.accommodationSection}>
          <Text accessibilityRole="header" style={styles.accommodationTitle}>{chinese ? '住宿' : 'Accommodation'}</Text>
          {accommodationRows.map(renderRouteRow)}


        {showStaySlot ? (
          <Pressable accessibilityRole="button" style={styles.stay} onPress={() => onAdd(day.number, 'accommodation')} testID="d6-route-add-stay">
            <View style={styles.dashed}><Text style={styles.glyph}>🛏</Text></View>
            <Text style={styles.stayText}>{chinese ? '今晚住哪' : 'Where to stay tonight'}</Text>
          </Pressable>
        ) : null}
        </View> : null}

        {!selectionMode ? <>
          <Pressable accessibilityRole="button" onPress={() => onAdd(day.number, 'stop')} style={styles.add} testID="d6-route-add-place">
            <Ionicons name="add" size={19} color="white" />
            <Text style={styles.addText}>{chinese ? canEdit ? '地點' : '建議地點' : canEdit ? 'Place' : 'Suggest a place'}</Text>
          </Pressable>
          {pool.length > 0 ? <>
            <Fold
              title={chinese ? `待排 ${pool.length}` : `Unplanned ${pool.length}`}
              open={showPool}
              onPress={() => setPoolFold((current) => ({ ...current, open: !current.open, flash: null }))}
              testID="d6-route-pool"
            />
            {showPool ? pool.map((destination) => (
              <View key={destination.id} style={styles.poolRow}>
                {poolFold.flash === destination.id ? <D6RowFlash key={poolFlashKey} accent={accent} /> : null}
                <Pressable
                  onPress={() => onOpenStop(destination)}
                  style={styles.poolTitle}
                  accessibilityRole="button"
                  accessibilityLabel={destination.title}
                >
                  <View style={styles.dashed}><Text style={styles.glyph}>
                    {destination.kind === 'accommodation' ? '🛏' : destinationEmojiDisplay(destination.emoji, '📍')}
                  </Text></View>
                  <Text style={styles.rowTitle} numberOfLines={1}>{destination.title}</Text>
                </Pressable>
                {canEdit ? <RouteIcon
                  icon="add"
                  label={chinese ? `排入 ${day.date.getMonth() + 1}/${day.date.getDate()}` : `Schedule on ${day.date.toLocaleDateString('en')}`}
                  testID={`d6-route-assign-${destination.id}`}
                  disabled={busy}
                  onPress={() => {
                    const updates = d6Reorder(destinations, { ids: [destination.id], day: day.number });
                    if (updates.length) void write(async () => {
                      const saved = await onReorder(updates);
                      if (saved) focusRow(destination.id);
                      return saved;
                    });
                  }}
                /> : null}
              </View>
            )) : null}
          </> : null}
        </> : null}

        {!popup && status ? <Text accessibilityRole="alert" style={styles.error}>{status}</Text> : null}
        {showLegacy ? legacyContent : null}
      </ScrollView>

      {drag ? <View
        pointerEvents="none"
        accessibilityElementsHidden
        style={[styles.dragged, {
          top: drag.session.point.y - drag.session.offset.y - drag.session.root.y,
          left: drag.session.source.x - drag.session.root.x + (drag.session.point.x - drag.session.offset.x - drag.session.source.x) * 0.35,
          width: drag.session.source.width,
        }]}
      >
        <D6RouteRow row={drag.session.row} accent={accent} color={day.color} chinese={chinese} preview />
      </View> : null}

      {drag ? <View pointerEvents="none" style={[styles.dropHintBar, { backgroundColor: accent }]}>
        <Text numberOfLines={3} accessibilityLiveRegion="polite" testID="d6-drop-hint" style={styles.dropHint}>{d6DropLabel(rows, drag.session.row.id, drag.target, chinese)}</Text>
      </View> : null}

      {drag?.target?.kind === 'row' ? (() => {
        const drop = drag.target;
        if (drop?.kind !== 'row') return null;
        const target = drag.session.rows.find(row => row.id === drop.id);
        return target ? <View testID="d6-active-drop-line" pointerEvents="none" style={[styles.activeDropLine, { backgroundColor: accent,
          top: target.bounds.y - drag.session.root.y + (drop.edge === 'below' ? target.bounds.height : 0) - 3 }]} /> : null;
      })() : null}

      {popup ? <Modal
        animationType="fade"
        transparent
        statusBarTranslucent
        visible
        onRequestClose={() => setPopup(null)}
      >
        <GestureHandlerRootView style={styles.root}>
          <View style={[styles.popoverRoot, { paddingBottom: Math.max(insets.bottom, 24), paddingTop: insets.top + 8 }]}>
            <Pressable
              style={styles.scrim}
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
              onPress={() => !busy && setPopup(null)}
            />
            <SwiftUIGlassSurface
              cornerRadius={MAP_SHEET_CORNER_RADIUS}
              fallbackTintColor="#26302E"
              style={styles.popoverSurface}
            >
              <View style={[styles.popover, transparencyReduced && styles.opaque]}>
                <View style={styles.popoverHeader}>
                  <Text accessibilityRole="header" style={styles.popoverTitle}>
                    {popup === 'dates' ? chinese ? '日期' : 'Dates' : chinese ? '行程選項' : 'Itinerary options'}
                  </Text>
                  <SheetHeaderAction action={popup === 'dates' ? 'commit' : 'close'} disabled={busy}
                    accessibilityLabel={popup === 'dates' ? t('map.done') : t('common.close')}
                    testID={popup === 'dates' ? 'd6-route-dates-done' : 'd6-route-close-options'}
                    onPress={() => setPopup(null)} />
                </View>
              <ScrollView style={styles.popoverBody} keyboardShouldPersistTaps="handled">
                {popup === 'dates' ? <D6RouteDates
                  days={days}
                  accent={accent}
                  displayFont={displayFont}
                  chinese={chinese}
                  onRange={changeRange}
                  onColor={onDayColor}
                  busy={busy}
                  error={status}
                /> : <View>
                  {canEdit ? <MenuRow testID="d6-route-menu-select" title={chinese ? '選取' : 'Select'} onPress={() => { setSelection(new Set()); setPopup(null); }} /> : null}
                  {canEditDates ? <MenuRow testID="d6-route-menu-dates" title={chinese ? '日期' : 'Dates'} onPress={() => { setFailure(null); setPopup('dates'); }} /> : null}
                  {canEdit ? <MenuRow testID="d6-route-menu-kml" title={chinese ? '匯入 KML' : 'Import KML'} onPress={() => { setPopup(null); onImport(); }} /> : null}
                  {onManageArrivals ? <MenuRow testID="map-arrival-manage" title={t('arrival.manage')} onPress={() => {
                    setPopup(null);
                    onManageArrivals();
                  }} /> : null}
                  {onCompleteEarly ? <MenuRow testID="d6-route-complete-early" title={chinese ? '提前完成集合點' : 'Finish gathering early'} onPress={() => {
                    setPopup(null);
                    onCompleteEarly();
                  }} /> : null}
                  {legacyContent ? <MenuRow title={chinese ? '其他行程工具' : 'More itinerary tools'} onPress={() => { setShowLegacy(true); setPopup(null); }} /> : null}
                </View>}
              </ScrollView>
              </View>
            </SwiftUIGlassSurface>
          </View>
        </GestureHandlerRootView>
      </Modal> : null}
    </View>
  );
}

function D6SelectionFooter({ active, count, busy, onSelectionChange, onCancel, onAction }: {
  active: boolean;
  count: number;
  busy: boolean;
  onSelectionChange: D6RoutePaneProps['onSelectionChange'];
  onCancel: () => void;
  onAction: (action: 'delete' | 'pool') => void;
}) {
  const action = useRef(onAction);
  const bindAction = useCallback((view: View | null) => { if (view) action.current = onAction; }, [onAction]);
  useMountEffect(() => {
    if (!active) return;
    onSelectionChange?.({
      count,
      canAct: count > 0 && !busy,
      onCancel,
      onPool: () => action.current('pool'),
      onDelete: () => action.current('delete'),
    });
    return () => onSelectionChange?.(null);
  });
  return active ? <View ref={bindAction} collapsable={false} style={styles.noHeight} /> : null;
}

function D6RouteDayScroll({ onScrollToDay }: { onScrollToDay: () => void }) {
  useMountEffect(() => {
    const id = requestAnimationFrame(onScrollToDay);
    return () => cancelAnimationFrame(id);
  });
  return null;
}

function RouteIcon({ label, icon, onPress, primary, disabled, testID }: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ disabled: !!disabled }}
    disabled={disabled}
    onPress={onPress}
    style={[styles.circle, primary && styles.primaryCircle]}
    testID={testID}
  >
    <Ionicons name={icon} size={21} color={primary ? '#151D1B' : 'white'} />
  </Pressable>;
}

function Fold({ title, open, onPress, testID }: { title: string; open: boolean; onPress: () => void; testID?: string }) {
  return <Pressable
    accessibilityRole="button"
    accessibilityState={{ expanded: open }}
    onPress={onPress}
    style={styles.fold}
    testID={testID}
  >
    <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={16} color="rgba(255,255,255,.55)" />
    <Text style={styles.foldTitle}>{title}</Text>
  </Pressable>;
}

function MenuRow({ title, onPress, testID }: { title: string; onPress: () => void; testID?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={styles.menuRow} testID={testID}>
    <Text style={styles.rowTitle}>{title}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  noHeight: { height: 0 },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  stripInner: { flex: 1, minWidth: 0 },
  month: { width: 28, alignItems: 'center', justifyContent: 'center' },
  monthText: { color: 'rgba(255,255,255,.5)', fontSize: APP_TEXT_SIZE.caption, fontWeight: '700', textAlign: 'center' },
  dayList: { gap: 6, alignItems: 'center', paddingVertical: 3, paddingRight: 6 },
  day: { minHeight: 56, width: 46, borderRadius: 16, borderWidth: 2, borderColor: 'transparent', gap: 1, backgroundColor: 'rgba(255,255,255,.07)', alignItems: 'center', justifyContent: 'center', paddingTop: 3, paddingBottom: 5 },
  daySelected: { backgroundColor: 'white' },
  dropDay: { transform: [{ scale: 1.08 }] },
  weekday: { color: 'rgba(255,255,255,.65)', fontSize: APP_TEXT_SIZE.caption, fontWeight: '600' },
  date: { color: 'white', fontSize: APP_TEXT_SIZE.heading, fontWeight: '800', fontStyle: 'italic', fontVariant: ['tabular-nums'] },
  daySelectedText: { color: '#111' },
  color: { width: 14, height: 3, borderRadius: 2, marginTop: 1 },
  addDay: { width: 46, minHeight: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,.3)' },
  fade: { position: 'absolute', right: 0, top: 0, bottom: 0, width: '14%' },
  selectAll: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3 },
  selectAllText: { color: 'white', fontWeight: '700', fontSize: APP_TEXT_SIZE.caption },
  list: { flex: 1 },
  listContent: { paddingBottom: 8 },
  circle: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: 'rgba(255,255,255,.12)' },
  primaryCircle: { backgroundColor: 'white' },
  suggestion: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,.07)', borderRadius: 18, marginVertical: 5, paddingVertical: 4, paddingHorizontal: 8 },
  suggestionAvatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  glyph: { fontSize: 16 },
  rowTitle: { flex: 1, minWidth: 0, color: 'white', fontSize: APP_TEXT_SIZE.caption, fontWeight: '600' },
  fold: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  foldTitle: { color: 'rgba(255,255,255,.55)', fontSize: APP_TEXT_SIZE.caption, fontWeight: '700' },
  stay: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingLeft: 4 },
  stayText: { color: 'rgba(255,255,255,.70)', fontSize: APP_TEXT_SIZE.caption, fontWeight: '600' },
  dashed: { width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,.38)', backgroundColor: '#26302E', alignItems: 'center', justifyContent: 'center' },
  add: { minHeight: 48, marginTop: 8, backgroundColor: 'rgba(255,255,255,.12)', borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  addText: { color: 'white', fontSize: APP_TEXT_SIZE.caption, fontWeight: '700' },
  poolRow: { flexDirection: 'row', alignItems: 'center', minHeight: 50, borderRadius: 14, overflow: 'hidden', paddingLeft: 4, gap: 8 },
  poolTitle: { flex: 1, minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 12 },
  accommodationSection: { marginTop: 18, marginBottom: 12, padding: 12, borderRadius: 22, backgroundColor: '#ffffff12', borderWidth: 1, borderColor: '#ffffff2a' },
  accommodationTitle: { fontSize: APP_TEXT_SIZE.body, fontWeight: '700', color: '#fff', paddingBottom: 8 },
  activeDropLine: { position: 'absolute', height: 6, borderRadius: 3, left: 0, right: 0, zIndex: 8, boxShadow: '0 0 0 4px rgba(76,111,255,.2)' },
  dropHintBar: { position: 'absolute', bottom: 10, left: 12, right: 12, zIndex: 12, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: '#ffffff55', boxShadow: '0 4px 16px rgba(0,0,0,.35)' },
  dropHint: { color: '#fff', fontSize: APP_TEXT_SIZE.caption, fontWeight: '700', textAlign: 'center' },
  dragged: { position: 'absolute', zIndex: 4, borderRadius: 14, backgroundColor: '#34423E', boxShadow: '0 12px 26px rgba(0,0,0,.4)' },
  popoverRoot: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: MAP_FLOATING_EDGE_INSET },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,.4)' },
  popoverSurface: { borderRadius: MAP_SHEET_CORNER_RADIUS, overflow: 'hidden', flexShrink: 1 },
  popover: { padding: SHEET_CORNER_ACTION_INSET, flexShrink: 1, minHeight: 0, backgroundColor: 'rgba(25,36,34,.75)' },
  popoverHeader: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 8 },
  popoverTitle: { flex: 1, minHeight: MAP_SHEET_ACTION_HIT_SIZE, paddingVertical: 13, color: '#fff', fontSize: APP_TEXT_SIZE.body, fontWeight: '700' },
  popoverBody: { flexGrow: 0, flexShrink: 1 },
  opaque: { backgroundColor: '#26302E' },
  menuRow: { minHeight: 51, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,.14)' },
  error: { color: '#FF8E8E', marginTop: 8, fontSize: APP_TEXT_SIZE.caption },
});
