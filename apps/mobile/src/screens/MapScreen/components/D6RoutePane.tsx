import { APP_TEXT_SIZE } from '../../../theme/typeScale';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { MaskedView } from '@expo/ui/community/masked-view';
import React, { useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { AppText as Text } from '../../../components/AppText';
import Pressable from '../../../components/MotionPressable';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedRef, useAnimatedStyle, useDerivedValue, useSharedValue, type AnimatedRef, type DerivedValue, type SharedValue } from 'react-native-reanimated';
import type { SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SwiftUIGlassSurface from '../../../components/SwiftUIGlassSurface';
import SheetHeaderAction from '../../../components/SheetHeaderAction';
import SheetPresentation, { PRESENTED_SHEET_CONTENT_TOP } from '../../../components/SheetPresentation';
import { MAP_FLOATING_EDGE_INSET, MAP_SHEET_CORNER_RADIUS, MAP_SHEET_ACTION_HIT_SIZE, SHEET_CORNER_ACTION_INSET, sheetCornerHeaderInset } from '../../../components/mapSheetChrome';
import { useMountEffect } from '../../../hooks/useMountEffect';
import { useTranslation } from '../../../i18n';
import type { DailyAccommodation, Destination } from '../../../types';
import { destinationEmojiDisplay } from '../../../utils/destinationEmojiColor';
import { lightTap, selectionTick } from '../../../utils/haptics';
import { localDayKey, openDestinationsForReorder, parseDateOnlyLocal } from '../../../utils/tripDay';
import { d6DayRows, d6Reorder, d6TripDays, type D6RouteRow as RouteRow } from '../d6Itinerary';
import type { ReorderUpdate } from '../itineraryReorder';
import { D6RouteDates } from './D6RouteDates';
import D6RouteMenu, { type D6RouteMenuItem } from './D6RouteMenu';
import { D6RouteRow, D6RouteRowPreview, D6RowFlash } from './D6RouteRow';
import { D6PaneScrollView } from './D6PaneScrollView';
import { D6PaneInteractionContext, D6PaneOverlay } from './D6PaneInteraction';
import { releaseD6Drag, type D6DragOwner } from './d6DragOwnership';
import { measureAttached } from './d6GestureGuard';
import { d6DragTarget, d6DropDestination, type D6DragBounds, type D6DragGeometry, type D6DragPresentation, type D6DragSession, type D6DragTarget, type D6Point } from './d6RouteDrag';

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

type RoutePopupPage = 'menu' | 'dates';
type RoutePopup = { page: RoutePopupPage; phase: 'open' | 'closing' };

const DATE_POPUP_DETENT = { fraction: 0.72 };

const WEEKDAYS_ZH = ['日', '一', '二', '三', '四', '五', '六'];
const WEEKDAYS_EN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export function D6RoutePane({
  accent, displayFont, destinations, dailyAccommodations, departureDate, tripDays, selectedDay,
  onSelectDay, activeDestinationId, canEdit, canEditDates = canEdit, dayColors, onDayColor,
  suggestions, onSuggestion, onOpenStop, onAdd, onCompleteEarly, onManageArrivals, onImport, onReorder, onDelete, onTripDetails,
  onAccommodation, onSelectionChange, legacyContent, flashId, poolFlashKey, error,
}: D6RoutePaneProps) {
  const { language, t } = useTranslation();
  const panel = useContext(D6PaneInteractionContext);
  const localOwner = useSharedValue<D6DragOwner>('idle');
  const owner = panel?.owner ?? localOwner;
  const dragPoint = useSharedValue<D6Point>({ x: 0, y: 0 });
  const dragPresentation = useSharedValue<D6DragPresentation | null>(null);
  const dragSequence = useSharedValue(0);
  const dragTarget = useDerivedValue(() => {
    const presentation = dragPresentation.get();
    return presentation ? d6DragTarget(presentation.geometry, dragPoint.get()) : null;
  });
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
  const [popup, setPopup] = useState<RoutePopup | null>(null);
  const isIOS = Platform.OS === 'ios';
  const popupPage = popup?.page;
  const popupDetent = popupPage === 'dates' ? DATE_POPUP_DETENT : 'medium';

  function openPopup(page: RoutePopupPage) {
    setPopup(current => current?.phase === 'closing' ? current : { page, phase: 'open' });
  }

  function closePopup() {
    setPopup(current => isIOS && current ? { page: current.page, phase: 'closing' } : null);
  }
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
  const [stripBefore, setStripBefore] = useState(false);
  const stripScroll = useRef<ScrollView | null>(null);
  const [stripWidth, setStripWidth] = useState(0);
  const stripDragging = useRef(false);
  const tickedDay = useRef(selectedDay);
  const stripMetrics = useRef({ offset: 0, width: 0, content: 0 });
  const dragSession = useRef<{ token: number; scope: string; session: D6DragSession } | null>(null);
  const lastDragToken = useRef(0);
  const rootRef = useAnimatedRef<View>();
  const stripRef = useAnimatedRef<View>();
  const [rowRefs, setRowRefs] = useState<ReadonlyMap<string, AnimatedRef<View>>>(() => new Map());
  const registerRow = useCallback((id: string, ref: AnimatedRef<View> | null) => {
    setRowRefs(current => {
      if (current.get(id) === ref || (!ref && !current.has(id))) return current;
      const next = new Map(current);
      if (ref) next.set(id, ref); else next.delete(id);
      return next;
    });
  }, []);
  const dayViews = useRef(new Map<number, View>());
  const dayBounds = useSharedValue<{ version: number; days: { day: number; bounds: D6DragBounds }[] }>({ version: 0, days: [] });
  const dayMeasurementVersion = useRef(0);
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
    setStripBefore(offset > 4);
    const version = ++dayMeasurementVersion.current;
    dayBounds.set({ version, days: [] });
    for (const [dayNumber, view] of dayViews.current) {
      view.measureInWindow((x, y, dayWidth, dayHeight) => {
        if (dayWidth <= 0 || dayHeight <= 0) return;
        dayBounds.modify(current => {
          'worklet';
          return current.version === version ? { version, days: [
            ...current.days.filter(entry => entry.day !== dayNumber),
            { day: dayNumber, bounds: { x, y, width: dayWidth, height: dayHeight } },
          ] } : current;
        });
      });
    }
  }, [dayBounds]);

  function scrollToDay(animated = true) {
    tickedDay.current = day.number;
    stripScroll.current?.scrollTo({ x: (day.number - 1) * DAY_STRIDE, animated });
  }

  function centeredDay(offset: number) {
    return Math.max(1, Math.min(count, Math.round(offset / DAY_STRIDE) + 1));
  }

  function tickCenteredDay(offset: number) {
    if (!stripDragging.current) return;
    const next = centeredDay(offset);
    const crossed = Math.abs(next - tickedDay.current);
    tickedDay.current = next;
    for (let step = 0; step < crossed; step++) selectionTick();
  }

  function settleStrip(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const offset = event.nativeEvent.contentOffset.x;
    tickCenteredDay(offset);
    stripDragging.current = false;
    const next = centeredDay(offset);
    if (Math.abs(offset - (next - 1) * DAY_STRIDE) > 1) stripScroll.current?.scrollTo({ x: (next - 1) * DAY_STRIDE, animated: true });
    changeDay(next);
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
  }, [setFailure, t]);

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
  const rowIdentity = rows.map(row => row.id).join('\n');
  const dragScope = `${panel?.open ?? true}:${outgoing}:${count}:${day.number}:${selectionMode}:${rowIdentity}`;
  const committedDragScope = useRef<{ scope: string; clear: () => void } | null>(null);
  const clearDrag = useCallback(() => {
    dragSession.current = null;
    dragPresentation.set(null);
    releaseD6Drag(owner, 'reorder');
  }, [dragPresentation, owner]);
  const bindDragScope = useCallback((view: View | null) => {
    rootRef(view);
    if (!view) {
      const previous = committedDragScope.current;
      committedDragScope.current = null;
      previous?.clear();
      return;
    }
    const previous = committedDragScope.current;
    if (previous?.scope === dragScope && previous.clear === clearDrag) return;
    previous?.clear();
    committedDragScope.current = { scope: dragScope, clear: clearDrag };
  }, [clearDrag, dragScope, rootRef]);
  useMountEffect(() => () => {
    committedDragScope.current?.clear();
    committedDragScope.current = null;
  });

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

  function move(row: RouteRow, target: D6DragTarget) {
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

  function startDrag(row: RouteRow, token: number, point: D6Point, geometry: D6DragGeometry, scope: string) {
    if (token <= lastDragToken.current) return;
    lastDragToken.current = token;
    if (committedDragScope.current?.scope !== scope || writing.current || (panel && !panel.open)) {
      if (dragPresentation.get()?.token === token) {
        dragPresentation.set(null);
        releaseD6Drag(owner, 'reorder');
      }
      return;
    }
    openSwipe.current?.close();
    const session: D6DragSession = { ...geometry, row,
      offset: { x: point.x - geometry.source.x, y: point.y - geometry.source.y } };
    dragSession.current = { token, scope, session };
  }

  function endDrag(token: number, point?: D6Point) {
    lastDragToken.current = Math.max(lastDragToken.current, token);
    const active = dragSession.current;
    if (!active || active.token !== token) return;
    dragSession.current = null;
    if (dragPresentation.get()?.token === token) {
      dragPresentation.set(null);
      releaseD6Drag(owner, 'reorder');
    }
    if (active.scope !== committedDragScope.current?.scope) return;
    const session = active.session;
    const target = d6DropDestination(session, point, rows.map(row => row.id));
    if (session && target) move(session.row, target);
  }

  function changeRange(nextCount: number, nextDeparture: string) {
    return write(async () => {
      const saved = await onTripDetails(nextCount, nextDeparture);
      if (saved && selectedDay > nextCount) onSelectDay(nextCount);
      return saved;
    });
  }

  const ordinaryRows = useMemo(() => rows.filter(row => row.kind === 'destination' && !row.isLegacyStay), [rows]);
  const accommodationRows = rows.filter(row => row.kind === 'accommodation' || row.isLegacyStay);
  const selectedAll = selectableRows.length > 0 && selectionCount === selectableRows.length;
  const hasStay = rows.some((row) => row.kind === 'accommodation' || row.isLegacyStay);
  const showStaySlot = canEdit && canEditDates && !selectionMode && day.number < count && !hasStay;
  const status = error ?? failure;

  const dragGeometries = useMemo(() => {
    const refs = ordinaryRows.flatMap(row => {
      const ref = rowRefs.get(row.id);
      return ref ? [{ id: row.id, ref }] : [];
    });
    const overlayRef = panel?.overlayRef ?? rootRef;
    const viewport = panel?.viewport;
    return new Map(ordinaryRows.map(({ id: sourceId }) => [sourceId, (): D6DragGeometry | null => {
      'worklet';
      const root = measureAttached(rootRef);
      const strip = measureAttached(stripRef);
      const overlay = measureAttached(overlayRef);
      const clip = viewport ? measureAttached(viewport.ref) : null;
      if (!root || !strip || !overlay || (viewport && !clip)) return null;
      const bottom = viewport && clip
        ? clip.pageY + Math.max(0, viewport.height.get() - viewport.closed)
        : root.pageY + root.height;
      const measuredRows = refs.flatMap(entry => {
        const bounds = measureAttached(entry.ref);
        return bounds ? [{ id: entry.id, bounds: {
          x: bounds.pageX, y: bounds.pageY, width: bounds.width, height: bounds.height,
        } }] : [];
      });
      const source = measuredRows.find(entry => entry.id === sourceId);
      if (!source) return null;
      return {
        root: { x: root.pageX, y: root.pageY, width: root.width, height: Math.max(0, Math.min(root.height, bottom - root.pageY)) },
        strip: { x: strip.pageX, y: strip.pageY, width: strip.width, height: strip.height },
        overlay: { x: overlay.pageX, y: overlay.pageY },
        source: source.bounds,
        days: dayBounds.get().days,
        rows: measuredRows.filter(entry => entry.id !== sourceId),
      };
    }]));
  }, [ordinaryRows, rowRefs, panel?.overlayRef, panel?.viewport, rootRef, stripRef, dayBounds]);

  const renderRouteRow = (row: RouteRow, index: number) => {
    const geometry = dragGeometries.get(row.id);
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
      measureRef={registerRow}
      drag={canDrag && geometry ? {
        owner,
        point: dragPoint,
        presentation: dragPresentation,
        sequence: dragSequence,
        geometry,
        onStart: (token, point, geometry) => startDrag(row, token, point, geometry, dragScope),
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

  const menuItems: D6RouteMenuItem[] = [];
  if (canEdit) menuItems.push({ testID: 'd6-route-menu-select', title: chinese ? '選取' : 'Select', onPress: () => setSelection(new Set()) });
  if (canEditDates) menuItems.push({ testID: 'd6-route-menu-dates', title: chinese ? '日期' : 'Dates', onPress: () => {
    setFailure(null);
    openPopup('dates');
  } });
  if (onManageArrivals) menuItems.push({ testID: 'map-arrival-manage', title: t('arrival.manage'), onPress: onManageArrivals });
  if (onCompleteEarly) menuItems.push({
    testID: 'd6-route-complete-early', title: chinese ? '提前完成集合點' : 'Finish gathering early', onPress: onCompleteEarly,
  });
  if (legacyContent) menuItems.push({
    testID: 'd6-route-menu-legacy', title: chinese ? '其他行程工具' : 'More itinerary tools', onPress: () => setShowLegacy(true),
  });
  if (canEdit) menuItems.push({ testID: 'd6-route-menu-kml', title: chinese ? '匯入 KML' : 'Import KML', onPress: onImport });

  const showingDates = popupPage === 'dates';
  const popupContent = (
    <View style={[styles.popover, isIOS ? styles.nativePopover : transparencyReduced && styles.opaque]}>
      <View style={styles.popoverHeader}>
        <Text accessibilityRole="header" style={styles.popoverTitle}>
          {showingDates ? chinese ? '日期' : 'Dates' : chinese ? '行程選項' : 'Itinerary options'}
        </Text>
        <SheetHeaderAction action={showingDates ? 'commit' : 'close'} disabled={busy}
          accessibilityLabel={showingDates ? t('map.done') : t('common.close')}
          testID={showingDates ? 'd6-route-dates-done' : 'd6-route-close-options'}
          onPress={() => closePopup()} />
      </View>
      <ScrollView style={styles.popoverBody} keyboardShouldPersistTaps="handled">
        {showingDates ? <D6RouteDates
          days={days}
          accent={accent}
          displayFont={displayFont}
          chinese={chinese}
          onRange={changeRange}
          onColor={onDayColor}
          busy={busy}
          error={status}
        /> : <View>
          {menuItems.map(item => <MenuRow key={item.testID} {...item} last={item.testID === 'd6-route-menu-kml'} onPress={() => {
            closePopup();
            item.onPress();
          }} />)}
        </View>}
      </ScrollView>
    </View>
  );

  return (
    <View ref={bindDragScope} collapsable={false} style={styles.root} testID="d6-route-pane">
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
      <View style={styles.strip} onLayout={({ nativeEvent: { layout } }) => panel?.reportContent?.({ leading: layout.height + STRIP_GAP })}>
        <View style={styles.month} accessibilityElementsHidden>
          <Text style={styles.monthText}>{days[0].date.getMonth() + 1}</Text>
          <Text style={styles.monthText}>{chinese ? '月' : ''}</Text>
        </View>
        <View ref={stripRef} collapsable={false} style={styles.stripInner}>
          <MaskedView style={styles.stripMask} maskElement={<View style={styles.stripMaskRow}>
            {stripBefore ? <LinearGradient colors={['#ffffff00', '#fff']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.stripFade} /> : null}
            <View style={styles.stripOpaque} />
            {stripMore ? <LinearGradient colors={['#fff', '#ffffff00']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.stripFade} /> : null}
          </View>}>
          <ScrollView
            ref={stripScroll}
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={32}
            scrollEnabled={!busy}
            decelerationRate="fast"
            snapToInterval={DAY_STRIDE}
            contentOffset={{ x: (day.number - 1) * DAY_STRIDE, y: 0 }}
            onScrollBeginDrag={() => { stripDragging.current = true; }}
            onScroll={(event) => { tickCenteredDay(event.nativeEvent.contentOffset.x); updateStrip(event); }}
            onMomentumScrollEnd={settleStrip}
            onScrollEndDrag={(event) => {
              if (Math.abs(event.nativeEvent.velocity?.x ?? 0) < 0.05) settleStrip(event);
            }}
            onLayout={({ nativeEvent: { layout } }) => {
              stripMetrics.current.width = layout.width;
              setStripWidth(layout.width);
              updateStrip();
              scrollToDay(false);
            }}
            onContentSizeChange={(width) => {
              stripMetrics.current.content = width;
              updateStrip();
            }}
            contentContainerStyle={[styles.dayList, { paddingHorizontal: Math.max(6, (stripWidth - DAY_CHIP_WIDTH) / 2) }]}
          >
            {days.map((item) => {
              const selected = item.number === day.number;
              const drop = flashedDay === item.number;
              return (
                <Pressable
                  key={item.number}
                  ref={(element) => { if (element) dayViews.current.set(item.number, element); else dayViews.current.delete(item.number); }}
                  testID={`d6-route-day-${item.number}`}
                  accessibilityRole="button"
                  accessibilityLabel={item.date.toLocaleDateString(chinese ? 'zh-TW' : 'en', { month: 'long', day: 'numeric', weekday: 'long' })}
                  accessibilityState={{ selected, disabled: busy }}
                  disabled={busy}
                  onPress={() => {
                  if (item.number === day.number) return;
                  selectionTick();
                  changeDay(item.number);
                }}
                  style={[styles.day, selected && styles.daySelected, drop && styles.dropDay, drop && { borderColor: accent }]}
                >
                  <Text style={[styles.weekday, selected && styles.daySelectedText]}>{weekdays[item.date.getDay()]}</Text>
                  <Text style={[
                    styles.date, selected && styles.daySelectedText,
                    displayFont ? { fontFamily: displayFont, fontWeight: 'normal', fontStyle: 'normal' } : null,
                  ]}>{item.date.getDate()}</Text>
                  <View style={[styles.color, { backgroundColor: item.color }]} />
                  <D6DropDayHighlight day={item.number} target={dragTarget} accent={accent} />
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
                  void changeRange(count + 1, outgoing).then((saved) => { if (saved) onSelectDay(count + 1); });
                }}
              >
                <Ionicons name="add" size={23} color="rgba(255,255,255,.65)" />
              </Pressable>
            ) : null}
          </ScrollView>
          </MaskedView>
        </View>
        {selectionMode ? (
          <Pressable
            style={styles.selectAll}
            accessibilityRole="button"
            testID="d6-route-select-all"
            onPress={() => setSelection(new Set(selectedAll ? [] : selectableRows.map((row) => row.id)))}
          >
            <View style={styles.selectAllPill}>
              <Text style={[styles.selectAllText, { color: accent }]}>{chinese ? selectedAll ? '取消全選' : '全選' : selectedAll ? 'Deselect all' : 'Select all'}</Text>
            </View>
          </Pressable>
        ) : menuItems.length > 0 ? (
          <View style={styles.menu}>
            <D6RouteMenu label={chinese ? '更多' : 'More'} items={menuItems} onOpenFallback={() => openPopup('menu')} />
          </View>
        ) : null}
      </View>

      <D6PaneScrollView
        testID="d6-route-scroll"
        style={styles.list}
        contentContainerStyle={styles.listContent}
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
        {accommodationRows.length > 0 ? <View testID="d6-accommodation-section" style={styles.accommodationSection}>
          <Text accessibilityRole="header" style={styles.accommodationTitle}>{chinese ? '住宿' : 'Accommodation'}</Text>
          {accommodationRows.map(renderRouteRow)}
        </View> : null}

        {!selectionMode ? <>
          <View style={styles.addRow}>
            <Pressable accessibilityRole="button" onPress={() => onAdd(day.number, 'stop')} hitSlop={4} style={styles.addPill} testID="d6-route-add-place">
              <Ionicons name="add" size={17} color="white" />
              <Text style={styles.addText}>{chinese ? canEdit ? '地點' : '建議地點' : canEdit ? 'Place' : 'Suggest a place'}</Text>
            </Pressable>
            {showStaySlot ? (
              <Pressable accessibilityRole="button" onPress={() => onAdd(day.number, 'accommodation')} hitSlop={4} style={styles.addPill} testID="d6-route-add-stay">
                <Ionicons name="bed-outline" size={16} color="white" />
                <Text style={styles.addText}>{chinese ? '今晚住哪' : 'Where to stay'}</Text>
              </Pressable>
            ) : null}
          </View>
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
      </D6PaneScrollView>

      <D6PaneOverlay>{ordinaryRows.map(row => <D6DragPreview key={row.id} row={row}
        presentation={dragPresentation} target={dragTarget} point={dragPoint} accent={accent} color={day.color} />)}</D6PaneOverlay>

      {isIOS ? (
        <SheetPresentation
          visible={popup?.phase === 'open'}
          onClose={closePopup}
          onDismiss={() => setPopup(null)}
          detents={[popupDetent]}
          selection={popupDetent}
          backgroundColor={transparencyReduced ? '#26302E' : 'rgba(25,36,34,.75)'}
          dismissDisabled={busy}
        >
          {popupContent}
        </SheetPresentation>
      ) : popup ? (
        <Modal animationType="fade" transparent statusBarTranslucent visible onRequestClose={() => closePopup()}>
          <GestureHandlerRootView style={styles.root}>
            <View style={[styles.popoverRoot, { paddingBottom: Math.max(insets.bottom, 24), paddingTop: insets.top + 8 }]}>
              <Pressable
                style={styles.scrim}
                accessibilityRole="button"
                accessibilityLabel={t('common.cancel')}
                onPress={() => !busy && closePopup()}
              />
              <SwiftUIGlassSurface cornerRadius={MAP_SHEET_CORNER_RADIUS} fallbackTintColor="#26302E" style={styles.popoverSurface}>
                {popupContent}
              </SwiftUIGlassSurface>
            </View>
          </GestureHandlerRootView>
        </Modal>
      ) : null}
    </View>
  );
}

function D6DropDayHighlight({ day, target, accent }: {
  day: number;
  target: DerivedValue<D6DragTarget | null>;
  accent: string;
}) {
  const highlight = useAnimatedStyle(() => {
    const destination = target.get();
    return { opacity: destination?.kind === 'day' && destination.day === day ? 1 : 0 };
  });
  return <Animated.View pointerEvents="none" accessibilityElementsHidden
    style={[styles.dayHighlight, { borderColor: accent, backgroundColor: `${accent}33` }, highlight]} />;
}

function D6DragPreview({ row, presentation, target, point, accent, color }: {
  row: RouteRow;
  presentation: SharedValue<D6DragPresentation | null>;
  target: DerivedValue<D6DragTarget | null>;
  point: SharedValue<D6Point>;
  accent: string;
  color: string;
}) {
  const sourceId = row.id;
  const position = useAnimatedStyle(() => {
    const active = presentation.get();
    if (!active || active.sourceId !== sourceId) return { opacity: 0, width: 0 };
    return {
      opacity: 1,
      width: active.geometry.source.width,
      top: point.get().y - active.offset.y - active.geometry.overlay.y,
      left: point.get().x - active.offset.x - active.geometry.overlay.x,
    };
  });
  const destinationPreview = useAnimatedStyle(() => {
    const active = presentation.get();
    const destination = target.get();
    if (!active || active.sourceId !== sourceId || destination?.kind !== 'row') return { opacity: 0, width: 0 };
    const bounds = active.geometry.rows.find(entry => entry.id === destination.id)?.bounds;
    if (!bounds) return { opacity: 0, width: 0 };
    return {
      opacity: 0.28,
      width: active.geometry.source.width,
      top: bounds.y + (destination.edge === 'below' ? bounds.height : 0)
        - active.geometry.source.height / 2 - active.geometry.overlay.y,
      left: active.geometry.source.x - active.geometry.overlay.x,
    };
  });
  return <>
    <Animated.View testID={`d6-drop-preview-${sourceId}`} pointerEvents="none" accessibilityElementsHidden
      style={[styles.dropPreview, { borderColor: accent, backgroundColor: accent }, destinationPreview]}>
      <D6RouteRowPreview row={row} color={color} />
    </Animated.View>
    <Animated.View testID="d6-drag-preview" pointerEvents="none" accessibilityElementsHidden
      style={[styles.dragged, position]}>
      <D6RouteRowPreview row={row} color={color} />
    </Animated.View>
  </>;
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

function MenuRow({ title, onPress, testID, last }: { title: string; onPress: () => void; testID?: string; last?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={[styles.menuRow, last && styles.menuRowLast]} testID={testID}>
    <Text style={styles.rowTitle}>{title}</Text>
  </Pressable>;
}

const STRIP_FADE_WIDTH = 28;
const DAY_CHIP_WIDTH = 46;
const DAY_GAP = 6;
const DAY_STRIDE = DAY_CHIP_WIDTH + DAY_GAP;
const STRIP_GAP = 2;
const DAY_CHIP_HEIGHT = 62;
const STRIP_VERTICAL_PADDING = 3;
const STRIP_TRAILING_INSET = 4;

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  noHeight: { height: 0 },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: STRIP_GAP },
  stripInner: { flex: 1, minWidth: 0 },
  stripMask: { height: DAY_CHIP_HEIGHT + STRIP_VERTICAL_PADDING * 2 },
  stripMaskRow: { ...StyleSheet.absoluteFill, flexDirection: 'row' },
  stripOpaque: { flex: 1, backgroundColor: '#fff' },
  stripFade: { width: STRIP_FADE_WIDTH },
  month: { width: 28, alignItems: 'center', justifyContent: 'center' },
  monthText: { color: 'rgba(255,255,255,.5)', fontSize: APP_TEXT_SIZE.caption, fontWeight: '700', textAlign: 'center' },
  dayList: { gap: DAY_GAP, alignItems: 'center', paddingVertical: STRIP_VERTICAL_PADDING },
  day: { height: DAY_CHIP_HEIGHT, width: DAY_CHIP_WIDTH, borderRadius: 16, borderWidth: 2, borderColor: 'transparent', gap: 1, backgroundColor: 'rgba(255,255,255,.07)', alignItems: 'center', justifyContent: 'center', paddingTop: 3, paddingBottom: 5 },
  daySelected: { backgroundColor: 'white' },
  dropDay: { transform: [{ scale: 1.08 }] },
  dayHighlight: { ...StyleSheet.absoluteFill, borderWidth: 2, borderRadius: 14 },
  weekday: { color: 'rgba(255,255,255,.65)', fontSize: APP_TEXT_SIZE.caption, fontWeight: '600' },
  date: { color: 'white', fontSize: APP_TEXT_SIZE.heading, fontWeight: '800', fontStyle: 'italic', fontVariant: ['tabular-nums'] },
  daySelectedText: { color: '#111' },
  color: { width: 14, height: 3, borderRadius: 2, marginTop: 1 },
  addDay: { width: DAY_CHIP_WIDTH, height: DAY_CHIP_HEIGHT, alignItems: 'center', justifyContent: 'center', borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,.3)' },
  selectAll: { minHeight: 44, justifyContent: 'center', alignItems: 'center', marginLeft: 6, marginRight: STRIP_TRAILING_INSET },
  selectAllPill: { minHeight: 34, paddingHorizontal: 14, borderRadius: 17, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.14)' },
  selectAllText: { fontWeight: '800', fontSize: APP_TEXT_SIZE.caption, letterSpacing: 0.5 },
  menu: { marginLeft: 6, marginRight: STRIP_TRAILING_INSET },
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
  dashed: { width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,.38)', backgroundColor: '#26302E', alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  addPill: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: 'rgba(255,255,255,.12)', flexDirection: 'row', alignItems: 'center', gap: 5 },
  addText: { color: 'white', fontSize: APP_TEXT_SIZE.caption, fontWeight: '700' },
  poolRow: { flexDirection: 'row', alignItems: 'center', minHeight: 50, borderRadius: 14, overflow: 'hidden', paddingLeft: 4, gap: 8 },
  poolTitle: { flex: 1, minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 12 },
  accommodationSection: { marginTop: 10, marginBottom: 6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 16, backgroundColor: '#ffffff12', borderWidth: 1, borderColor: '#ffffff2a' },
  accommodationTitle: { fontSize: APP_TEXT_SIZE.caption, fontWeight: '600', color: '#fff', paddingBottom: 2 },
  dropPreview: { position: 'absolute', borderRadius: 14, borderWidth: 1, opacity: 0.28 },
  dragged: { position: 'absolute', zIndex: 4, borderRadius: 14, backgroundColor: '#34423E', boxShadow: '0 12px 26px rgba(0,0,0,.4)' },
  popoverRoot: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: MAP_FLOATING_EDGE_INSET },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,.4)' },
  popoverSurface: { borderRadius: MAP_SHEET_CORNER_RADIUS, overflow: 'hidden', flexShrink: 1 },
  popover: { padding: SHEET_CORNER_ACTION_INSET, flexShrink: 1, minHeight: 0, backgroundColor: 'rgba(25,36,34,.75)' },
  nativePopover: { flex: 1, backgroundColor: 'transparent' },
  popoverHeader: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 8,
    ...sheetCornerHeaderInset(PRESENTED_SHEET_CONTENT_TOP + SHEET_CORNER_ACTION_INSET, SHEET_CORNER_ACTION_INSET) },
  popoverTitle: { flex: 1, minHeight: MAP_SHEET_ACTION_HIT_SIZE, paddingVertical: 13, color: '#fff', fontSize: APP_TEXT_SIZE.body, fontWeight: '700' },
  popoverBody: { flexGrow: 0, flexShrink: 1 },
  opaque: { backgroundColor: '#26302E' },
  menuRow: { minHeight: 51, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,.14)' },
  menuRowLast: { borderBottomWidth: 0 },
  error: { color: '#FF8E8E', marginTop: 8, fontSize: APP_TEXT_SIZE.caption },
});
