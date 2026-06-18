import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Destination } from '../types';
import { radius, spacing, type Palette } from '../theme';

/**
 * A re-orderable list of the group's gathering points.
 *
 * Drag-to-reorder is implemented with React Native's built-in `PanResponder`
 * (no native gesture library) so it works in Expo Go. Rows live in normal column
 * flow; while a row is dragged it floats under the finger (an `Animated`
 * translateY), and crossing a row boundary splices the live order so the other
 * rows shift into place. On release the new id order is handed back to the parent
 * to persist.
 *
 * Reordering is leader-only (`canReorder`); followers see the same list, ordered,
 * but without drag handles.
 */

const ROW_HEIGHT = 56;

interface Props {
  destinations: Destination[];
  canReorder: boolean;
  onReorder: (orderedIds: string[]) => void;
  colors: Palette;
  emptyLabel: string;
  dragHint?: string;
}

export default function DestinationReorderList({
  destinations,
  canReorder,
  onReorder,
  colors,
  emptyLabel,
  dragHint,
}: Props) {
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [order, setOrder] = useState<Destination[]>(destinations);
  const orderRef = useRef(order);
  orderRef.current = order;

  const draggingRef = useRef(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const startIndexRef = useRef(0);
  const pan = useRef(new Animated.Value(0)).current;

  // Resync from props, but never while a drag is in flight (a background
  // realtime refetch must not clobber the order under the finger).
  useEffect(() => {
    if (!draggingRef.current) {
      setOrder(destinations);
    }
  }, [destinations]);

  const handleGrant = useCallback(
    (id: string) => {
      draggingRef.current = true;
      setActiveId(id);
      startIndexRef.current = orderRef.current.findIndex((d) => d.id === id);
      pan.setValue(0);
    },
    [pan],
  );

  const handleMove = useCallback(
    (id: string, dy: number) => {
      const startIndex = startIndexRef.current;
      const currentIndex = orderRef.current.findIndex((d) => d.id === id);
      const len = orderRef.current.length;
      let target = Math.round(startIndex + dy / ROW_HEIGHT);
      target = Math.max(0, Math.min(target, len - 1));

      if (target !== currentIndex && currentIndex !== -1) {
        const next = orderRef.current.slice();
        const [moved] = next.splice(currentIndex, 1);
        next.splice(target, 0, moved);
        orderRef.current = next;
        setOrder(next);
      }

      // Keep the floating row glued to the finger relative to its new slot.
      const idxNow = orderRef.current.findIndex((d) => d.id === id);
      pan.setValue(dy + (startIndex - idxNow) * ROW_HEIGHT);
    },
    [pan],
  );

  const handleRelease = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const ids = orderRef.current.map((d) => d.id);
    setActiveId(null);
    pan.setValue(0);

    // Only persist if the order actually changed.
    const before = destinations.map((d) => d.id).join(',');
    if (ids.join(',') !== before) {
      onReorder(ids);
    }
  }, [pan, onReorder, destinations]);

  // Each Row builds its PanResponder once (closing over first-render callbacks),
  // but handleRelease changes with `destinations`/`onReorder`. Dispatch through a
  // ref so the responder always calls the latest handlers, never a stale one.
  const handlersRef = useRef({ handleGrant, handleMove, handleRelease });
  handlersRef.current = { handleGrant, handleMove, handleRelease };
  const onGrant = useCallback((id: string) => handlersRef.current.handleGrant(id), []);
  const onMove = useCallback(
    (id: string, dy: number) => handlersRef.current.handleMove(id, dy),
    [],
  );
  const onRelease = useCallback(() => handlersRef.current.handleRelease(), []);

  if (order.length === 0) {
    return <Text style={styles.empty}>{emptyLabel}</Text>;
  }

  return (
    <View>
      {canReorder && dragHint ? (
        <Text style={styles.hint}>{dragHint}</Text>
      ) : null}
      <View style={styles.list}>
        {order.map((item, index) => (
          <Row
            key={item.id}
            item={item}
            index={index}
            active={activeId === item.id}
            canReorder={canReorder}
            pan={pan}
            styles={styles}
            onGrant={onGrant}
            onMove={onMove}
            onRelease={onRelease}
          />
        ))}
      </View>
    </View>
  );
}

function Row({
  item,
  index,
  active,
  canReorder,
  pan,
  styles,
  onGrant,
  onMove,
  onRelease,
}: {
  item: Destination;
  index: number;
  active: boolean;
  canReorder: boolean;
  pan: Animated.Value;
  styles: ReturnType<typeof makeStyles>;
  onGrant: (id: string) => void;
  onMove: (id: string, dy: number) => void;
  onRelease: () => void;
}) {
  // Stable per-row responder: created once, closes over the stable callbacks
  // and the row's id (rows are keyed by id, so this survives reordering).
  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, g) =>
        canReorder && Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      // Once we own the drag, don't let the enclosing ScrollView reclaim it.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => onGrant(item.id),
      onPanResponderMove: (_evt, g) => onMove(item.id, g.dy),
      onPanResponderRelease: () => onRelease(),
      onPanResponderTerminate: () => onRelease(),
    }),
  ).current;

  return (
    <Animated.View
      style={[
        styles.row,
        active && styles.rowActive,
        { transform: [{ translateY: active ? pan : 0 }] },
        active && { zIndex: 10, elevation: 6 },
      ]}
      {...(canReorder ? responder.panHandlers : {})}
    >
      <Text style={styles.rowIndex}>{index + 1}</Text>
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
      {canReorder ? <Text style={styles.handle}>≡</Text> : null}
    </Animated.View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
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
      overflow: 'visible',
    },
    row: {
      height: ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
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
    handle: { color: colors.textSecondary, fontSize: 22, paddingHorizontal: spacing.xs },
  });
