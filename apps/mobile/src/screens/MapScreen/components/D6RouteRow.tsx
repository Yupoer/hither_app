import { APP_TEXT_SIZE } from '../../../theme/typeScale';
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useContext, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { AppText as Text } from '../../../components/AppText';
import Pressable from '../../../components/MotionPressable';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import ReanimatedSwipeable, { SwipeDirection, type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { runOnJS, useAnimatedRef, useAnimatedStyle, useSharedValue, withTiming, type AnimatedRef, type SharedValue } from 'react-native-reanimated';
import { useMountEffect } from '../../../hooks/useMountEffect';
import { destinationEmojiDisplay } from '../../../utils/destinationEmojiColor';
import { lightTap } from '../../../utils/haptics';
import type { D6RouteRow as RouteRow } from '../d6Itinerary';
import { D6PaneInteractionContext } from './D6PaneInteraction';
import { guardGesture } from './d6GestureGuard';
import { claimD6Drag, releaseD6Drag, type D6DragOwner } from './d6DragOwnership';
import type { D6DragGeometry, D6DragPresentation, D6Point } from './d6RouteDrag';

const SWIPE_ACTION_GAP = 6;
const SWIPE_ACTION_INSET = 2;
const SWIPE_ACTION_HEIGHT = 44;
const DELETE_ACTION_WIDTH = 62;
const POOL_ACTION_WIDTH = 80;
const SWIPE_ACTIONS_WIDTH = POOL_ACTION_WIDTH + DELETE_ACTION_WIDTH + SWIPE_ACTION_GAP + 2 * SWIPE_ACTION_INSET;
const DRAG_HANDLE_WIDTH = 44;

export type D6RouteDrag = {
  owner: SharedValue<D6DragOwner>;
  point: SharedValue<D6Point>;
  presentation: SharedValue<D6DragPresentation | null>;
  sequence: SharedValue<number>;
  geometry: () => D6DragGeometry | null;
  onStart: (token: number, point: D6Point, geometry: D6DragGeometry) => void;
  onEnd: (token: number, point: D6Point) => void;
  onCancel: (token: number) => void;
  onStep: (step: -1 | 1) => void;
};

export function D6RouteRow({
  row,
  color,
  accent,
  active,
  connectAbove,
  connectBelow,
  selected,
  drag,
  insertion,
  removing,
  flash,
  completed,
  chinese,
  onOpen,
  onSelect,
  onPool,
  onDelete,
  onSwipe,
  measureRef,
}: {
  row: RouteRow;
  color: string;
  accent: string;
  active?: boolean;
  connectAbove?: boolean;
  connectBelow?: boolean;
  selected?: boolean;
  drag?: D6RouteDrag;
  insertion?: 'above' | 'below';
  removing?: boolean;
  flash?: boolean;
  completed?: boolean;
  chinese: boolean;
  onOpen?: () => void;
  onSelect?: () => void;
  onPool?: () => void;
  onDelete?: () => void;
  onSwipe?: (methods: SwipeableMethods) => void;
  measureRef?: (id: string, element: AnimatedRef<View> | null) => void;
}) {
  const panel = useContext(D6PaneInteractionContext);
  const canSwipe = !!onDelete && !!onPool;
  const [swipePhase, setSwipePhase] = useState<'idle' | 'dragging' | 'open'>('idle');
  if (!canSwipe && swipePhase !== 'idle') setSwipePhase('idle');
  const hideHandle = canSwipe && swipePhase !== 'idle';
  const measuredRef = useAnimatedRef<View>();
  const acquired = useSharedValue<number | null>(null);
  const [handlers] = useState(createD6RouteDragCallbacks);
  const bindDrag = useCallback((view: View | null) => {
    handlers.commit(view ? drag : undefined);
  }, [drag, handlers]);
  useMountEffect(() => () => handlers.commit(undefined));
  const owner = drag?.owner;
  const dragPoint = drag?.point;
  const presentation = drag?.presentation;
  const sequence = drag?.sequence;
  const sourceId = row.id;
  const geometryForDrag = drag?.geometry;
  const paneGesture = panel?.paneGesture;
  const scrollGesture = panel?.scrollGesture;
  useMountEffect(() => {
    measureRef?.(row.id, measuredRef);
    return () => measureRef?.(row.id, null);
  });
  const reorderGesture = useMemo(() => {
    const finishReorder = (success: boolean, point: D6Point | null) => {
      'worklet';
      const token = acquired.get();
      if (!owner || !presentation || token === null) return;
      acquired.set(null);
      if (presentation.get()?.token === token) {
        presentation.set(null);
        releaseD6Drag(owner, 'reorder');
      }
      if (success && point) runOnJS(handlers.end)(token, point);
      else runOnJS(handlers.cancel)(token);
    };
    const cancelReorder = () => {
      'worklet';
      finishReorder(false, null);
    };
    const gesture = Gesture.Pan().enabled(!!owner && !hideHandle)
      .activateAfterLongPress(250)
      .maxPointers(1)
      .onTouchesDown(guardGesture('reorder-down', (_event: unknown, manager: { fail: () => void }) => {
        'worklet';
        if (owner && owner.get() !== 'idle') manager.fail();
      }, cancelReorder))
      .onStart(guardGesture('reorder-start', ({ absoluteX, absoluteY }: { absoluteX: number; absoluteY: number }) => {
        'worklet';
        if (!owner || !dragPoint || !presentation || !sequence || !geometryForDrag) return;
        const geometry = geometryForDrag();
        if (!geometry || !claimD6Drag(owner, 'reorder')) return;
        const point = { x: absoluteX, y: absoluteY };
        const token = sequence.get() + 1;
        sequence.set(token);
        acquired.set(token);
        dragPoint.set(point);
        presentation.set({ token, sourceId, geometry,
          offset: { x: point.x - geometry.source.x, y: point.y - geometry.source.y } });
        runOnJS(handlers.start)(token, point, geometry);
      }, cancelReorder))
      .onUpdate(guardGesture('reorder-update', ({ absoluteX, absoluteY }: { absoluteX: number; absoluteY: number }) => {
        'worklet';
        if (!owner || !dragPoint || !presentation || acquired.get() === null
          || presentation.get()?.token !== acquired.get() || owner.get() !== 'reorder') return;
        dragPoint.set({ x: absoluteX, y: absoluteY });
      }, cancelReorder))
      .onEnd(guardGesture('reorder-end', ({ absoluteX, absoluteY }: { absoluteX: number; absoluteY: number }, success: boolean) => {
        'worklet';
        finishReorder(success, { x: absoluteX, y: absoluteY });
      }, cancelReorder))
      .onFinalize(guardGesture('reorder-finalize', cancelReorder, cancelReorder));
    if (paneGesture && scrollGesture) gesture.blocksExternalGesture(paneGesture, scrollGesture);
    return gesture;
  }, [owner, dragPoint, presentation, sequence, sourceId, geometryForDrag, paneGesture, scrollGesture, acquired, handlers, hideHandle]);
  const sourceStyle = useAnimatedStyle(() => ({ opacity: presentation?.get()?.sourceId === sourceId ? 0.25 : 1 }));
  const swipe = useRef<SwipeableMethods | null>(null);
  const openOffset = useSharedValue(0);
  const dragOffset = useSharedValue(0);
  const closingBySwipe = useRef(false);
  const bindSwipe = useCallback((methods: SwipeableMethods | null) => {
    swipe.current = methods;
    if (!methods) {
      openOffset.set(0);
      closingBySwipe.current = false;
    }
  }, [openOffset]);
  const beginOpening = useCallback((direction: SwipeDirection) => {
    if (direction !== SwipeDirection.LEFT) return;
    setSwipePhase('dragging');
    if (swipe.current) onSwipe?.(swipe.current);
  }, [onSwipe]);
  const beginClosing = useCallback(() => {
    closingBySwipe.current = true;
    setSwipePhase('dragging');
  }, []);
  const willOpen = useCallback(() => {
    closingBySwipe.current = false;
    if (openOffset.get() === 0) lightTap();
    openOffset.set(-SWIPE_ACTIONS_WIDTH);
  }, [openOffset]);
  const willClose = useCallback(() => {
    if (closingBySwipe.current && openOffset.get() !== 0) lightTap();
    closingBySwipe.current = false;
    openOffset.set(0);
    setSwipePhase((phase) => phase === 'open' ? 'dragging' : phase);
  }, [openOffset]);
  const didOpen = useCallback(() => setSwipePhase('open'), []);
  const didClose = useCallback(() => setSwipePhase('idle'), []);
  const fullSwipe = useMemo(() => {
    return Gesture.Pan()
      .activeOffsetX(-10)
      .failOffsetY([-10, 10])
      .maxPointers(1)
      .onStart(() => { dragOffset.set(openOffset.get()); })
      .onEnd(({ translationX }, success) => {
        if (success && onDelete && translationX + dragOffset.get() < -230) runOnJS(onDelete)();
      });
  }, [dragOffset, onDelete, openOffset]);
  const { title, time, emoji } = routeRowDisplay(row);
  const collapse = useSharedValue(1);
  const height = useSharedValue(54);
  const collapseStyle = useAnimatedStyle(() => {
    const fraction = collapse.get();
    return fraction < 1 ? { height: height.get() * fraction, opacity: fraction } : {};
  });

  const mainAction = (
      <Pressable
        testID={`d6-route-row-${row.id}`}
        style={[styles.rowPressable, drag && styles.rowWithHandle]}
        onPress={onOpen}
        onLongPress={onSelect}
        delayLongPress={500}
        accessibilityRole={selected === undefined ? onOpen ? 'button' : undefined : 'checkbox'}
        accessibilityState={selected === undefined ? undefined : { checked: selected }}
        accessibilityLabel={time ? `${title} ${time}` : title}
        accessibilityActions={onPool && onDelete ? [
          { name: 'pool', label: chinese ? '移到待排' : 'Move to unplanned' },
          { name: 'delete', label: chinese ? '刪除' : 'Delete' },
        ] : undefined}
        onAccessibilityAction={({ nativeEvent: { actionName } }) => {
          if (actionName === 'pool') onPool?.();
          if (actionName === 'delete') onDelete?.();
        }}
      >
        <View style={[
          styles.badgeRim,
          active && { borderColor: accent },
          selected !== undefined && styles.selectionRim,
        ]}>
          <View style={[
            styles.badge,
            { backgroundColor: color },
            selected !== undefined && [styles.selectionCircle, selected && styles.selectedCircle],
          ]}>
            {selected === undefined ? <Text style={styles.icon}>{emoji}</Text> : selected
              ? <Ionicons name="checkmark" size={15} color="#151D1B" /> : null}
          </View>
        </View>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {time ? <Text style={styles.time}>{time}</Text> : null}
      </Pressable>
  );
  const content = (
    <View style={[
      styles.row, completed && styles.completed,
      selected !== undefined && styles.selectionRow,
      selected && { backgroundColor: `${accent}2E` },
    ]} onLayout={(event) => height.set(event.nativeEvent.layout.height)}>
      {selected === undefined && (connectAbove || connectBelow) ? <View pointerEvents="none" style={[
        styles.connector, { backgroundColor: color, top: connectAbove ? 0 : '50%', bottom: connectBelow ? 0 : '50%' },
      ]} /> : null}
      {flash ? <D6RowFlash accent={accent} /> : null}
      <View style={styles.swipeBody}>
        {onDelete && onPool ? (
          <GestureDetector gesture={fullSwipe}>
            <View collapsable={false}>
              <ReanimatedSwipeable
                ref={bindSwipe}
                friction={1.4}
                overshootFriction={8}
                dragOffsetFromRightEdge={10}
                rightThreshold={48}
                simultaneousWithExternalGesture={fullSwipe}
                onSwipeableOpenStartDrag={beginOpening}
                onSwipeableCloseStartDrag={beginClosing}
                onSwipeableWillOpen={willOpen}
                onSwipeableWillClose={willClose}
                onSwipeableOpen={didOpen}
                onSwipeableClose={didClose}
                renderRightActions={(_progress, translate, methods) => (
                  <SwipeActions
                    translate={translate}
                    interactive={swipePhase === 'open'}
                    title={title}
                    pool={chinese ? '待排' : 'Unplanned'}
                    remove={chinese ? '刪除' : 'Delete'}
                    onPool={() => { methods.close(); onPool(); }}
                    onDelete={() => { methods.close(); onDelete(); }}
                  />
                )}
              >
                {mainAction}
              </ReanimatedSwipeable>
            </View>
          </GestureDetector>
        ) : mainAction}
      </View>
      {drag ? <GestureDetector gesture={reorderGesture}>
        <View
          ref={bindDrag}
          collapsable={false}
          testID={`d6-route-drag-${row.id}`}
          style={[styles.handle, styles.handleOverlay, hideHandle && styles.hiddenHandle]}
          pointerEvents={hideHandle ? 'none' : 'auto'}
          accessible={!hideHandle}
          accessibilityElementsHidden={hideHandle}
          importantForAccessibility={hideHandle ? 'no-hide-descendants' : 'auto'}
          accessibilityRole="adjustable"
          accessibilityLabel={chinese ? `調整 ${title} 順序` : `Reorder ${title}`}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={({ nativeEvent: { actionName } }) => drag.onStep(actionName === 'increment' ? 1 : -1)}
        >
          <Ionicons name="reorder-three-outline" size={23} color="rgba(255,255,255,.42)" />
        </View>
      </GestureDetector> : <View style={styles.spacer} />}
    </View>
  );

  return (
    <Animated.View style={[styles.collapsingRow, collapseStyle]}>
      <D6RowCollapse key={removing ? 'collapse' : 'expand'} progress={collapse} removing={!!removing} />
      <Animated.View ref={measuredRef} collapsable={false} style={[styles.shell, selected !== undefined && styles.selectionSpacing, sourceStyle]} pointerEvents={removing ? 'none' : 'auto'}>
        {content}
        {insertion ? (
          <View pointerEvents="none" style={[
            styles.insertion,
            { backgroundColor: accent },
            insertion === 'above' ? styles.insertionTop : styles.insertionBottom,
          ]} />
        ) : null}
      </Animated.View>
    </Animated.View>
  );
}

function createD6RouteDragCallbacks() {
  let committed: D6RouteDrag | undefined;
  return {
    commit: (drag: D6RouteDrag | undefined) => { committed = drag; },
    start: (token: number, point: D6Point, geometry: D6DragGeometry) => committed?.onStart(token, point, geometry),
    end: (token: number, point: D6Point) => committed?.onEnd(token, point),
    cancel: (token: number) => committed?.onCancel(token),
  };
}

function routeRowDisplay(row: RouteRow) {
  const title = row.kind === 'destination' ? row.destination.title : row.accommodation.title;
  const meet = row.destination?.meetAt ? new Date(row.destination.meetAt) : null;
  const time = meet && Number.isFinite(meet.getTime()) ? `${String(meet.getHours()).padStart(2, '0')}:${String(meet.getMinutes()).padStart(2, '0')}` : null;
  const emoji = row.kind === 'accommodation' || row.destination.kind === 'accommodation'
    ? '🛏'
    : destinationEmojiDisplay(row.destination.emoji, '📍');
  return { title, time, emoji };
}

export function D6RouteRowPreview({ row, color }: { row: RouteRow; color: string }) {
  const { title, time, emoji } = routeRowDisplay(row);
  return <View style={styles.row}>
    <View style={styles.rowPressable}>
      <View style={styles.badgeRim}>
        <View style={[styles.badge, { backgroundColor: color }]}><Text style={styles.icon}>{emoji}</Text></View>
      </View>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      {time ? <Text style={styles.time}>{time}</Text> : null}
    </View>
    <View style={styles.handle}><Ionicons name="reorder-three-outline" size={23} color="white" /></View>
  </View>;
}

function D6RowCollapse({ progress, removing }: { progress: SharedValue<number>; removing: boolean }) {
  useMountEffect(() => { progress.set(withTiming(removing ? 0 : 1, { duration: 220 })); });
  return null;
}

export function D6RowFlash({ accent }: { accent: string }) {
  const opacity = useSharedValue(1);
  useMountEffect(() => { opacity.set(withTiming(0, { duration: 1400 })); });
  const fade = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: `${accent}57` }, fade]} />;
}

function SwipeActions({ translate, interactive, title, pool, remove, onPool, onDelete }: {
  translate: SharedValue<number>;
  interactive: boolean;
  title: string;
  pool: string;
  remove: string;
  onPool: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={styles.actions} pointerEvents={interactive ? 'auto' : 'none'}
      accessibilityElementsHidden={!interactive} importantForAccessibility={interactive ? 'auto' : 'no-hide-descendants'}>
      <SwipeAction
        rowTitle={title}
        label={pool}
        onPress={onPool}
        style={styles.pool}
        width={POOL_ACTION_WIDTH}
        distanceFromEdge={SWIPE_ACTIONS_WIDTH - SWIPE_ACTION_INSET - POOL_ACTION_WIDTH / 2}
        dotDistanceFromEdge={15}
        translate={translate}
      />
      <SwipeAction
        rowTitle={title}
        label={remove}
        onPress={onDelete}
        style={styles.remove}
        width={DELETE_ACTION_WIDTH}
        distanceFromEdge={SWIPE_ACTION_INSET + DELETE_ACTION_WIDTH / 2}
        dotDistanceFromEdge={4}
        translate={translate}
      />
    </View>
  );
}

function SwipeAction({ rowTitle, label, onPress, style, width, distanceFromEdge, dotDistanceFromEdge, translate }: {
  rowTitle: string;
  label: string;
  onPress: () => void;
  style: StyleProp<ViewStyle>;
  width: number;
  distanceFromEdge: number;
  dotDistanceFromEdge: number;
  translate: SharedValue<number>;
}) {
  const buttonStyle = useAnimatedStyle(() => {
    const reveal = Math.max(0, -translate.get());
    const fraction = Math.min(1, reveal / SWIPE_ACTIONS_WIDTH);
    const dotSize = 6;
    return {
      opacity: Math.min(1, reveal / 8),
      transform: [
        { translateX: (distanceFromEdge - dotDistanceFromEdge) * (1 - fraction) },
        { scaleX: fraction + (dotSize / width) * (1 - fraction) },
        { scaleY: fraction + (dotSize / SWIPE_ACTION_HEIGHT) * (1 - fraction) },
      ],
    };
  });
  const labelStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, Math.min(1, (-translate.get() / SWIPE_ACTIONS_WIDTH - 0.36) / 0.36)),
  }));

  return <Animated.View style={buttonStyle}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label} ${rowTitle}`}
      onPress={onPress} style={[styles.action, style, { width }]}>
      <Animated.View style={labelStyle}>
        <Text style={styles.actionText} numberOfLines={1}>{label}</Text>
      </Animated.View>
    </Pressable>
  </Animated.View>;
}

const SELECTION_ROW_INSET = 10;

const styles = StyleSheet.create({
  selectionSpacing: { marginVertical: 3 },
  collapsingRow: { overflow: 'hidden' },
  shell: { overflow: 'hidden', borderRadius: 14 },
  row: { minHeight: 54, flexDirection: 'row', alignItems: 'center', backgroundColor: 'transparent' },
  swipeBody: { flex: 1, minWidth: 0 },
  rowPressable: { minHeight: 54, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  rowWithHandle: { paddingRight: DRAG_HANDLE_WIDTH },
  title: { flex: 1, minWidth: 0, color: 'white', fontSize: APP_TEXT_SIZE.caption, fontWeight: '600' },
  icon: { fontSize: APP_TEXT_SIZE.caption },
  time: { color: 'rgba(255,255,255,.55)', fontSize: APP_TEXT_SIZE.caption, fontWeight: '500', fontVariant: ['tabular-nums'] },
  handle: { width: DRAG_HANDLE_WIDTH, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  handleOverlay: { position: 'absolute', right: 0 },
  hiddenHandle: { opacity: 0 },
  spacer: { width: 5 },
  badgeRim: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: 'transparent' },
  badge: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  selectionRim: { borderWidth: 0 },
  selectionCircle: { width: 24, height: 24, borderRadius: 12, backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,.52)', borderWidth: 1.5 },
  selectedCircle: { backgroundColor: '#fff', borderColor: '#fff' },
  connector: { position: 'absolute', width: 2, left: 19, opacity: 0.45 },
  selectionRow: { paddingHorizontal: SELECTION_ROW_INSET },
  completed: { opacity: 0.45 },
  insertion: { position: 'absolute', left: 0, right: 0, height: 6, borderRadius: 3 },
  insertionTop: { top: 0 },
  insertionBottom: { bottom: 0 },
  actions: { width: SWIPE_ACTIONS_WIDTH, flexDirection: 'row', alignItems: 'center', gap: SWIPE_ACTION_GAP, paddingHorizontal: SWIPE_ACTION_INSET },
  action: { minHeight: SWIPE_ACTION_HEIGHT, borderRadius: SWIPE_ACTION_HEIGHT / 2, alignItems: 'center', justifyContent: 'center' },
  pool: { backgroundColor: '#5C6662' },
  remove: { backgroundColor: '#E5484D' },
  actionText: { color: 'white', fontSize: APP_TEXT_SIZE.caption, fontWeight: '700' },
});
