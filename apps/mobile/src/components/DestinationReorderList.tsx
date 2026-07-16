import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  Modal,
  TextInput,
  Alert,
  Dimensions
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { Destination } from '../types';
import { radius, spacing, DAY_COLORS, type Palette } from '../theme';
import { readOnboardingState } from '../onboarding/sync';
import { usePreferences } from '../state/PreferencesContext';

const ROW_HEIGHT = 56;
const REVEAL_WIDTH = 76;

interface Props {
  groupId?: string;
  destinations: Destination[];
  canReorder: boolean;
  tripDays?: number;
  departureDate?: string;
  onUpdateTripDetails: (days: number, date: string) => void;
  onReorder: (updates: { id: string; position: number; day: number }[]) => void;
  onDelete?: (id: string) => void;
  onSync?: () => Promise<void>;
  colors: Palette;
  emptyLabel: string;
  dragHint?: string;
  onDragActiveChange?: (active: boolean) => void;
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
  onSync,
  colors,
  emptyLabel,
  dragHint,
  onDragActiveChange,
}: Props) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { dayColors, setDayColor } = usePreferences();

  const [order, setOrder] = useState<ListItem[]>([]);
  const orderRef = useRef(order);
  orderRef.current = order;

  const draggingRef = useRef(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [colorPickerDay, setColorPickerDay] = useState<number | null>(null);
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

  const handleSync = useCallback(async () => {
    if (!onSync || syncing) return;
    setSyncing(true);
    try {
      await onSync();
    } catch {
      Alert.alert('同步失敗', '目前無法取得資料庫集合點，請稍後再試。');
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
      
      const sortedDests = [...destinations].sort((a, b) => a.order - b.order);
      
      for (let d = 1; d <= days; d++) {
        let dateStr = '';
        if (departureDate) {
           const dateObj = new Date(departureDate);
           dateObj.setDate(dateObj.getDate() + (d - 1));
           dateStr = `${dateObj.getMonth() + 1}月${dateObj.getDate()}號`;
        }
        nextOrder.push({ type: 'header', day: d, id: `header-${d}`, title: `第 ${d} 天`, dateStr });
        const dayDests = sortedDests.filter(dest => (dest.day || 1) === d);
        for (const dest of dayDests) {
          nextOrder.push({ type: 'dest', item: dest, id: dest.id });
        }
      }
      const dangling = sortedDests.filter(dest => (dest.day || 1) > days);
      for (const dest of dangling) {
          nextOrder.push({ type: 'dest', item: dest, id: dest.id });
      }

      setOrder(nextOrder);
    }
  }, [destinations, tripDays, departureDate]);

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
    for (const u of updates) {
       const orig = destinations.find(d => d.id === u.id);
       if (!orig || orig.order !== u.position || (orig.day || 1) !== u.day) {
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
            <Text style={styles.setDaysText}>設定天數與日期</Text>
          </Pressable>}
          {onSync && <Pressable
            style={[styles.setDaysBtn, syncing && { opacity: 0.5 }]}
            onPress={() => void handleSync()}
            disabled={syncing}
            accessibilityRole="button"
            accessibilityLabel="同步資料庫集合點"
          >
            <Ionicons name="refresh-outline" size={16} color={colors.accent} style={{ marginRight: 6 }} />
            <Text style={styles.setDaysText}>{syncing ? '同步中…' : '同步資料庫'}</Text>
          </Pressable>}
        </View>
      )}

      {order.length === 0 ? (
         <Text style={styles.empty}>{emptyLabel}</Text>
      ) : (
        <View style={styles.list}>
          {order.map((item, index) => {
            if (item.type === 'header') {
               const bgColor = dayColors[item.day] || DAY_COLORS[(item.day - 1) % DAY_COLORS.length];
               return (
                 <HeaderRow
                   key={item.id}
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
                 />
               );
            }
            return (
              <Row
                key={item.id}
                item={item.item}
                active={activeId === item.id}
                canReorder={canReorder}
                pan={pan}
                styles={styles}
                onGrant={onGrant}
                onMove={onMove}
                onRelease={onRelease}
                onDelete={onDelete}
              />
            );
          })}
        </View>
      )}

      <Modal visible={showSettings} transparent animationType="fade">
         <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
               <Text style={styles.modalTitle}>設定行程天數</Text>
               <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>出發日期</Text>
                  <DateTimePicker
                     value={editDate}
                     mode="date"
                     display="default"
                     onChange={(e, date) => {
                         if (date) setEditDate(date);
                     }}
                  />
               </View>
               <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>行程總天數</Text>
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
                     <Text style={styles.modalActionText}>取消</Text>
                  </Pressable>
                  <Pressable onPress={() => {
                      setShowSettings(false);
                      onUpdateTripDetails(editDays, editDate.toISOString());
                  }} style={[styles.modalActionBtn, { backgroundColor: colors.accent }]}>
                     <Text style={[styles.modalActionText, { color: '#fff' }]}>儲存</Text>
                  </Pressable>
               </View>
            </View>
         </View>
      </Modal>

      <Modal visible={colorPickerDay !== null} transparent animationType="fade">
         <Pressable style={styles.modalOverlay} onPress={() => setColorPickerDay(null)}>
            <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
               <Text style={styles.modalTitle}>選擇第 {colorPickerDay} 天的旗幟顏色</Text>
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
}) {
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
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Pressable
              onPress={() => onColorPress(item.day)}
              disabled={!canEditColors}
              accessibilityRole={canEditColors ? 'button' : undefined}
              style={[styles.colorDot, { backgroundColor: bgColor }]}
            />
            <Text style={styles.headerTitle}>{item.title}</Text>
          </View>
          <Text style={styles.headerDate}>{item.dateStr}</Text>
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
  onGrant,
  onMove,
  onRelease,
  onDelete,
}: {
  item: Destination;
  active: boolean;
  canReorder: boolean;
  pan: Animated.Value;
  styles: ReturnType<typeof makeStyles>;
  onGrant: (id: string) => void;
  onMove: (id: string, dy: number) => void;
  onRelease: () => void;
  onDelete?: (id: string) => void;
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
        <Ionicons name="location-outline" size={20} color={styles.handle.color} style={{ marginRight: 8 }} />
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
    },
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
    handle: { color: colors.textSecondary, fontSize: 22, paddingHorizontal: spacing.xs },
    deleteBg: {
      ...StyleSheet.absoluteFillObject,
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
