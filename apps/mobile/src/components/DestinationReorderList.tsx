import { useForegroundUi, isForegroundUi } from '../state/foregroundUi';
import React, { useCallback, useMemo, useRef, useState, memo } from 'react';
import { useMountEffect } from '../hooks/useMountEffect';
import {
  Animated,
  AccessibilityInfo,
  Easing,
  PanResponder,
  StyleSheet,
  View,
  Modal,
  Dimensions,
  useWindowDimensions,
  Platform,
  Alert,
} from 'react-native';
import { AppText as Text } from './AppText';
import Pressable from './MotionPressable';
import { useReducedMotion } from 'react-native-reanimated';
import { APP_TEXT_SIZE, APP_TEXT_LINE_HEIGHT, cappedFontScale } from '../theme/typeScale';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import type { Destination } from '../types';
import type { TourTargetId } from '../featureTour/constants';
import { radius, spacing, DAY_COLORS, type Palette } from '../theme';
import { accentOver, glass, shade } from '../glass';
import { readOnboardingState } from '../onboarding/sync';
import { usePreferences } from '../state/PreferencesContext';
import { useTranslation } from '../i18n';
import { dateForTripDay, localDayKey, parseDateOnlyLocal } from '../utils/tripDay';
import { clampDateNotBeforeToday, startOfTodayLocal } from '../utils/meetTime';
import {
  accommodationBoundaryLocks,
  applyPureIndexAnchors,
  dayCollapseStorageKey,
  DEFAULT_REORDER_LAYOUT,
  dragTargetIndexFromOffset,
  legalDragIndicesForList,
  moveDayHeaderBefore,
  orderAfterDragMove,
  reorderRowGeometry,
  sourceClosedReorderGeometry,
  snapToLegalDragIndex,
  shouldHighlightStayDuplicate,
  type AccommodationListItem,
  type MeasuredReorderGeometry,
  type ReorderListEntry,
} from '../utils/accommodationSemantics';
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
import { liquidGlass } from '../native';
import SettingsChildSheet from '../screens/MapScreen/components/SettingsChildSheet';
import OverflowMarquee from './OverflowMarquee';
import { classifyOperationError } from '../utils/operationError';

const REORDER_VISUAL_SCALE = 1;
const ROW_HEIGHT = 52;
const FAVORITE_TITLE_SIZE = 19;
const REORDER_LAYOUT = DEFAULT_REORDER_LAYOUT;
const REVEAL_WIDTH = Math.round(76 * REORDER_VISUAL_SCALE);
/** Fixed right-column width so day ≡ and stop ≡ share one vertical line. */
const HANDLE_SLOT = 44;
/** Low-sat terracotta for stay emoji badge (works on dark glass; not Day1 #E5575C). */
const STAY_BADGE_BG = '#8B6F6A';
/** Auto-scroll parent when finger is within this distance of screen edges. */
const DRAG_EDGE_PX = 160;
const DRAG_SCROLL_STEP = 22;

export type RouteInteractionMode = 'drag' | 'select' | 'none';

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
  activeDestinationId?: string;
  destinations: Destination[];
  canReorder: boolean;
  tripDays?: number;
  departureDate?: string;
  /** Subgroup leaders can reorder without editing shared trip dates. */
  showTripDetails?: boolean;
  onUpdateTripDetails?: (days: number, date: string) => void;
  onReorder?: (
    updates: { id: string; position: number; day: number | null; stayAnchor?: boolean }[],
  ) => void | Promise<boolean>;
  onDelete?: (id: string) => void;
  /** Per-stop emoji (+ optional markerColor). Day color is via day-header picker. */
  onUpdateEmojiColor?: (
    id: string,
    next: { emoji: string | null; markerColor?: string | null },
  ) => void | Promise<void>;
  /** Open KML/KMZ import sheet (replaces header sync CTA). */
  onImport?: () => void;
  colors: Palette;
  emptyLabel: string;
  dragHint?: string;
  onDragActiveChange?: (active: boolean) => void;
  onDragPreviewChange?: (preview: React.ReactNode | null) => void;
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
  /**
   * Stop-row interaction chrome (does not control day-header drag).
   * Default drag keeps ≡ handles visible.
   */
  interactionMode?: RouteInteractionMode;
  /** Multi-select ids when interactionMode === 'select'. */
  selectedIds?: string[];
  onSelectedIdsChange?: (ids: string[]) => void;
  /** Route reorder tour target registry; explanation-only, no action wiring. */
  onTourTargetRef?: (id: TourTargetId, node: View | null) => void;
}

type ListItem =
  | { type: 'header'; day: number; id: string; title: string; dateStr: string }
  | { type: 'dest'; item: Destination; id: string };

type DragPoint = { x: number; y: number };
type DragFrame = DragPoint & { width: number; height: number };
type DragKeyEvent = { nativeEvent: { key?: string }; preventDefault?: () => void };
type DragRowMotion = { close: Animated.Value; ripple: Animated.Value; pulse: Animated.CompositeAnimation | null };
type DragSession =
  | { phase: 'idle' }
  | {
      phase: 'dragging' | 'releasing' | 'settling' | 'cancelling';
      sourceId: string;
      sourceIndex: number;
      targetBoundary: number;
      input: 'pointer' | 'keyboard';
      entries: ReorderListEntry[];
      measured: MeasuredReorderGeometry;
      geometry: ReturnType<typeof reorderRowGeometry>;
      legalBoundaries: number[];
      scrollOffset: number;
      pointerDy: number;
      pointer: DragPoint | null;
      frame: DragFrame | null;
      bounds: DragFrame | null;
    };

function RouteDragSettlement({ session, rows, rowMotion, generation, currentGeneration, completion, previewPan, previewX, previewScale, lineScale, reducedMotion }: {
  session: Exclude<DragSession, { phase: 'idle' }>;
  rows: React.RefObject<Map<string, View>>;
  rowMotion: React.RefObject<Map<string, DragRowMotion>>;
  generation: number;
  currentGeneration: React.RefObject<number>;
  completion: React.RefObject<(() => void) | null>;
  previewPan: Animated.Value;
  previewX: Animated.Value;
  previewScale: Animated.Value;
  lineScale: Animated.Value;
  reducedMotion: boolean;
}) {
  useMountEffect(() => {
    const finish = () => {
      if (generation !== currentGeneration.current) return;
      completion.current?.();
      completion.current = null;
    };
    const row = rows.current.get(session.sourceId);
    const frame = session.frame;
    if (reducedMotion) { finish(); return; }
    const animateTo = (x: number, y: number) => {
      if (generation !== currentGeneration.current) return;
      Animated.parallel([
        ...[...rowMotion.current.values()].flatMap(motion => [
          Animated.spring(motion.close, { toValue: 0, stiffness: 300, damping: 26, mass: 0.8, useNativeDriver: true }),
          Animated.spring(motion.ripple, { toValue: 0, stiffness: 300, damping: 26, mass: 0.8, useNativeDriver: true }),
        ]),
        Animated.spring(previewPan, { toValue: y, stiffness: 300, damping: 26, mass: 0.8, useNativeDriver: true }),
        Animated.spring(previewX, { toValue: x, stiffness: 300, damping: 26, mass: 0.8, useNativeDriver: true }),
        Animated.spring(previewScale, { toValue: 1, stiffness: 300, damping: 26, mass: 0.8, useNativeDriver: true }),
        Animated.timing(lineScale, { toValue: 0, duration: 120, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]).start(finish);
    };
    if (row && frame) row.measureInWindow((x, y) => animateTo(x - frame.x, y - frame.y));
    else animateTo(0, 0);
    return () => {
      for (const value of [previewPan, previewX, previewScale, lineScale]) value.stopAnimation();
      finish();
    };
  });
  return null;
}

/**
 * Stable route shape used to reconcile an optimistic local drop with the
 * parent draft. It follows headers rather than trusting a destination's
 * stale `day` field while the ghost list is being committed.
 */
function listShapeSignature(list: readonly ListItem[]): string {
  let day = 1;
  let position = 0;
  return list
    .map((entry) => {
      if (entry.type === 'header') {
        day = entry.day;
        position = 0;
        return `h:${day}`;
      }
      const shape = `d:${entry.id}:${day}:${position}`;
      position += 1;
      return shape;
    })
    .join('|');
}

interface RouteListInteractionInput {
  activeId: string | null;
  canReorder: boolean;
  closeOpenSwipeable: () => void;
  interactionMode: RouteInteractionMode;
  setStayModeDay: number | null;
  foreground: boolean;
  endDragSession: () => void;
  dayDateLabel: (day: number) => string;
  destinations: Destination[];
  tripDays: number | undefined;
  t: ReturnType<typeof useTranslation>['t'];
}

interface RouteListInteractionOwner {
  input: RouteListInteractionInput | null;
  replay: boolean;
}

function RouteListInteractionCommit({ input, owner, autoScrollRaf, dragSession, pendingOrderSignature, setOrder }: {
  input: RouteListInteractionInput;
  owner: React.RefObject<RouteListInteractionOwner>;
  autoScrollRaf: React.RefObject<number | null>;
  dragSession: React.RefObject<DragSession>;
  pendingOrderSignature: React.RefObject<string | null>;
  setOrder: React.Dispatch<React.SetStateAction<ListItem[]>>;
}) {
  useMountEffect(() => {
    const previous = owner.current.input;
    const replay = owner.current.replay;
    const swipeChanged = replay || !previous || !Object.is(previous.activeId, input.activeId)
      || !Object.is(previous.canReorder, input.canReorder) || !Object.is(previous.closeOpenSwipeable, input.closeOpenSwipeable)
      || !Object.is(previous.interactionMode, input.interactionMode) || !Object.is(previous.setStayModeDay, input.setStayModeDay);
    const foregroundChanged = replay || !previous || !Object.is(previous.foreground, input.foreground)
      || !Object.is(previous.endDragSession, input.endDragSession);
    const projectionChanged = replay || !previous || !Object.is(previous.closeOpenSwipeable, input.closeOpenSwipeable)
      || !Object.is(previous.dayDateLabel, input.dayDateLabel) || !Object.is(previous.destinations, input.destinations)
      || !Object.is(previous.tripDays, input.tripDays) || !Object.is(previous.t, input.t);
    owner.current = { input, replay: false };
    if (foregroundChanged) {
      if (autoScrollRaf.current != null) cancelAnimationFrame(autoScrollRaf.current);
      autoScrollRaf.current = null;
    }
    if (swipeChanged && (input.activeId || input.interactionMode !== 'drag' || input.setStayModeDay != null || !input.canReorder)) {
      input.closeOpenSwipeable();
    }
    // End the drag before applying a same-commit route projection.
    if (foregroundChanged && !input.foreground) input.endDragSession();
    if (!projectionChanged) return;
    input.closeOpenSwipeable();
    if (dragSession.current.phase !== 'idle') return;
    const nextOrder: ListItem[] = [{ type: 'header', day: 0, id: 'header-pool', title: input.t('trip.pool'), dateStr: '' }];
    const days = Math.max(1, input.tripDays || 1);
    const sortedDests = [...input.destinations].sort((a, b) => {
      const dayA = a.day ?? 0;
      const dayB = b.day ?? 0;
      if (dayA !== dayB) return dayA - dayB;
      return a.order - b.order;
    });
    for (const dest of sortedDests.filter(dest => dest.day == null)) nextOrder.push({ type: 'dest', item: dest, id: dest.id });
    for (let d = 1; d <= days; d++) {
      nextOrder.push({ type: 'header', day: d, id: `header-${d}`, title: input.t('trip.dayTitle', { day: d }), dateStr: input.dayDateLabel(d) });
      for (const dest of sortedDests.filter(dest => dest.day === d)) nextOrder.push({ type: 'dest', item: dest, id: dest.id });
    }
    for (const dest of sortedDests.filter(dest => (dest.day ?? 0) > days)) nextOrder.push({ type: 'dest', item: dest, id: dest.id });
    const incomingSignature = listShapeSignature(nextOrder);
    const pendingSignature = pendingOrderSignature.current;
    if (pendingSignature && pendingSignature !== incomingSignature) return;
    pendingOrderSignature.current = null;
    setOrder(nextOrder);
  });
  return null;
}

function RouteDayCollapsePreferences({ accountId, groupId, departureDate, tripDays, setCollapsedDays }: {
  accountId: string | undefined;
  groupId: string | undefined;
  departureDate: string | undefined;
  tripDays: number | undefined;
  setCollapsedDays: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
}) {
  useMountEffect(() => {
    if (!accountId || !groupId || !departureDate || !tripDays) return;
    let cancelled = false;
    void (async () => {
      const next: Record<number, boolean> = {};
      for (let d = 1; d <= Math.max(1, tripDays); d++) {
        const date = dateForTripDay(departureDate, d);
        if (!date) continue;
        const key = dayCollapseStorageKey(accountId, groupId, localDayKey(date));
        try {
          const raw = await AsyncStorage.getItem(key);
          if (raw === '1') next[d] = true;
        } catch {
          // A failed local preference read leaves that day expanded.
        }
      }
      if (!cancelled) setCollapsedDays(next);
    })();
    return () => { cancelled = true; };
  });
  return null;
}

function OnboardingTripDefaults({ tripDays, canReorder, onUpdateTripDetails, setEditDays, setEditDate }: {
  tripDays: number | undefined;
  canReorder: boolean;
  onUpdateTripDetails: Props['onUpdateTripDetails'];
  setEditDays: React.Dispatch<React.SetStateAction<number>>;
  setEditDate: React.Dispatch<React.SetStateAction<Date>>;
}) {
  useMountEffect(() => {
    if (canReorder && !tripDays) {
      readOnboardingState().then((state) => {
        if (state?.completed && state.answers.days) {
          const dDays = state.answers.days;
          const dDate = state.answers.departureDate ?? new Date().toISOString();
          onUpdateTripDetails?.(dDays, dDate);
          setEditDays(dDays);
          setEditDate(parseDateOnlyLocal(dDate) ?? new Date());
        }
      }).catch(() => {});
    }
  });
  return null;
}

export default function DestinationReorderList({
  groupId,
  activeDestinationId,
  destinations,
  canReorder,
  tripDays,
  departureDate,
  showTripDetails = true,
  onUpdateTripDetails,
  onReorder,
  onDelete,
  onUpdateEmojiColor,
  onImport,
  colors,
  emptyLabel,
  dragHint,
  onDragActiveChange,
  onDragPreviewChange,
  onDragAutoScroll,
  dailyByDate,
  onClearDailyAccommodation,
  onSetDailyFromDestination,
  onQuickAddAccommodation,
  favoritePlaces,
  onPickFavorite,
  onDeleteFavorite,
  accountId,
  interactionMode = 'drag',
  selectedIds = [],
  onSelectedIdsChange,
  onTourTargetRef,
}: Props) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { fontScale } = useWindowDimensions();
  const favoriteIconSize = FAVORITE_TITLE_SIZE * cappedFontScale(fontScale);
  const reducedMotion = useReducedMotion();
  const { t } = useTranslation();
  const { dayColors, setDayColor, gatherCardTitleMarquee, gatherCardMarqueeSpeed } = usePreferences();
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const openSwipeableRef = useRef<SwipeableMethods | null>(null);
  const closeOpenSwipeable = useCallback(() => {
    openSwipeableRef.current?.close();
    openSwipeableRef.current = null;
  }, []);
  const handleSwipeableOpen = useCallback((swipeable: SwipeableMethods) => {
    if (openSwipeableRef.current && openSwipeableRef.current !== swipeable) {
      openSwipeableRef.current.close();
    }
    openSwipeableRef.current = swipeable;
  }, []);
  const handleSwipeableClose = useCallback((swipeable: SwipeableMethods) => {
    if (openSwipeableRef.current === swipeable) openSwipeableRef.current = null;
  }, []);
  const toggleSelectedId = useCallback(
    (id: string) => {
      if (!onSelectedIdsChange) return;
      if (selectedIdSet.has(id)) {
        onSelectedIdsChange(selectedIds.filter((x) => x !== id));
      } else {
        onSelectedIdsChange([...selectedIds, id]);
      }
    },
    [onSelectedIdsChange, selectedIdSet, selectedIds],
  );

  const [order, setOrder] = useState<ListItem[]>([]);
  const orderRef = useRef(order);
  orderRef.current = order;
  /**
   * After a local drop, keep the committed ghost visible until the parent
   * draft reflects the same route shape. This prevents the list briefly
   * reverting to the server snapshot during draft flush scheduling.
   */
  const pendingOrderSignatureRef = useRef<string | null>(null);

  const dragSession = useRef<DragSession>({ phase: 'idle' });
  const [, refreshDrag] = useState(0);
  const listView = useRef<View | null>(null);
  const foreground = useForegroundUi();
  const activeId = dragSession.current.phase === 'idle' ? null : dragSession.current.sourceId;
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
  }, [setColorPickerDay]);
  const autoScrollRafRef = useRef<number | null>(null);
  const pendingAutoScrollRef = useRef(0);
  const previewPan = useRef(new Animated.Value(0)).current;
  const previewX = useRef(new Animated.Value(0)).current;
  const previewScale = useRef(new Animated.Value(1)).current;
  const lineY = useRef(new Animated.Value(0)).current;
  const lineScale = useRef(new Animated.Value(0)).current;
  const rowMotion = useRef(new Map<string, DragRowMotion>());
  const dragGenerationRef = useRef(0);
  const settleCompletion = useRef<(() => void) | null>(null);
  const rowViewsRef = useRef(new Map<string, View>());
  const previewRowsRef = useRef(new Map<string, React.ReactElement>());
  /** onLayout heights so drag aim matches real header / stay / quick-add sizes. */
  const measuredHeightByIdRef = useRef(new Map<string, number>());
  const measuredGapByDayRef = useRef(new Map<number, number>());
  const [, setMeasureTick] = useState(0);

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
  const [editDays, setEditDays] = useState(tripDays ?? 1);
  const [editDate, setEditDate] = useState(parseDateOnlyLocal(departureDate) ?? new Date());
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
  const [moveDestinationId, setMoveDestinationId] = useState<string | null>(null);

  const endDragSession = useCallback(() => {
    dragSession.current = { phase: 'idle' };
    dragGenerationRef.current += 1;
    settleCompletion.current?.();
    settleCompletion.current = null;
    pendingAutoScrollRef.current = 0;
    if (autoScrollRafRef.current != null) cancelAnimationFrame(autoScrollRafRef.current);
    autoScrollRafRef.current = null;
    for (const motion of rowMotion.current.values()) {
      motion.pulse?.stop();
      motion.pulse = null;
      motion.close.stopAnimation();
      motion.ripple.stopAnimation();
      motion.close.setValue(0);
      motion.ripple.setValue(0);
    }
    for (const value of [previewPan, previewX, previewScale, lineY, lineScale]) value.stopAnimation();
    onDragActiveChange?.(false);
    onDragPreviewChange?.(null);
    refreshDrag(value => value + 1);
  }, [onDragActiveChange, onDragPreviewChange, previewPan, previewX, previewScale, lineY, lineScale]);

  const cancelDrag = useCallback(() => {
    const session = dragSession.current;
    if (session.phase !== 'dragging' && session.phase !== 'releasing') return;
    if (reducedMotion) { endDragSession(); return; }
    session.phase = 'cancelling';
    const generation = ++dragGenerationRef.current;
    if (autoScrollRafRef.current != null) cancelAnimationFrame(autoScrollRafRef.current);
    autoScrollRafRef.current = null;
    pendingAutoScrollRef.current = 0;
    refreshDrag(value => value + 1);
    Animated.parallel([
      ...[...rowMotion.current.values()].flatMap(motion => {
        motion.pulse?.stop();
        motion.pulse = null;
        motion.close.stopAnimation();
        motion.ripple.stopAnimation();
        return [
          Animated.spring(motion.close, { toValue: 0, stiffness: 300, damping: 26, mass: 0.8, useNativeDriver: true }),
          Animated.spring(motion.ripple, { toValue: 0, stiffness: 300, damping: 26, mass: 0.8, useNativeDriver: true }),
        ];
      }),
      Animated.spring(previewPan, { toValue: -session.scrollOffset, stiffness: 300, damping: 26, mass: 0.8, useNativeDriver: true }),
      Animated.spring(previewX, { toValue: 0, stiffness: 300, damping: 26, mass: 0.8, useNativeDriver: true }),
      Animated.spring(previewScale, { toValue: 1, stiffness: 300, damping: 26, mass: 0.8, useNativeDriver: true }),
      Animated.timing(lineScale, { toValue: 0, duration: 120, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished && generation === dragGenerationRef.current) endDragSession();
    });
  }, [reducedMotion, endDragSession, previewPan, previewX, previewScale, lineScale]);

  const interactionOwner = useRef<RouteListInteractionOwner>({ input: null, replay: true });
  useMountEffect(() => () => {
    interactionOwner.current.replay = true;
    endDragSession();
    if (autoScrollRafRef.current != null) cancelAnimationFrame(autoScrollRafRef.current);
    autoScrollRafRef.current = null;
  });

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
  }, [editDate, setEditDate]);

  const saveTripSettings = useCallback(() => {
    setShowSettings(false);
    const min = startOfTodayLocal();
    const existing = parseDateOnlyLocal(departureDate);
    const unchangedPast =
      existing
      && !Number.isNaN(existing.getTime())
      && editDate.getFullYear() === existing.getFullYear()
      && editDate.getMonth() === existing.getMonth()
      && editDate.getDate() === existing.getDate()
      && editDate.getTime() < min.getTime();
    const toSave = unchangedPast ? existing : clampDateNotBeforeToday(editDate);
    onUpdateTripDetails?.(editDays, toSave.toISOString());
  }, [departureDate, editDate, editDays, onUpdateTripDetails, setShowSettings]);

  const [collapseInput, setCollapseInput] = useState({ accountId, groupId, departureDate, tripDays, generation: 0 });
  if (!Object.is(collapseInput.accountId, accountId) || !Object.is(collapseInput.groupId, groupId)
    || !Object.is(collapseInput.departureDate, departureDate) || !Object.is(collapseInput.tripDays, tripDays)) {
    setCollapseInput({ accountId, groupId, departureDate, tripDays, generation: collapseInput.generation + 1 });
  }

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
    [accountId, groupId, departureDate, setCollapsedDays],
  );

  const stayDateForDay = useCallback(
    (day: number): string | null => {
      const date = dateForTripDay(departureDate, day);
      return date ? localDayKey(date) : null;
    },
    [departureDate],
  );

  const dayDateLabel = useCallback(
    (day: number): string => {
      if (!departureDate) return '';
      const dateObj = parseDateOnlyLocal(departureDate);
      if (!dateObj) return '';
      dateObj.setDate(dateObj.getDate() + (day - 1));
      return t('map.tripDayDate', {
        month: dateObj.getMonth() + 1,
        day: dateObj.getDate(),
      });
    },
    [departureDate, t],
  );

  const [onboardingInput, setOnboardingInput] = useState({ tripDays, canReorder, onUpdateTripDetails, generation: 0 });
  if (!Object.is(onboardingInput.tripDays, tripDays) || !Object.is(onboardingInput.canReorder, canReorder)
    || !Object.is(onboardingInput.onUpdateTripDetails, onUpdateTripDetails)) {
    setOnboardingInput({ tripDays, canReorder, onUpdateTripDetails, generation: onboardingInput.generation + 1 });
  }
  const [interactionInput, setInteractionInput] = useState({ activeId, canReorder, closeOpenSwipeable, interactionMode,
    setStayModeDay, foreground, endDragSession, dayDateLabel, destinations, tripDays, t, generation: 0 });
  if (!Object.is(interactionInput.activeId, activeId) || !Object.is(interactionInput.canReorder, canReorder)
    || !Object.is(interactionInput.closeOpenSwipeable, closeOpenSwipeable) || !Object.is(interactionInput.interactionMode, interactionMode)
    || !Object.is(interactionInput.setStayModeDay, setStayModeDay) || !Object.is(interactionInput.foreground, foreground)
    || !Object.is(interactionInput.endDragSession, endDragSession) || !Object.is(interactionInput.dayDateLabel, dayDateLabel)
    || !Object.is(interactionInput.destinations, destinations) || !Object.is(interactionInput.tripDays, tripDays)
    || !Object.is(interactionInput.t, t)) {
    setInteractionInput({ activeId, canReorder, closeOpenSwipeable, interactionMode, setStayModeDay, foreground,
      endDragSession, dayDateLabel, destinations, tripDays, t, generation: interactionInput.generation + 1 });
  }

  const toReorderEntries = useCallback((list: ListItem[]): ReorderListEntry[] => {
    let day = 0;
    return list.map((entry) => {
      if (entry.type === 'header') {
        day = entry.day;
        return { type: 'header' as const, day: entry.day, id: entry.id };
      }
      return {
        type: 'dest' as const,
        id: entry.item.id,
        day,
        kind: entry.item.kind === 'accommodation' ? 'accommodation' : 'stop',
        stayAnchor: entry.item.stayAnchor,
        title: entry.item.title,
      };
    });
  }, []);

  const showTarget = useCallback((target: number) => {
    const session = dragSession.current;
    if (session.phase !== 'dragging' && session.phase !== 'releasing') return;
    const previous = session.targetBoundary;
    if (previous === target) return;
    session.targetBoundary = target;
    const closed = reducedMotion ? session.geometry : sourceClosedReorderGeometry(session.geometry, session.sourceIndex);
    const y = target === session.entries.length ? closed.total : closed.tops[target];
    const hasGap = target !== session.sourceIndex && target !== session.sourceIndex + 1;
    lineScale.stopAnimation();
    if (!hasGap || reducedMotion) lineScale.setValue(hasGap ? 1 : 0);
    else Animated.timing(lineScale, { toValue: 1, duration: 180, easing: Easing.out(Easing.exp), useNativeDriver: true }).start();
    lineY.stopAnimation();
    if (reducedMotion) lineY.setValue(y);
    else Animated.timing(lineY, { toValue: y, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    if (previous !== target) {
      selectionTick();
      if (!reducedMotion) {
        for (const motion of rowMotion.current.values()) {
          motion.pulse?.stop();
          motion.pulse = null;
          motion.ripple.stopAnimation();
          motion.ripple.setValue(0);
        }
        if (!hasGap) return;
        const visible = session.entries.map((entry, index) => ({ entry, index }))
          .filter(({ index }) => index !== session.sourceIndex && session.geometry.rowHeights[index] > 0);
        const sides = [visible.filter(({ index }) => index < target).reverse(), visible.filter(({ index }) => index >= target)];
        sides.forEach((neighbors, side) => neighbors.slice(0, 7).forEach(({ entry }, distance) => {
          const motion = rowMotion.current.get(entry.id);
          if (!motion) return;
          motion.ripple.stopAnimation();
          motion.ripple.setValue(0);
          const pulse = Animated.sequence([
            Animated.delay(24 * distance),
            Animated.timing(motion.ripple, { toValue: (side === 0 ? -1 : 1) * 8 * Math.pow(0.7, distance), duration: 65, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.spring(motion.ripple, { toValue: 0, stiffness: 320, damping: 24, mass: 0.6, useNativeDriver: true }),
          ]);
          motion.pulse = pulse;
          pulse.start(() => { if (motion.pulse === pulse) motion.pulse = null; });
        }));
      }
    }
  }, [lineY, lineScale, reducedMotion]);

  const handleGrant = useCallback((id: string, pointer: DragPoint | null = null, input: 'pointer' | 'keyboard' = 'pointer') => {
    if (dragSession.current.phase !== 'idle') return;
    const sourceIndex = orderRef.current.findIndex(entry => entry.id === id);
    if (sourceIndex < 0) return;
    const entry = orderRef.current[sourceIndex];
    if (entry.type === 'header' && entry.day <= 1) return;
    closeOpenSwipeable();
    const generation = ++dragGenerationRef.current;
    const entries = toReorderEntries(orderRef.current);
    const heights = new Map<string, number>();
    const gaps = new Map<number, number>();
    let day = 0;
    for (const item of orderRef.current) {
      if (item.type === 'header') day = item.day;
      heights.set(item.id, item.type === 'dest' && collapsedDays[day] ? 0
        : measuredHeightByIdRef.current.get(item.id) ?? (item.type === 'header' ? REORDER_LAYOUT.headerHeight : REORDER_LAYOUT.rowHeight));
      if (item.type === 'header') {
        const stayDate = day > 0 ? stayDateForDay(day) : null;
        const quickAdd = !collapsedDays[day] && canReorder && onQuickAddAccommodation != null
          && entries.some(row => row.type === 'dest' && row.day === day) && Boolean(stayDate && dailyByDate?.[stayDate]);
        gaps.set(day, quickAdd ? (measuredGapByDayRef.current.get(day) ?? REORDER_LAYOUT.dayGapHeight) : 0);
      }
    }
    const measured = { heightById: heights, gapByDay: gaps };
    const geometry = reorderRowGeometry(entries, REORDER_LAYOUT, measured);
    const legal = legalDragIndicesForList(entries, id);
    dragSession.current = {
      phase: 'dragging', sourceId: id, sourceIndex, targetBoundary: sourceIndex, input,
      entries, measured, geometry, legalBoundaries: legal.length ? legal : [sourceIndex],
      pointer, scrollOffset: 0, pointerDy: 0, frame: null, bounds: null,
    };
    pendingAutoScrollRef.current = 0;
    onDragActiveChange?.(true);
    previewPan.setValue(0);
    previewX.setValue(reducedMotion ? 0 : 16);
    previewScale.setValue(1);
    lineY.setValue(geometry.tops[sourceIndex]);
    lineScale.setValue(0);
    if (!reducedMotion) {
      Animated.timing(previewScale, { toValue: 0.9, duration: 160, easing: Easing.out(Easing.exp), useNativeDriver: true }).start();
    }
    entries.forEach((row, index) => {
      const motion = rowMotion.current.get(row.id);
      if (!motion) return;
      const offset = !reducedMotion && index > sourceIndex ? -geometry.rowHeights[sourceIndex] : 0;
      if (reducedMotion) motion.close.setValue(offset);
      else Animated.timing(motion.close, { toValue: offset, duration: 180, easing: Easing.out(Easing.exp), useNativeDriver: true }).start();
    });
    for (const [id, motion] of rowMotion.current) {
      if (!id.startsWith('gap-')) continue;
      const gapDay = Number(id.slice(4));
      const lastIndex = entries.findLastIndex(row => row.day === gapDay);
      const offset = !reducedMotion && lastIndex >= sourceIndex ? -geometry.rowHeights[sourceIndex] : 0;
      if (reducedMotion) motion.close.setValue(offset);
      else Animated.timing(motion.close, { toValue: offset, duration: 180, easing: Easing.out(Easing.exp), useNativeDriver: true }).start();
    }
    refreshDrag(value => value + 1);
    listView.current?.measureInWindow((x, y, width, height) => {
      const current = dragSession.current;
      if (current.phase !== 'dragging' || generation !== dragGenerationRef.current) return;
      current.bounds = { x, y, width, height };
    });
    const preview = previewRowsRef.current.get(id);
    if (!reducedMotion && preview && onDragPreviewChange) {
      rowViewsRef.current.get(id)?.measureInWindow((x, y, width, height) => {
        const current = dragSession.current;
        if (current.phase !== 'dragging' || generation !== dragGenerationRef.current) return;
        current.frame = { x, y, width, height };
        onDragPreviewChange(
          <Animated.View pointerEvents="none" accessibilityElementsHidden testID="route-drag-preview"
            style={[styles.dragPreview, { position: 'absolute', left: x, top: y, width, height, zIndex: 1000,
              elevation: 1000, transform: [{ translateX: previewX }, { translateY: previewPan }, { scale: previewScale }] }]}>
            {preview}
          </Animated.View>,
        );
      });
    }
    selectionTick();
  }, [closeOpenSwipeable, toReorderEntries, collapsedDays, canReorder, onQuickAddAccommodation, stayDateForDay, dailyByDate,
    onDragActiveChange, onDragPreviewChange, reducedMotion, previewPan, previewX, previewScale, lineY, lineScale, styles]);

  const aimDrag = useCallback((session: Exclude<DragSession, { phase: 'idle' }>) => {
    const effectiveDy = session.pointerDy + session.scrollOffset;
    const raw = dragTargetIndexFromOffset(session.entries, session.sourceIndex, effectiveDy, REORDER_LAYOUT, session.measured, !reducedMotion);
    showTarget(snapToLegalDragIndex(session.legalBoundaries, raw, Math.sign(effectiveDy)));
  }, [showTarget, reducedMotion]);

  const handleMove = useCallback((id: string, dy: number, pageY?: number, dx = 0, pageX?: number) => {
    const session = dragSession.current;
    if (session.phase !== 'dragging' || session.sourceId !== id) return;
    session.pointerDy = dy;
    if (pageY != null && pageX != null) session.pointer = { x: pageX, y: pageY };
    if (pageY != null && onDragAutoScroll) {
      const winH = Dimensions.get('window').height;
      let step = 0;
      if (pageY < DRAG_EDGE_PX) {
        const proximity = 1 - pageY / DRAG_EDGE_PX;
        step = -Math.max(DRAG_SCROLL_STEP, Math.round(DRAG_SCROLL_STEP * (1 + proximity * 1.5)));
      } else if (pageY > winH - DRAG_EDGE_PX) {
        const proximity = 1 - (winH - pageY) / DRAG_EDGE_PX;
        step = Math.max(DRAG_SCROLL_STEP, Math.round(DRAG_SCROLL_STEP * (1 + proximity * 1.5)));
      }
      if (step !== 0) {
        pendingAutoScrollRef.current += step;
        if (autoScrollRafRef.current == null) autoScrollRafRef.current = requestAnimationFrame(() => {
          autoScrollRafRef.current = null;
          const delta = pendingAutoScrollRef.current;
          pendingAutoScrollRef.current = 0;
          if (!isForegroundUi() || dragSession.current.phase !== 'dragging' || delta === 0) return;
          onDragAutoScroll(delta);
          listView.current?.measureInWindow((_x, y) => {
            const current = dragSession.current;
            if (current !== session || current.phase !== 'dragging' || !current.bounds) return;
            current.scrollOffset = current.bounds.y - y;
            aimDrag(current);
          });
        });
      }
    }
    aimDrag(session);
    if (!reducedMotion) {
      previewPan.stopAnimation();
      previewX.stopAnimation();
      Animated.timing(previewPan, { toValue: dy, duration: 45, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
      Animated.timing(previewX, { toValue: dx + 16, duration: 45, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    }
  }, [onDragAutoScroll, aimDrag, reducedMotion, previewPan, previewX]);

  const handleRelease = useCallback(async (pointer?: DragPoint) => {
    const session = dragSession.current;
    if (session.phase !== 'dragging') return;
    if (pointer) {
      if (session.pointer) session.pointerDy += pointer.y - session.pointer.y;
      session.pointer = pointer;
    }
    session.phase = 'releasing';
    let bounds = session.bounds;
    if (listView.current) {
      bounds = await new Promise<DragFrame>(resolve => {
        listView.current?.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }));
      });
      if (dragSession.current !== session || session.phase !== 'releasing') return;
      if (session.bounds) session.scrollOffset = session.bounds.y - bounds.y;
    }
    if (session.input === 'pointer') aimDrag(session);
    const lastPointer = session.pointer;
    if (session.input === 'pointer' && bounds && lastPointer && (lastPointer.x < bounds.x || lastPointer.x > bounds.x + bounds.width
      || lastPointer.y < Math.max(0, bounds.y)
      || lastPointer.y > Math.min(Dimensions.get('window').height, bounds.y + bounds.height))) {
      cancelDrag();
      return;
    }
    session.phase = 'settling';
    const generation = dragGenerationRef.current;
    if (autoScrollRafRef.current != null) cancelAnimationFrame(autoScrollRafRef.current);
    autoScrollRafRef.current = null;
    pendingAutoScrollRef.current = 0;

    const previousOrder = [...orderRef.current];
    const updates: {
      id: string;
      position: number;
      day: number | null;
      stayAnchor?: boolean;
    }[] = [];
    try {
      const startIndex = session.sourceIndex;
      const target = session.targetBoundary;
      const moving = orderRef.current[startIndex];
      // Commit ghost drop once: single splice, single setOrder, no mid-drag thrash.
      if (target !== startIndex) {
        let next: ListItem[];
        if (moving?.type === 'header') {
          // Move only the day separator. Destination order is intentionally
          // unchanged; the new header positions determine each destination's
          // day after the drop.
          next = moveDayHeaderBefore(orderRef.current, startIndex, target);
          const movedIndex = next.findIndex(item => item.id === session.sourceId);
          let dayCounter = 0;
          next = next.map((item) => {
            if (item.type === 'header') {
              if (item.day === 0) return item;
              dayCounter += 1;
              return {
                ...item,
                day: dayCounter,
                id: `header-${dayCounter}`,
                title: t('trip.dayTitle', { day: dayCounter }),
                dateStr: dayDateLabel(dayCounter),
              };
            }
            // Stamp nested destination day from the preceding header.
            return {
              ...item,
              item: { ...item.item, day: dayCounter > 0 ? dayCounter : null },
            };
          });
          session.sourceId = next[movedIndex].id;
        } else {
          next = orderAfterDragMove(orderRef.current, startIndex, target);
        }
        pendingOrderSignatureRef.current = listShapeSignature(next);
        orderRef.current = next;
        setOrder(next);
      }
      const committedSignature = listShapeSignature(orderRef.current);

      const previousGeometry = reducedMotion ? session.geometry : sourceClosedReorderGeometry(session.geometry, startIndex);
      const nextEntries = toReorderEntries(orderRef.current);
      const nextGeometry = reorderRowGeometry(nextEntries, REORDER_LAYOUT, session.measured);
      for (const [id, motion] of rowMotion.current) {
        motion.pulse?.stop();
      motion.pulse = null;
      motion.close.stopAnimation();
        motion.ripple.stopAnimation();
        motion.ripple.setValue(0);
        const gapDay = id.startsWith('gap-') ? Number(id.slice(4)) : null;
        const previousIndex = gapDay == null ? session.entries.findIndex(entry => entry.id === id)
          : session.entries.findLastIndex(entry => entry.day === gapDay);
        const nextIndex = gapDay == null ? nextEntries.findIndex(entry => entry.id === id)
          : nextEntries.findLastIndex(entry => entry.day === gapDay);
        if (previousIndex < 0 || nextIndex < 0 || id === session.sourceId || reducedMotion) motion.close.setValue(0);
        else {
          const previousTop = previousGeometry.tops[previousIndex] + (gapDay == null ? 0 : previousGeometry.rowHeights[previousIndex]);
          const nextTop = nextGeometry.tops[nextIndex] + (gapDay == null ? 0 : nextGeometry.rowHeights[nextIndex]);
          motion.close.setValue(previousTop - nextTop);
        }
      }
      const settled = new Promise<void>(resolve => { settleCompletion.current = resolve; });
      refreshDrag(value => value + 1);

      let currentDay = 0;
      let position = 0;
      const byDay = new Map<number, AccommodationListItem[]>();
      for (const item of orderRef.current) {
        if (item.type === 'header') {
          currentDay = item.day;
        } else {
          updates.push({ id: item.id, position, day: currentDay || null });
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
          || orig.day !== u.day
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
        if (updates.some(update => update.id === activeDestinationId && update.day == null)) {
          pendingOrderSignatureRef.current = null;
          orderRef.current = previousOrder;
          setOrder(previousOrder);
          Alert.alert(t('map.setFailedTitle'), t('trip.endBeforePool'));
          return;
        }
        try {
          const ok = await onReorder?.(updates);
          if (ok === false) throw new Error('reorder_failed');
        } catch {
          if (pendingOrderSignatureRef.current === committedSignature) {
            pendingOrderSignatureRef.current = null;
            orderRef.current = previousOrder;
            setOrder(previousOrder);
          }
        }
      }
      await settled;
    } finally {
      // Unlock parent ScrollView even if update computation throws.
      if (generation === dragGenerationRef.current) endDragSession();
    }
  }, [dayDateLabel, onReorder, destinations, endDragSession, cancelDrag, t, activeDestinationId, reducedMotion, toReorderEntries, aimDrag]);

  const moveKeyboardTarget = (direction: number) => {
    const session = dragSession.current;
    if (session.phase !== 'dragging') return;
    const choices = session.legalBoundaries.filter(boundary => boundary !== session.sourceIndex + 1
      && (direction > 0 ? boundary > session.targetBoundary : boundary < session.targetBoundary));
    const target = direction > 0 ? choices[0] : choices.at(-1);
    if (target == null) return;
    showTarget(target);
    AccessibilityInfo.announceForAccessibility(isZh ? '已移動插入位置' : 'Insertion position moved');
  };
  const handleKey = (id: string, event: DragKeyEvent) => {
    const key = event.nativeEvent.key;
    if (![' ', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown'].includes(key ?? '')) return;
    event.preventDefault?.();
    if (key === 'Escape') { cancelDrag(); return; }
    const session = dragSession.current;
    if (key === ' ' || key === 'Enter') {
      if (session.phase === 'idle') {
        handleGrant(id, null, 'keyboard');
        AccessibilityInfo.announceForAccessibility(isZh ? '已提起，使用方向鍵移動，按 Enter 放下' : 'Picked up. Use arrow keys to move and Enter to drop.');
      } else if (session.phase === 'dragging' && session.sourceId === id) void handleRelease();
    } else if (session.phase === 'dragging' && session.sourceId === id && session.input === 'keyboard') {
      moveKeyboardTarget(key === 'ArrowDown' ? 1 : -1);
    }
  };
  const handleAccessibilityMove = (id: string, action: string) => {
    if (action === 'escape') { cancelDrag(); return; }
    if (action === 'activate') { handleKey(id, { nativeEvent: { key: 'Enter' } }); return; }
    if (action !== 'increment' && action !== 'decrement') return;
    if (dragSession.current.phase === 'idle') handleGrant(id, null, 'keyboard');
    moveKeyboardTarget(action === 'increment' ? 1 : -1);
    void handleRelease();
  };
  const keyboardHandlers = useRef({ handleKey });
  keyboardHandlers.current = { handleKey };
  useMountEffect(() => {
    if (Platform.OS !== 'web') return;
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') keyboardHandlers.current.handleKey('', { nativeEvent: { key: 'Escape' } });
    };
    document.addEventListener('keydown', cancelOnEscape);
    return () => document.removeEventListener('keydown', cancelOnEscape);
  });
  const projectionFor = (id: string) => {
    let motion = rowMotion.current.get(id);
    if (!motion) {
      motion = { close: new Animated.Value(0), ripple: new Animated.Value(0), pulse: null };
      rowMotion.current.set(id, motion);
    }
    return Animated.add(motion.close, motion.ripple);
  };

  const moveToDay = (id: string, day: number | null) => {
    const moving = destinations.find(item => item.id === id);
    if (!moving) return;
    const next = destinations.filter(item => item.id !== id);
    const last = next.findLastIndex(item => item.day === day);
    const firstLater = next.findIndex(item => (item.day ?? 0) > (day ?? 0));
    next.splice(last >= 0 ? last + 1 : firstLater >= 0 ? firstLater : next.length, 0, { ...moving, day });
    void Promise.resolve(onReorder?.(next.map((item, position) => ({ id: item.id, day: item.day, position }))))
      .catch(() => undefined);
  };

  const handlersRef = useRef({ handleGrant, handleMove, handleRelease });
  handlersRef.current = { handleGrant, handleMove, handleRelease };
  const onGrant = useCallback((id: string, pointer?: DragPoint) => handlersRef.current.handleGrant(id, pointer), []);
  const onMove = useCallback(
    (id: string, dy: number, pageY?: number, dx?: number, pageX?: number) =>
      handlersRef.current.handleMove(id, dy, pageY, dx, pageX),
    [],
  );
  const onRelease = useCallback((pointer?: DragPoint) => handlersRef.current.handleRelease(pointer), []);

  return (
    <View>
      {dragSession.current.phase === 'settling' ? <RouteDragSettlement key={dragGenerationRef.current}
        session={dragSession.current} rows={rowViewsRef} rowMotion={rowMotion} generation={dragGenerationRef.current}
        currentGeneration={dragGenerationRef} completion={settleCompletion}
        previewPan={previewPan} previewX={previewX} previewScale={previewScale} lineScale={lineScale} reducedMotion={reducedMotion} /> : null}
      <RouteListInteractionCommit key={`interaction-${interactionInput.generation}`} input={interactionInput} owner={interactionOwner}
        autoScrollRaf={autoScrollRafRef} dragSession={dragSession} pendingOrderSignature={pendingOrderSignatureRef} setOrder={setOrder} />
      <RouteDayCollapsePreferences key={`collapse-${collapseInput.generation}`} accountId={accountId} groupId={groupId}
        departureDate={departureDate} tripDays={tripDays} setCollapsedDays={setCollapsedDays} />
      <OnboardingTripDefaults key={`onboarding-${onboardingInput.generation}`} tripDays={tripDays} canReorder={canReorder}
        onUpdateTripDetails={onUpdateTripDetails} setEditDays={setEditDays} setEditDate={setEditDate} />
      {(canReorder || onImport) && (
        <View style={styles.topActions}>
          {canReorder && showTripDetails && <Pressable
            testID="route-trip-details"
            ref={(node) => onTourTargetRef?.('routeTripDetails', node)}
            style={[styles.setDaysBtn, { flex: 1.2 }]}
            onPress={() => {
            lightTap();
            setEditDays(tripDays ?? 1);
            setEditDate(parseDateOnlyLocal(departureDate) ?? new Date());
            setShowSettings(true);
          }}>
            <Ionicons name="calendar-outline" size={Math.round(16 * REORDER_VISUAL_SCALE)} color={colors.accent} style={{ marginRight: 6 }} />
            <Text style={styles.setDaysText} numberOfLines={1}>{t('trip.setDaysAndDate')}</Text>
          </Pressable>}
          {onPickFavorite ? (
            <Pressable
              ref={(node) => onTourTargetRef?.('routeFavorites', node)}
              style={[styles.setDaysBtn, { flex: 1.1 }]}
              onPress={() => {
                lightTap();
                setFavoritesOpen(true);
              }}
              accessibilityRole="button"
              accessibilityLabel={t('stay.favorites')}
              testID="route-favorites"
            >
              <Ionicons name="star-outline" size={Math.round(16 * REORDER_VISUAL_SCALE)} color={colors.accent} style={{ marginRight: 6 }} />
              <Text style={styles.setDaysText} numberOfLines={1}>{t('stay.favorites')}</Text>
            </Pressable>
          ) : null}
          {onImport && <Pressable
            ref={(node) => onTourTargetRef?.('routeImport', node)}
            style={[styles.setDaysBtn, { flex: 0.9 }]}
            onPress={() => {
              lightTap();
              onImport();
            }}
            accessibilityRole="button"
            accessibilityLabel={t('kml.entry')}
            testID="route-kml"
          >
            <Ionicons name="cloud-upload-outline" size={Math.round(16 * REORDER_VISUAL_SCALE)} color={colors.accent} style={{ marginRight: 6 }} />
            <Text style={styles.setDaysText} numberOfLines={1}>{t('kml.entry')}</Text>
          </Pressable>}

        </View>
      )}

      {order.length === 0 ? (
         <Text style={styles.empty}>{emptyLabel}</Text>
      ) : (
        <View ref={listView} style={styles.list} testID="route-reorder-list">
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

            const firstDayBlockIndex = blocks.findIndex((block) => block.kind === 'day' && block.header.day > 0);
            const firstAccommodationId = order.find(
              (item) => item.type === 'dest' && item.item.kind === 'accommodation',
            )?.id ?? null;
            const firstSetStayBlockIndex = blocks.findIndex((block) => {
              if (block.kind !== 'day' || block.dests.length === 0) return false;
              const stayDate = stayDateForDay(block.header.day);
              const hasDaily = Boolean(stayDate && dailyByDate?.[stayDate]);
              return !hasDaily;
            });

            const renderDestRow = (
              item: Extract<ListItem, { type: 'dest' }>,
              /** Day block this row is rendered under (may differ from item.day mid-drag). */
              blockDay?: number,
            ) => {
              const visualDay = blockDay ?? item.item.day ?? 0;
              if (collapsedDays[visualDay] || collapsedDays[item.item.day ?? 0]) return null;
              const dayColor = getColorForDay(visualDay, dayColors);
              const dayItems: AccommodationListItem[] = destinations
                .filter((d) => (d.day ?? 0) === visualDay)
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
              const isStayCard = item.item.kind === 'accommodation';
              const stayDate = visualDay > 0 ? stayDateForDay(visualDay) : null;
              const dailyAccommodation = stayDate && dailyByDate
                ? dailyByDate[stayDate]
                : undefined;
              const stayDuplicate = shouldHighlightStayDuplicate(
                {
                  kind: isStayCard ? 'accommodation' : 'stop',
                  title: item.item.title,
                  coordinates: item.item.coordinates,
                },
                dailyAccommodation
                  ? {
                      title: dailyAccommodation.title,
                      coordinates: dailyAccommodation.coordinates,
                    }
                  : undefined,
              );
              const multiSelectMode =
                canReorder && interactionMode === 'select' && !inSetMode;
              const canDragStop =
                canReorder && !locked && interactionMode === 'drag';
              const row = (
                <Row
                  key={item.id}
                  item={item.item}
                  onMoveTo={canReorder && item.item.kind !== 'accommodation'
                    ? () => setMoveDestinationId(item.item.id) : undefined}
                  active={!reducedMotion && activeId === item.id}
                  projection={projectionFor(item.id)}
                  onViewRef={(node) => { if (node) rowViewsRef.current.set(item.id, node); else rowViewsRef.current.delete(item.id); }}
                  canDrag={canDragStop}
                  canSwipeDelete={canReorder && !!onDelete && !locked && !inSetMode}
                  styles={styles}
                  gatherCardTitleMarquee={gatherCardTitleMarquee}
                  gatherCardMarqueeSpeed={gatherCardMarqueeSpeed}
                  dayColor={dayColor}
                  onGrant={onGrant}
                  onMove={onMove}
                  onRelease={onRelease}
                  onCancel={cancelDrag}
                  onHandleKey={handleKey}
                  onAccessibilityMove={handleAccessibilityMove}
                  onDelete={onDelete}
                  isAccommodation={isStayCard}
                  stayDuplicate={stayDuplicate}
                  boundaryLocked={locked}
                  // Stops and accommodation cards are both valid set-stay sources.
                  showSelect={inSetMode}
                  selectSelected={pendingStayDestId === item.item.id}
                  onSelectAsStay={
                    inSetMode
                      ? () => {
                          // Local draft only — commit on header「完成」.
                          // Commit deletes the source gathering point and keeps stay.
                          selectionTick();
                          setPendingStayDestId(item.item.id);
                        }
                      : undefined
                  }
                  multiSelect={multiSelectMode}
                  multiSelected={selectedIdSet.has(item.item.id)}
                  onSwipeableOpen={handleSwipeableOpen}
                  onSwipeableClose={handleSwipeableClose}
                  onToggleMultiSelect={
                    multiSelectMode
                      ? () => {
                          selectionTick();
                          toggleSelectedId(item.item.id);
                        }
                      : undefined
                  }
                  onLayoutHeight={(h) => recordMeasuredHeight(item.id, h)}
                  tourTargetRef={
                    firstAccommodationId === item.item.id
                      ? (node) => onTourTargetRef?.('routeAccommodation', node)
                      : undefined
                  }
                  onEmojiPress={
                    // Stay cards always show a fixed bed — no emoji picker.
                    canReorder
                    && onUpdateEmojiColor
                    && !isStayCard
                    && interactionMode !== 'select'
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
              previewRowsRef.current.set(item.id, React.cloneElement(row, {
                active: false, floating: true, canDrag: false, canSwipeDelete: false,
                onViewRef: undefined, tourTargetRef: undefined, onLayoutHeight: undefined, projection: undefined,
              }));
              return row;
            };

            const blockNodes = blocks.map((block, blockIndex) => {
              if (block.kind === 'orphan') {
                const row = renderDestRow(block.dest);
                return (
                  <React.Fragment key={block.dest.id}>
                    {row}
                  </React.Fragment>
                );
              }
              const item = block.header;
              const bgColor = getColorForDay(item.day, dayColors);
              const stayDate = item.day > 0 ? stayDateForDay(item.day) : null;
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
              const destNodes = !collapsed
                ? block.dests.map((destItem) => {
                    const row = renderDestRow(destItem, item.day);
                    return (
                      <React.Fragment key={destItem.id}>
                        {row}
                      </React.Fragment>
                    );
                  })
                : null;
              const header = (
                  <HeaderRow
                    item={item}
                    styles={styles}
                    bgColor={bgColor}
                    canEditColors={canReorder && item.day > 0}
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
                    onHandleKey={(event) => handleKey(item.id, event)}
                    onAccessibilityMove={(action) => handleAccessibilityMove(item.id, action)}
                    onHeaderGrant={
                      showDragAffordance
                        ? (pointer) => onGrant(item.id, pointer)
                        : undefined
                    }
                    onHeaderMove={
                      showDragAffordance
                        ? (dy, pageY, dx, pageX) => onMove(item.id, dy, pageY, dx, pageX)
                        : undefined
                    }
                    onHeaderRelease={
                      showDragAffordance ? (pointer) => onRelease(pointer) : undefined
                    }
                    onHeaderCancel={
                      showDragAffordance ? () => cancelDrag() : undefined
                    }
                    onViewRef={(node) => { if (node) rowViewsRef.current.set(item.id, node); else rowViewsRef.current.delete(item.id); }}
                    projection={projectionFor(item.id)}
                    headerActive={!reducedMotion && activeId === item.id}
                    setStayLabel={
                      canReorder
                      && item.day > 0
                      && !hasDaily
                      && onSetDailyFromDestination
                      && dayStopCount > 0
                        ? setStayModeDay === item.day
                          ? t('stay.finishSet')
                          : t('stay.setFromStop')
                        : undefined
                    }
                    setStayActive={setStayModeDay === item.day}
                    setStayCancelLabel={
                      setStayModeDay === item.day ? t('common.cancel') : undefined
                    }
                    onCancelSetStay={
                      setStayModeDay === item.day
                        ? () => {
                            lightTap();
                            setPendingStayDestId(null);
                            setSetStayModeDay(null);
                          }
                        : undefined
                    }
                    onToggleSetStay={
                      canReorder
                      && item.day > 0
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
                    tourTargetRef={
                      blockIndex === firstDayBlockIndex
                        ? (node) => onTourTargetRef?.('routeDate', node)
                        : undefined
                    }
                    accommodationTargetRef={
                      firstAccommodationId == null
                      && (
                        blockIndex === firstSetStayBlockIndex
                        || (firstSetStayBlockIndex === -1 && blockIndex === firstDayBlockIndex)
                      )
                        ? (node) => onTourTargetRef?.('routeAccommodation', node)
                        : undefined
                    }
                  />
              );
              const floatingHeader = React.cloneElement(header, {
                headerActive: false, onViewRef: undefined, tourTargetRef: undefined, projection: undefined,
                accommodationTargetRef: undefined, onLayoutHeight: undefined,
              });
              previewRowsRef.current.set(item.id,
                <View style={styles.floatingDay}>
                  {floatingHeader}
                </View>,
              );
              return (
                <View key={item.id} testID={`day-block-${item.day}`}>
                  {header}
                  {destNodes}
                  {/* Quick-add only when the day already has gathering points. */}
                  {showQuickAdd ? (
                    <Animated.View
                      style={[styles.dayActions, { transform: [{ translateY: projectionFor('gap-' + item.day) }] }]}
                      onLayout={(e) => recordMeasuredGap(item.day, e.nativeEvent.layout.height + spacing.xs + spacing.sm)}
                    >
                      <Pressable
                        style={styles.dashedBtn}
                        onPress={() => {
                          lightTap();
                          onQuickAddAccommodation(item.day);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={t('stay.quickAdd')}
                        testID={`route-quick-stay-${item.day}`}
                      >
                        <Text style={[styles.dashedBtnText, { color: colors.accent }]}>
                          {t('stay.quickAdd')}
                        </Text>
                      </Pressable>
                    </Animated.View>
                  ) : null}
                </View>
              );
            });
            return (
              <>
                {blockNodes}
                {activeId ? <Animated.View pointerEvents="none" testID="route-insertion-line"
                  style={[styles.dropLine, { backgroundColor: colors.textPrimary,
                    transform: [{ translateY: lineY }, { scaleX: lineScale }] }]} /> : null}
              </>
            );
          })()}
        </View>
      )}

      <SettingsChildSheet
        visible={favoritesOpen}
        onClose={() => setFavoritesOpen(false)}
        title={t('stay.favorites')}
        titleFontSize={FAVORITE_TITLE_SIZE}
        initialStage={1}
        stageTwoRatio={0.9}
      >
        <View style={styles.childSheetBody}>
            {(favoritePlaces ?? []).length === 0 ? (
              <Text maxFontSizeMultiplier={1.25} style={styles.favoriteEmpty}>{t('stay.noFavorites')}</Text>
            ) : (
              (favoritePlaces ?? []).map((fav) => (
                <View key={fav.id} style={styles.favoriteRow}>
                  <Pressable
                    style={styles.favoriteRowMain}
                    onPress={() => {
                      // New favorite places enter the pool; scheduling uses the same drag list.
                      onPickFavorite?.(fav, 0);
                      setFavoritesOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={fav.title}
                    testID={`route-favorite-${fav.id}`}
                  >
                    <Ionicons name="star" size={favoriteIconSize} color={colors.accent} />
                    <Text maxFontSizeMultiplier={1.25} style={styles.favoriteTitle}>{fav.title}</Text>
                  </Pressable>
                  {onDeleteFavorite ? (
                    <Pressable
                      onPress={() => {
                        lightTap();
                        onDeleteFavorite(fav);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={t('stay.unfavoriteA11y')}
                      testID={`route-unfavorite-${fav.id}`}
                      hitSlop={8}
                      style={styles.favoriteDeleteBtn}
                    >
                      <Ionicons name="trash-outline" size={favoriteIconSize} color="#FF5A5F" />
                    </Pressable>
                  ) : null}
                </View>
              ))
            )}
        </View>
      </SettingsChildSheet>

      <SettingsChildSheet visible={moveDestinationId != null} onClose={() => setMoveDestinationId(null)}
        title={t('trip.moveTo')} initialStage={1} stageTwoRatio={0.9}>
        <View style={styles.childSheetBody}>
          {[null, ...Array.from({ length: Math.max(1, tripDays ?? 1) }, (_, i) => i + 1)].map(day => (
            <Pressable key={day ?? 'pool'} style={styles.favRow} accessibilityRole="button"
              testID={`route-move-day-${day ?? 'pool'}`}
              disabled={day == null && moveDestinationId === activeDestinationId}
              onPress={() => {
                if (moveDestinationId) moveToDay(moveDestinationId, day);
                setMoveDestinationId(null);
              }}>
              <Text style={styles.favTitle}>{day == null ? t('trip.pool') : t('trip.dayTitle', { day })}</Text>
            </Pressable>
          ))}
        </View>
      </SettingsChildSheet>

      <SettingsChildSheet
        visible={showSettings}
        onClose={() => setShowSettings(false)}
        title={t('trip.setDaysTitle')}
        initialStage={1}
        stageTwoRatio={0.9}
        action="commit"
        onCommit={saveTripSettings}
      >
            <View style={styles.childSheetBody}>
               <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>{t('trip.departureDate')}</Text>
                  {Platform.OS === 'android' ? (
                    <Pressable testID="route-trip-date" onPress={openAndroidDatePicker} style={styles.datePickerButton}>
                      <Ionicons name="calendar-outline" size={18} color={colors.accent} />
                      <Text style={styles.datePickerText}>
                        {editDate.toLocaleDateString()}
                      </Text>
                    </Pressable>
                  ) : (
                    <DateTimePicker
                       testID="route-trip-date-picker"
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
                  <liquidGlass.GlassView glassStyle="regular" style={styles.daysControls}>
                     <Pressable testID="route-days-decrease" onPress={() => setEditDays(Math.max(1, editDays - 1))} style={styles.daysBtn}>
                        <Text style={styles.daysBtnText}>-</Text>
                     </Pressable>
                     <Text style={styles.daysValue}>{editDays}</Text>
                     <Pressable testID="route-days-increase" onPress={() => setEditDays(editDays + 1)} style={styles.daysBtn}>
                        <Text style={styles.daysBtnText}>+</Text>
                     </Pressable>
                  </liquidGlass.GlassView>
               </View>
            </View>
      </SettingsChildSheet>

      <Modal visible={colorPickerDay !== null} transparent animationType="fade">
         <Pressable style={styles.modalOverlay} onPress={() => setColorPickerDay(null)}>
            <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
               <liquidGlass.GlassView
                  glassStyle="regular"
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
               />
               <Text style={styles.modalTitle}>{t('trip.dayFlagColor', { day: colorPickerDay ?? 1 })}</Text>
               <View style={styles.colorPickerContainer}>
                  {DAY_COLORS.map(c => (
                     <Pressable
                        key={c}
                        testID={`route-day-color-${c}`}
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

            <View style={styles.emojiPinPreviewWrap} testID="dest-emoji-preview">
              <View style={styles.emojiPinPreview}>
                <View style={styles.emojiPinHead}>
                  <Text style={styles.emojiPinGlyph}>{emojiDraft}</Text>
                </View>
                <View style={styles.emojiPinStem} />
                <View style={styles.emojiPinDot} />
              </View>
            </View>

            <View style={styles.emojiCategoryRow}>
              {DESTINATION_EMOJI_CATEGORIES.map((cat) => {
                const selected = cat.id === emojiCategory;
                return (
                  <Pressable
                    key={cat.id}
                    testID={`route-emoji-category-${cat.id}`}
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
                    testID={`route-emoji-preset-${preset.emoji}`}
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
                        const classified = classifyOperationError(e);
                        console.warn('[destEmoji] save failed', {
                          kind: classified.kind,
                          code: classified.code,
                          status: classified.status,
                        });
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
  onHandleKey,
  onAccessibilityMove,
  onHeaderMove,
  onHeaderRelease,
  onHeaderCancel,
  headerActive,
  projection,
  setStayLabel,
  setStayActive,
  setStayCancelLabel,
  onCancelSetStay,
  onToggleSetStay,
  accent,
  onLayoutHeight,
  tourTargetRef,
  onViewRef,
  accommodationTargetRef,
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
  onHeaderGrant?: (pointer: DragPoint) => void;
  onHandleKey?: (event: DragKeyEvent) => void;
  onAccessibilityMove?: (action: string) => void;
  onHeaderMove?: (dy: number, pageY?: number, dx?: number, pageX?: number) => void;
  /** Finger released — commit drop. */
  onHeaderRelease?: (pointer?: DragPoint) => void;
  /** Gesture stolen/cancelled — do not commit. */
  onHeaderCancel?: () => void;
  headerActive?: boolean;
  projection?: ReturnType<typeof Animated.add>;
  /** Label for set-stay control placed after day title (not dashed). */
  setStayLabel?: string;
  setStayActive?: boolean;
  setStayCancelLabel?: string;
  onCancelSetStay?: () => void;
  onToggleSetStay?: () => void;
  accent: string;
  onLayoutHeight?: (height: number) => void;
  tourTargetRef?: (node: View | null) => void;
  onViewRef?: (node: View | null) => void;
  accommodationTargetRef?: (node: View | null) => void;
}) {
  const { t } = useTranslation();
  const hasStay = Boolean(dailyTitle);
  const handleCursor: object = { cursor: Platform.OS === 'web' && headerActive ? 'grabbing' : 'pointer' };
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
      onPanResponderGrant: (event) => onHeaderGrantRef.current?.({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }),
      onPanResponderMove: (_e, g) => onHeaderMoveRef.current?.(g.dy, g.moveY, g.dx, g.moveX),
      onPanResponderRelease: (event) => onHeaderReleaseRef.current?.({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }),
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
      ref={(node) => {
        const view = node as View | null;
        tourTargetRef?.(view);
        onViewRef?.(view);
        // If no set-stay control is rendered (for example, every day already
        // has a saved accommodation), keep the route tour target measurable
        // on the day header instead of silently blocking the six-step tour.
        if (hasStay || !onToggleSetStay || !setStayLabel) {
          accommodationTargetRef?.(view);
        }
      }}
      onLayout={(e) => onLayoutHeight?.(e.nativeEvent.layout.height)}
      style={{ opacity: headerActive ? 0 : 1, transform: [{ translateY: projection ?? 0 }] }}
      {...(canSwipeToggleAffordance ? swipeResponder.panHandlers : {})}
    >
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
              testID={`route-day-color-open-${item.day}`}
              disabled={!canEditColors}
              accessibilityRole={canEditColors ? 'button' : undefined}
              accessibilityLabel={canEditColors ? 'change day color' : undefined}
              style={[styles.colorDot, { backgroundColor: bgColor }]}
            />
            <Text style={styles.headerTitle}>{item.title}</Text>
            {!hasStay && onToggleSetStay && setStayLabel ? (
              <>
                <Pressable
                  ref={(node) => {
                    if (!hasStay) accommodationTargetRef?.(node);
                  }}
                  style={[
                    styles.headerSetStayBtn,
                    setStayActive && { backgroundColor: accent, borderColor: 'transparent' },
                  ]}
                  onPress={onToggleSetStay}
                  testID={`route-set-stay-${item.day}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: !!setStayActive }}
                  accessibilityLabel={setStayLabel}
                >
                  <Ionicons
                    name="bed-outline"
                    size={14}
                    color={setStayActive ? '#111' : accent}
                  />
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
                {setStayActive && setStayCancelLabel && onCancelSetStay ? (
                  <Pressable
                    style={styles.headerCancelStayBtn}
                    onPress={onCancelSetStay}
                    testID={`route-cancel-stay-${item.day}`}
                    accessibilityRole="button"
                    accessibilityLabel={setStayCancelLabel}
                  >
                    <Text style={styles.headerCancelStayText}>{setStayCancelLabel}</Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.headerDate}>{item.dateStr}</Text>
            {onToggleCollapse ? (
              <Pressable
                onPress={onToggleCollapse}
                accessibilityRole="button"
                hitSlop={8}
                style={{ marginLeft: 'auto' }}
              >
                <Ionicons name={collapsed ? 'chevron-down' : 'chevron-up'} size={16} color="#999" />
              </Pressable>
            ) : null}
            {canDragHeader ? (
              <View
                style={[styles.handleSlot, handleCursor]}
                focusable accessible accessibilityRole="adjustable" accessibilityLabel={item.title}
                accessibilityActions={[{ name: 'activate' }, { name: 'increment' }, { name: 'decrement' }, { name: 'escape' }]}
                onAccessibilityAction={(event) => onAccessibilityMove?.(event.nativeEvent.actionName)}
                {...(Platform.OS === 'web' ? { onKeyDown: onHandleKey } : {})}
                testID={'route-drag-handle-header-' + item.day}
                {...dragResponder.panHandlers}
                hitSlop={12}
              >
                <Text style={styles.handle}>≡</Text>
              </View>
            ) : null}
          </View>
        </View>
      </Animated.View>
      {hasStay ? (
        <View style={styles.headerStayRow}>
          <View style={styles.stayBadge}>
            <Ionicons name="bed-outline" size={12} color="#fff" />
            <Text style={styles.stayBadgeText} numberOfLines={1}>{dailyTitle}</Text>
          </View>
          {onRemoveDaily ? (
            <Pressable
              onPress={onRemoveDaily}
              testID={`route-remove-stay-${item.day}`}
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
  floating = false,
  projection,
  canDrag,
  canSwipeDelete,
  styles,
  dayColor,
  onGrant,
  onMove,
  onRelease,
  onCancel,
  onHandleKey,
  onAccessibilityMove,
  onDelete,
  onEmojiPress,
  isAccommodation,
  stayDuplicate,
  boundaryLocked,
  showSelect,
  selectSelected,
  onSelectAsStay,
  onMoveTo,
  multiSelect,
  multiSelected,
  onToggleMultiSelect,
  onLayoutHeight,
  tourTargetRef,
  onViewRef,
  onSwipeableOpen,
  onSwipeableClose,
  gatherCardTitleMarquee,
  gatherCardMarqueeSpeed,
}: {
  item: Destination;
  active: boolean;
  floating?: boolean;
  projection?: ReturnType<typeof Animated.add>;
  /** Vertical drag handle (interactionMode === 'drag'). */
  canDrag: boolean;
  /** Horizontal swipe-to-delete (independent of drag mode). */
  canSwipeDelete: boolean;
  styles: ReturnType<typeof makeStyles>;
  dayColor: string;
  onGrant: (id: string, pointer?: DragPoint) => void;
  onHandleKey?: (id: string, event: DragKeyEvent) => void;
  onAccessibilityMove?: (id: string, action: string) => void;
  onMove: (id: string, dy: number, pageY?: number, dx?: number, pageX?: number) => void;
  onRelease: (pointer?: DragPoint) => void;
  onCancel: () => void;
  onDelete?: (id: string) => void;
  onEmojiPress?: (id: string) => void;
  isAccommodation?: boolean;
  stayDuplicate?: boolean;
  /** Head/tail stay card: always-visible trash, no swipe-to-delete. */
  boundaryLocked?: boolean;
  showSelect?: boolean;
  /** Local pending stay selection (not yet committed). */
  selectSelected?: boolean;
  onSelectAsStay?: () => void;
  onMoveTo?: () => void;
  multiSelect?: boolean;
  multiSelected?: boolean;
  onToggleMultiSelect?: () => void;
  onLayoutHeight?: (height: number) => void;
  tourTargetRef?: (node: View | null) => void;
  onViewRef?: (node: View | null) => void;
  onSwipeableOpen?: (swipeable: SwipeableMethods) => void;
  onSwipeableClose?: (swipeable: SwipeableMethods) => void;
  gatherCardTitleMarquee: boolean;
  gatherCardMarqueeSpeed: number;
}) {
  // Boundary-locked stays use a permanent trash control — no horizontal swipe.
  const canSwipe = canSwipeDelete && !!onDelete && !boundaryLocked && !multiSelect;
  const handleCursor: object = { cursor: Platform.OS === 'web' && active ? 'grabbing' : 'pointer' };
  const canDragRef = useRef(canDrag);
  canDragRef.current = canDrag;
  const handleTouchRef = useRef(false);
  const swipeableRef = useRef<SwipeableMethods | null>(null);
  const itemIdRef = useRef(item.id);
  itemIdRef.current = item.id;
  const onGrantRef = useRef(onGrant);
  onGrantRef.current = onGrant;
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const onReleaseRef = useRef(onRelease);
  onReleaseRef.current = onRelease;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const { t } = useTranslation();

  const handleSwipeableOpen = useCallback(() => {
    selectionTick();
    if (swipeableRef.current) onSwipeableOpen?.(swipeableRef.current);
  }, [onSwipeableOpen]);
  const handleSwipeableClose = useCallback(() => {
    if (swipeableRef.current) onSwipeableClose?.(swipeableRef.current);
  }, [onSwipeableClose]);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => {
        handleTouchRef.current = canDragRef.current;
        return canDragRef.current;
      },
      onMoveShouldSetPanResponder: (_evt, g) =>
        handleTouchRef.current
        && canDragRef.current
        && Math.abs(g.dy) > 6
        && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        if (canDragRef.current) {
          onGrantRef.current(itemIdRef.current, { x: evt.nativeEvent.pageX, y: evt.nativeEvent.pageY });
        }
      },
      onPanResponderMove: (_evt, g) => {
        if (canDragRef.current) onMoveRef.current(itemIdRef.current, g.dy, g.moveY, g.dx, g.moveX);
      },
      onPanResponderRelease: (event) => {
        onReleaseRef.current({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY });
        handleTouchRef.current = false;
      },
      onPanResponderTerminate: () => {
        onCancelRef.current();
        handleTouchRef.current = false;
      },
    }),
  ).current;

  const renderRightActions = useCallback(
    (_progress: unknown, _translation: unknown, methods: SwipeableMethods) => (
      <View style={styles.deleteAction}>
        <Pressable
          testID={`delete-${item.id}`}
          onPress={() => {
            lightTap();
            methods.close();
            onDelete?.(item.id);
          }}
          accessibilityRole="button"
          accessibilityLabel={`${t('common.delete')} ${item.title}`}
          style={styles.deleteActionButton}
        >
          <Ionicons name="trash" size={20} color="#FFFFFF" />
          <Text style={styles.deleteActionText}>{t('common.delete')}</Text>
        </Pressable>
      </View>
    ),
    [item.id, item.title, onDelete, styles, t],
  );

  const rowContent = (
        <Animated.View
          testID={floating ? undefined : `route-drag-${item.id}`}
          style={[
            styles.row,
            !isAccommodation && stayDuplicate && styles.rowStayDuplicate,
            (active || floating) && styles.rowActive,
            floating && styles.rowFloating,
          ]}
        >
        {showSelect ? (
          <Pressable
            onPress={onSelectAsStay}
            testID={`route-select-stay-${item.id}`}
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
        ) : multiSelect ? (
          <Pressable
            onPress={onToggleMultiSelect}
            testID={`route-select-${item.id}`}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: !!multiSelected }}
            style={styles.selectRadio}
            hitSlop={8}
          >
            <Ionicons
              name={multiSelected ? 'checkbox' : 'square-outline'}
              size={22}
              color={multiSelected ? dayColor : colorsFallback(dayColor)}
            />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => {
            if (multiSelect && onToggleMultiSelect) {
              onToggleMultiSelect();
              return;
            }
            onEmojiPress?.(item.id);
          }}
          disabled={!onEmojiPress && !multiSelect}
          accessibilityRole={onEmojiPress || multiSelect ? 'button' : undefined}
          accessibilityLabel={onEmojiPress ? 'dest emoji' : undefined}
          testID={`route-emoji-${item.id}`}
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
        <Pressable
          style={styles.rowBody}
          testID={`route-move-${item.id}`}
          onPress={
            multiSelect && onToggleMultiSelect
              ? onToggleMultiSelect
              : onMoveTo
          }
          accessibilityRole="button"
          disabled={!multiSelect && !onMoveTo}
        >
          <OverflowMarquee
            text={item.title}
            enabled={gatherCardTitleMarquee}
            active
            activationDelayMs={1600}
            pixelsPerSecond={gatherCardMarqueeSpeed}
            style={styles.rowTitle}
            containerStyle={styles.rowTitleMarquee}
          />
        </Pressable>
        {boundaryLocked && onDelete && !multiSelect ? (
          <Pressable
            onPress={() => onDelete(item.id)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="delete"
            style={styles.inlineTrash}
          >
            <Ionicons name="trash-outline" size={20} color="#FF5A5F" />
          </Pressable>
        ) : canDrag || floating ? (
          <View style={[styles.handleSlot, handleCursor]}
            {...(canDrag ? responder.panHandlers : {})}
            {...(Platform.OS === 'web' ? { onKeyDown: (event: DragKeyEvent) => onHandleKey?.(item.id, event) } : {})}
            focusable={canDrag} accessible={canDrag} accessibilityRole="adjustable"
            accessibilityLabel={item.title}
            accessibilityActions={[{ name: 'activate' }, { name: 'increment' }, { name: 'decrement' }, { name: 'escape' }]}
            onAccessibilityAction={(event) => onAccessibilityMove?.(item.id, event.nativeEvent.actionName)}
            testID={floating ? undefined : 'route-drag-handle-' + item.id}>
            <Text style={styles.handle}>≡</Text>
          </View>
        ) : multiSelect ? (
          <View style={styles.handleSlot} />
        ) : null}
        </Animated.View>
  );

  return (
    <Animated.View
      ref={(node) => { tourTargetRef?.(node as View | null); onViewRef?.(node as View | null); }}
      style={{ opacity: active ? 0 : 1, transform: [{ translateY: projection ?? 0 }] }}
      onLayout={(e) => onLayoutHeight?.(e.nativeEvent.layout.height)}
    >
      {floating ? rowContent : <ReanimatedSwipeable
        ref={swipeableRef}
        testID={`route-swipe-${item.id}`}
        enabled={canSwipe && !active}
        friction={1}
        rightThreshold={38}
        dragOffsetFromRightEdge={10}
        overshootRight={false}
        enableTrackpadTwoFingerGesture
        renderRightActions={renderRightActions}
        onSwipeableOpen={handleSwipeableOpen}
        onSwipeableClose={handleSwipeableClose}
        containerStyle={styles.swipeableContainer}
        childrenContainerStyle={styles.swipeableChildren}
      >

        {rowContent}
      </ReanimatedSwipeable>}
    </Animated.View>
  );
});

/** Dim checkbox outline when unchecked (day color may be bright). */
function colorsFallback(_dayColor: string): string {
  return 'rgba(255,255,255,0.45)';
}
const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    topActions: {
      flexDirection: 'row',
      paddingHorizontal: 12,
      paddingVertical: 8,
      flexWrap: 'nowrap',
      gap: 6,
      marginBottom: spacing.sm,
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
      backgroundColor: glass.fill,
      paddingVertical: 10,
      alignItems: 'center',
    },
    dashedBtnText: { fontSize: APP_TEXT_SIZE.caption, fontWeight: '600' },
    headerSetStayBtn: {
      borderWidth: 1,
      borderColor: 'rgba(255,107,53,0.55)',
      borderRadius: 14,
      paddingHorizontal: 10,
      paddingVertical: 5,
      minHeight: 28,
      maxWidth: 200,
      justifyContent: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    headerSetStayText: { fontSize: APP_TEXT_SIZE.caption, fontWeight: '700' },
    dropLine: {
      position: 'absolute',
      top: 0,
      left: spacing.sm,
      right: spacing.sm,
      height: 1.5,
      borderRadius: 1,
      opacity: 0.15,
      zIndex: 10,
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
    removeStayText: { color: colors.accent, fontSize: APP_TEXT_SIZE.caption, fontWeight: '600' },
    headerCancelStayBtn: {
      minHeight: 28,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.28)',
      justifyContent: 'center',
    },
    headerCancelStayText: { color: colors.textSecondary, fontSize: APP_TEXT_SIZE.caption, fontWeight: '700' },
    /** Stay duplicate warning: muted theme accent over a darkened surface. */
    rowStayDuplicate: {
      backgroundColor: accentOver(colors.accent, shade(colors.surface, -0.20), 28),
    },
    // Stay cards share left alignment with gathering-point rows.
    rowTitleStay: { textAlign: 'left' },
    selectRadio: { marginRight: 8 },
    favRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
    },
    favoriteRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    favoriteRowMain: {
      flex: 1,
      minWidth: 0,
      minHeight: 60,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    favoriteDeleteBtn: {
      minWidth: 48,
      minHeight: 60,
      paddingHorizontal: 8,
      paddingVertical: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    favoriteTitle: { color: colors.textPrimary, fontSize: FAVORITE_TITLE_SIZE, flex: 1, minWidth: 0 },
    favoriteEmpty: { color: colors.textSecondary, fontSize: FAVORITE_TITLE_SIZE, paddingVertical: spacing.md },
    favTitle: { color: colors.textPrimary, fontSize: APP_TEXT_SIZE.caption, flex: 1 },
    hint: {
      color: colors.textSecondary,
      fontSize: APP_TEXT_SIZE.caption,
      marginBottom: spacing.sm,
    },
    empty: {
      color: colors.textSecondary,
      fontSize: APP_TEXT_SIZE.caption,
      paddingVertical: spacing.md,
    },
    list: {
      borderRadius: 16,
      backgroundColor: 'transparent',
      overflow: 'hidden',
    },
    headerRow: {
      minHeight: ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      backgroundColor: glass.fill,
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
      // Match stop rows: no extra right inset so ≡ columns share one edge.
      paddingRight: 0,
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
      backgroundColor: glass.fill,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      gap: 8,
    },
    headerTitle: {
      color: colors.textPrimary,
      fontSize: APP_TEXT_SIZE.caption,
      fontWeight: '600',
    },
    headerDate: {
      color: colors.textSecondary,
      fontSize: Math.round(14 * REORDER_VISUAL_SCALE),
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
      borderBottomColor: glass.hairline,
      backgroundColor: glass.fill,
    },
    swipeableContainer: { overflow: 'hidden' },
    swipeableChildren: { flex: 1 },
    deleteAction: {
      width: REVEAL_WIDTH,
      height: '100%',
      backgroundColor: '#FF3B30',
      alignItems: 'center',
      justifyContent: 'center',
    },
    deleteActionButton: {
      width: REVEAL_WIDTH,
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    deleteActionText: {
      color: '#FFFFFF',
      fontSize: APP_TEXT_SIZE.caption,
      fontWeight: '600',
    },
    dragPreview: {
      backgroundColor: '#343B48', borderRadius: 16,
      shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 5 },
    },
    floatingDay: { backgroundColor: '#343B48', borderRadius: 16, overflow: 'hidden' },
    rowFloating: { backgroundColor: '#343B48', borderBottomWidth: 0 },
    rowActive: {
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.accent,
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
    },
    rowIndex: {
      color: colors.accent,
      fontSize: Math.round(15 * REORDER_VISUAL_SCALE),
      fontWeight: '700',
      width: Math.round(20 * REORDER_VISUAL_SCALE),
      textAlign: 'center',
    },
    rowBody: {
      flex: 1,
      minWidth: 0,
      height: '100%',
      justifyContent: 'center',
    },
    rowTitleMarquee: { flex: 0, minWidth: 0, alignSelf: 'stretch' },
    rowTitle: { color: '#FFFFFF', fontSize: APP_TEXT_SIZE.caption, lineHeight: APP_TEXT_LINE_HEIGHT.caption, fontWeight: '600' },
    rowAddress: { color: colors.textSecondary, fontSize: Math.round(13 * REORDER_VISUAL_SCALE), marginTop: 2 },
    emojiBadge: {
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 4,
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
    handleSlot: {
      width: HANDLE_SLOT,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    handle: {
      color: colors.textSecondary,
      fontSize: Math.round(22 * REORDER_VISUAL_SCALE),
      textAlign: 'center',
      width: HANDLE_SLOT,
    },
    setDaysBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 36,
      paddingVertical: 8,
      paddingHorizontal: 8,
      backgroundColor: 'rgba(255,255,255,0.06)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.1)',
      borderRadius: 9,
      minWidth: 0,
    },
    setDaysText: {
      color: colors.accent,
      fontWeight: '600',
      fontSize: APP_TEXT_SIZE.caption,
      flexShrink: 1,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    modalCard: {
      backgroundColor: 'transparent',
      borderRadius: radius.lg,
      overflow: 'hidden',
      padding: spacing.xl,
      width: '80%',
    },
    childSheetBody: {
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.xl,
      gap: spacing.md,
    },
    modalTitle: {
      fontSize: APP_TEXT_SIZE.body,
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
          fontSize: APP_TEXT_SIZE.caption,
          color: colors.textPrimary,
        },
        datePickerButton: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.xs,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs,
          borderRadius: radius.md,
      backgroundColor: glass.fill,
        },
        datePickerText: {
          color: colors.textPrimary,
          fontSize: APP_TEXT_SIZE.caption,
        },
    daysControls: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: radius.md,
      overflow: 'hidden',
    },
    daysBtn: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      backgroundColor: colors.border,
    },
    daysBtnText: {
      fontSize: APP_TEXT_SIZE.body,
      fontWeight: 'bold',
      color: colors.textPrimary,
    },
    daysValue: {
      fontSize: APP_TEXT_SIZE.caption,
      fontWeight: 'bold',
      color: colors.textPrimary,
      paddingHorizontal: 16,
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
