import { APP_TEXT_SIZE } from '../../../theme/typeScale';
import Animated, { Easing, FadeInDown, FadeOutUp, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import React, { useState } from 'react';
import {
  Keyboard,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../../../components/AppText';
import Pressable from '../../../components/MotionPressable';
import Slider from '@react-native-community/slider';
import { HitherText } from '../../../components/HitherText';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { maps, type MapRegion, type PlaceResult } from '../../../native';
import { useMountEffect } from '../../../hooks/useMountEffect';
import { useVisibleUi } from '../../../state/foregroundUi';
import SystemToggle from '../../../components/SystemToggle';
import SheetHeaderAction from '../../../components/SheetHeaderAction';
import { MAP_FLOATING_EDGE_INSET, MAP_SHEET_CORNER_RADIUS, MAP_SHEET_ACTION_HIT_SIZE, SHEET_CORNER_ACTION_INSET } from '../../../components/mapSheetChrome';
import { normalizePlaceSearchResults } from '../../../utils/normalizePlaceSearchResults';
import { dateForTripDay, localDayKey } from '../../../utils/tripDay';
import type { FavoritePlace } from '../../../api/client';
import type { TravelMode } from '../../../utils/geo';
import type { Destination } from '../../../types';
import { D6_ACCENT, D6IconButton, D6Surface, d6ChromeStyles } from './D6HomeChrome';

const DETAIL_TIMING = { duration: 280, easing: Easing.inOut(Easing.cubic) };

const STOP_ICONS = ['🚩', '📍', '🛏️', '🍜', '🍣', '☕', '🛍️', '⛩️', '🗼', '🎡', '🏯', '🌳', '🚉', '📸', '⭐'];
const TRAVEL_OPTIONS: readonly ('auto' | TravelMode)[] = ['auto', 'transit', 'walk', 'drive', 'bicycle'];
const MODES: Record<'auto' | TravelMode, readonly [string, string]> = {
  auto: ['自動', 'Automatic'], transit: ['大眾運輸', 'Transit'], walk: ['步行', 'Walking'],
  drive: ['開車', 'Driving'], bicycle: ['腳踏車', 'Cycling'],
};

function Label({ children }: { children: React.ReactNode }) {
  return <Text style={d6ChromeStyles.text} numberOfLines={2}>{children}</Text>;
}

function Action({ title, onPress, primary = false, destructive = false, disabled = false, testID, style }: {
  title: string; onPress: () => void; primary?: boolean; destructive?: boolean; disabled?: boolean; testID?: string; style?: StyleProp<ViewStyle>;
}) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={title} disabled={disabled} onPress={onPress}
    style={[primary ? d6ChromeStyles.primary : d6ChromeStyles.softButton, styles.action, disabled && styles.disabled, style]}>
    <HitherText style={[styles.actionText, destructive && styles.destructive]}>{title}</HitherText>
  </Pressable>;
}

function CardRow({ label, value, onPress, children }: {
  label: string; value?: string; onPress?: () => void; children?: React.ReactNode;
}) {
  const content = <>
    <HitherText style={[styles.rowLabel, styles.grow]}>{label}</HitherText>
    {value ? <HitherText style={styles.rowValue} numberOfLines={2}>{value}</HitherText> : null}
    {children ?? (onPress ? <Ionicons name="chevron-forward" size={19} color="#ffffff99" /> : null)}
  </>;
  return <View>{onPress
    ? <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.row}>{content}</Pressable>
    : <View style={styles.row}>{content}</View>}</View>;
}

export type D6StopEditor = 'time' | 'icon' | 'transport' | 'radius' | null;

type StopCardProps = {
  stop: Destination;
  departureDate?: string;
  color: string;
  zh: boolean;
  current: boolean;
  canEdit: boolean;
  canSetStay: boolean;
  stays: boolean;
  busy: boolean;
  displayFont?: string;
  edit: D6StopEditor;
  onEdit: (edit: D6StopEditor) => void;
  radius: number;
  radiusOverride?: number;
  onRadiusPreview: (meters?: number) => void;
  onRadius: (meters?: number) => void;
  travelMode: TravelMode | 'auto';
  modeEtas: Readonly<Record<TravelMode, number | null>>;
  onMode: (mode: TravelMode | 'auto') => void;
  onTime: (value: Date | null, reminder: number) => Promise<boolean>;
  onIcon: (emoji: string) => Promise<boolean>;
  onStay: (next: boolean) => void;
  onClose: () => void;
  onMaps: () => void;
  onDelete: () => void;
  onHistory?: () => void;
  error?: string | null;
};

function formatClock(time: Date, zh: boolean) {
  return time.toLocaleTimeString(zh ? 'zh-TW' : 'en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

function TimeEditor({ stop, departureDate, displayFont, zh, busy, onTime }: Pick<StopCardProps, 'stop' | 'departureDate' | 'displayFont' | 'zh' | 'busy' | 'onTime'>) {
  const [time, setTime] = useState(() => {
    if (stop.meetAt) {
      const stored = new Date(stop.meetAt);
      if (Number.isFinite(stored.getTime())) return stored;
    }
    const day = dateForTripDay(departureDate, stop.day ?? 1) ?? new Date();
    const now = new Date();
    day.setHours(now.getHours(), Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
    return day;
  });
  const [reminder, setReminder] = useState(stop.meetRedMinutes ?? 10);
  const step = (minutes: number) => setTime(current => {
    const next = new Date(current);
    const total = (current.getHours() * 60 + current.getMinutes() + minutes + 1440) % 1440;
    next.setHours(Math.floor(total / 60), total % 60, 0, 0);
    return next;
  });
  return <View style={styles.editor}>
    <View style={styles.timeControls}>
      <D6IconButton name="remove" label={zh ? '減 15 分鐘' : 'Subtract 15 minutes'} onPress={() => step(-15)} style={styles.softIcon} />
      <Text style={[styles.bigTime, displayFont && { fontFamily: displayFont, fontStyle: 'normal', fontWeight: 'normal' }]}>{formatClock(time, zh)}</Text>
      <D6IconButton name="add" label={zh ? '加 15 分鐘' : 'Add 15 minutes'} onPress={() => step(15)} style={styles.softIcon} />
    </View>
    <CardRow label={zh ? '提醒' : 'Reminder'} value={zh ? `剩 ${reminder} 分` : `${reminder} min before`} onPress={() => setReminder(reminder === 5 ? 10 : reminder === 10 ? 15 : 5)} />
    <View style={styles.actionRow}>
      <Action title={zh ? '清除' : 'Clear'} disabled={busy} onPress={() => void onTime(null, reminder)} />
      <Action title={zh ? '完成' : 'Done'} testID="d6-stop-time-save" primary disabled={busy} onPress={() => void onTime(time, reminder)} />
    </View>
  </View>;
}

export function D6StopCard(props: StopCardProps) {
  const { stop, departureDate, color, zh, current, canEdit, canSetStay, stays, busy, edit, onEdit, radius, radiusOverride,
    onRadiusPreview, onRadius, travelMode, modeEtas, onMode, onIcon, onStay, onClose, onMaps, onDelete, onHistory, error } = props;
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const headerHeight = useSharedValue(0);
  const bodyHeight = useSharedValue(0);
  const [timeDraftKey, setTimeDraftKey] = useState(0);
  const maxHeight = height - insets.top - 32;
  const cardSize = useAnimatedStyle(() => headerHeight.get() > 0 && bodyHeight.get() > 0
    ? { height: Math.min(maxHeight, headerHeight.get() + bodyHeight.get() + SHEET_CORNER_ACTION_INSET * 2 + 10) } : {});
  const date = stop.day == null ? null : dateForTripDay(departureDate, stop.day);
  const dateLabel = date && (zh
    ? `${date.getMonth() + 1}/${date.getDate()} 週${'日一二三四五六'[date.getDay()]}`
    : date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', weekday: 'short' }));
  const time = stop.meetAt ? new Date(stop.meetAt) : null;
  const showReservedTime = time && Number.isFinite(time.getTime());
  const switchEdit = (editor: D6StopEditor) => {
    if (editor === 'time' && edit !== 'time') setTimeDraftKey(value => value + 1);
    onEdit(edit === editor ? null : editor);
  };
  return (
    <Animated.View testID="d6-stop-card" entering={FadeInDown.duration(300)} exiting={FadeOutUp.duration(200)} style={[d6ChromeStyles.bottomCard, { bottom: Math.max(24, insets.bottom - 8), maxHeight }, cardSize]}>
      <D6Surface radius={MAP_SHEET_CORNER_RADIUS} thick />
        <View style={styles.cardHead} onLayout={event => headerHeight.set(event.nativeEvent.layout.height)}>
          <View style={styles.cardIdentity}>
            <View style={[styles.tile, { backgroundColor: color }]}>
              {stays ? <Ionicons name="bed-outline" size={24} color="#fff" /> : <Text allowFontScaling={false} style={styles.tileEmoji}>{stop.emoji ?? '📍'}</Text>}
            </View>
            <View style={styles.grow}>
              <HitherText typeRole="title" style={styles.name} numberOfLines={2}>{stop.title}</HitherText>
              <HitherText style={styles.rowValue}>
                {dateLabel ?? (stop.day == null ? (zh ? '待排' : 'Unscheduled') : (zh ? `第 ${stop.day} 天` : `Day ${stop.day}`))}
              </HitherText>
            </View>
          </View>
          <SheetHeaderAction action="close" accessibilityLabel={zh ? '關閉集合點詳情' : 'Close stop details'} onPress={onClose} testID="d6-stop-close" />
        </View>
      <ScrollView style={styles.cardBody} onContentSizeChange={(_width, contentHeight) => bodyHeight.set(contentHeight)} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <CardRow label={zh ? '集合時間' : 'Meeting time'} value={showReservedTime ? formatClock(time, zh) : '—'}
          onPress={canEdit && !stays ? () => switchEdit('time') : undefined} />
        {canEdit ? <DetailEditor open={edit === 'time'}><TimeEditor key={`${stop.id}:${timeDraftKey}`} {...props} /></DetailEditor> : null}
        {canEdit && !stays ? <CardRow label={zh ? '圖標' : 'Icon'} value={stop.emoji ?? '📍'} onPress={() => switchEdit('icon')} /> : null}
        {canEdit ? <DetailEditor open={edit === 'icon'}><View style={styles.iconGrid}>
          {STOP_ICONS.map(emoji => <Pressable key={emoji} accessibilityRole="button" accessibilityLabel={emoji} disabled={busy}
            onPress={() => void onIcon(emoji)} style={[styles.emojiChoice, stop.emoji === emoji && { backgroundColor: color }]}><Text allowFontScaling={false} style={styles.emojiText}>{emoji}</Text></Pressable>)}
        </View></DetailEditor> : null}
        {current && canEdit ? <CardRow label={zh ? '前往方式' : 'Travel mode'} value={MODES[travelMode][zh ? 0 : 1]} onPress={() => switchEdit('transport')} /> : null}
        {current && canEdit ? <DetailEditor open={edit === 'transport'}><View style={styles.editor}>
          {TRAVEL_OPTIONS.map(mode => <CardRow key={mode} label={MODES[mode][zh ? 0 : 1]}
            value={mode === 'auto' || modeEtas[mode] == null ? undefined : `${Math.ceil(modeEtas[mode] / 60)} ${zh ? '分' : 'min'}`}
            onPress={() => onMode(mode)}>{mode === travelMode ? <Ionicons name="checkmark" size={19} color="#fff" /> : <View />}</CardRow>)}
        </View></DetailEditor> : null}
        <CardRow label={zh ? '抵達範圍' : 'Arrival radius'} value={radiusOverride != null ? `${radius} m` : zh ? '自動' : 'Automatic'}
          onPress={canEdit ? () => switchEdit('radius') : undefined} />
        {canEdit ? <DetailEditor open={edit === 'radius'} style={styles.radiusEditor}>
          <Slider accessibilityLabel={zh ? '抵達範圍（公尺）' : 'Arrival radius in metres'} minimumValue={20} maximumValue={200} step={10}
            value={radius} onValueChange={onRadiusPreview} onSlidingComplete={onRadius}
            minimumTrackTintColor="#ffffffcf" maximumTrackTintColor="#ffffff35" />
          <Action title={zh ? '自動' : 'Automatic'} primary style={styles.automatic} onPress={() => onRadius(undefined)} />
        </DetailEditor> : null}
        {canSetStay ? <CardRow label={zh ? '住宿' : 'Accommodation'}>
          <SystemToggle accessibilityLabel={zh ? '住宿' : 'Accommodation'} testID="d6-stop-stay" value={stays} disabled={busy} onValueChange={onStay} />
        </CardRow> : null}
        {error ? <Text accessibilityRole="alert" style={styles.destructive}>{error}</Text> : null}
        <View style={styles.actionRow}>
          <Action title={zh ? '地圖' : 'Maps'} onPress={onMaps} />
          {onHistory ? <Action title={zh ? '抵達紀錄' : 'Arrivals'} onPress={onHistory} /> : null}
          {canEdit ? <Action title={zh ? '刪除' : 'Delete'} disabled={busy} destructive onPress={onDelete} /> : null}
        </View>
      </ScrollView>
    </Animated.View>
  );
}

function DetailEditor({ open, children, style }: { open: boolean; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const contentHeight = useSharedValue(0);
  const motion = useAnimatedStyle(() => ({
    height: withTiming(open ? contentHeight.get() : 0, DETAIL_TIMING),
    opacity: withTiming(open ? 1 : 0, { duration: 180 }),
  }), [open]);
  return <Animated.View pointerEvents={open ? 'auto' : 'none'} accessibilityElementsHidden={!open}
    importantForAccessibility={open ? 'auto' : 'no-hide-descendants'} style={[styles.editorClip, motion]}>
    <View onLayout={event => contentHeight.set(event.nativeEvent.layout.height)} style={[styles.editorMeasure, style]}>{children}</View>
  </Animated.View>;
}

export type StopPlacement = { kind: 'first' } | { kind: 'after'; stopId: string } | { kind: 'last' };

type AddCardProps = {
  session: { day: number; stay: boolean; placement: StopPlacement };
  place: PlaceResult | null;
  title: string;
  favoritePlaces: readonly FavoritePlace[];
  biasRegion?: MapRegion;
  tripDays: number;
  departureDate?: string;
  stops: readonly Destination[];
  color: string;
  canEdit: boolean;
  canSetStay: boolean;
  quota: boolean;
  favorite: boolean;
  favoriteBusy: boolean;
  busy: boolean;
  keyboardHeight: number;
  zh: boolean;
  error?: string | null;
  onClose: () => void;
  onCenter: () => void;
  onPick: (place: PlaceResult) => void;
  onTitle: (title: string) => void;
  onDay: (day: number) => void;
  onPlacement: (placement: StopPlacement) => void;
  onStay: (stay: boolean) => void;
  onFavorite: () => void;
  onImport: () => void;
  onCommit: () => void;
};

function SearchPlaces({ query, region, onResult }: {
  query: string;
  region?: MapRegion;
  onResult: (results: PlaceResult[] | null) => void;
}) {
  useMountEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void maps.searchPlaces(query, region, { throwOnError: true })
        .then(items => { if (active) onResult(normalizePlaceSearchResults(items)); })
        .catch(() => { if (active) onResult(null); });
    }, 380);
    return () => { active = false; clearTimeout(timer); };
  });
  return null;
}

function PlaceTitle({ title, name, zh, onTitle }: {
  title: string; name: string; zh: boolean; onTitle: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const edit = () => setEditing(true);
  const doubleTap = Gesture.Tap().numberOfTaps(2).runOnJS(true).onEnd((_event, success) => { if (success) edit(); });
  if (editing) return <TextInput testID="confirm-place-name" accessibilityLabel={zh ? '集合點名稱' : 'Place name'}
    autoFocus selectTextOnFocus value={title} onChangeText={onTitle} placeholder={name} placeholderTextColor="#ffffff80" returnKeyType="done"
    onEndEditing={({ nativeEvent }) => {
      onTitle(nativeEvent.text.trim() || name);
      setEditing(false);
    }} style={styles.editName} />;
  return <>
    <GestureDetector gesture={doubleTap}>
      <View collapsable={false}><HitherText typeRole="title" style={styles.name} numberOfLines={2}>{title}</HitherText></View>
    </GestureDetector>
    <Pressable testID="d6-place-rename" accessibilityRole="button" accessibilityLabel={zh ? '修改集合點名稱' : 'Edit place name'} onPress={edit} style={styles.rename}>
      <Ionicons name="pencil-outline" size={13} color="#A9BCFF" />
      <HitherText style={styles.renameText}>{zh ? '點兩下名稱可修改' : 'Double tap name to edit'}</HitherText>
    </Pressable>
  </>;
}

function AddChoice({ label, value, expanded, onPress, testID }: {
  label: string; value: string; expanded: boolean; onPress?: () => void; testID: string;
}) {
  const body = <>
    <HitherText style={[styles.choiceLabel, styles.choiceHeading]}>{label}</HitherText>
    <HitherText style={styles.choiceValue} numberOfLines={2}>{value}</HitherText>
    {onPress ? <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={17} color="#C2CCEF" /> : null}
  </>;
  return onPress ? <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityValue={{ text: value }}
    accessibilityState={{ expanded }} onPress={onPress} style={[styles.choice, expanded && styles.choiceExpanded]}>{body}</Pressable>
    : <View style={styles.choice}>{body}</View>;
}

function AddOption({ label, description, selected, onPress, testID }: {
  label: string; description?: string; selected: boolean; onPress: () => void; testID: string;
}) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress}
    style={[styles.option, selected && styles.optionSelected]}>
    <View style={styles.grow}>
      <HitherText style={styles.optionTitle}>{label}</HitherText>
      {description ? <HitherText style={styles.optionDetail}>{description}</HitherText> : null}
    </View>
    <View style={styles.optionMark}>{selected ? <Ionicons name="checkmark" size={20} color="#B4C4FF" /> : null}</View>
  </Pressable>;
}

export function D6AddPlace(props: AddCardProps) {
  const { session, place, title, favoritePlaces, biasRegion, departureDate, stops, canEdit, canSetStay, quota,
    favorite, favoriteBusy, busy, keyboardHeight, zh, color, onClose, onCenter, onPick, onTitle, onDay, onPlacement,
    onStay, onFavorite, onImport, onCommit, error } = props;
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<{ key: string; results: PlaceResult[] | null } | null>(null);
  const [pinCoordinates, setPinCoordinates] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [selector, setSelector] = useState<'day' | 'placement' | null>(null);
  const visible = useVisibleUi();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const search = query.trim();
  const localized = session.stay ? `${search} ${zh ? '飯店' : 'hotel'}` : search;
  const searchKey = JSON.stringify([localized, biasRegion]);
  const currentResponse = response?.key === searchKey ? response.results : undefined;
  const pick = (item: PlaceResult) => {
    Keyboard.dismiss();
    setShowSuggestions(false);
    setPinCoordinates(false);
    setSelector(null);
    onPick(item);
  };
  const dayName = (day: number) => zh ? `第 ${day} 天` : `Day ${day}`;
  const dayDate = (day: number) => dateForTripDay(departureDate, day)?.toLocaleDateString(zh ? 'zh-TW' : 'en-US',
    { month: 'numeric', day: 'numeric', weekday: 'short' });
  const first = zh ? '第一站' : 'First stop';
  const last = zh ? '最後一站' : 'Last stop';
  const placement = session.placement;
  const afterStop = placement.kind === 'after' ? stops.find(stop => stop.id === placement.stopId) : null;
  const afterLabel = (stopTitle: string) => zh ? `${stopTitle} 之後` : `After ${stopTitle}`;
  const placementLabel = placement.kind === 'first' || !stops.length ? first : afterStop ? afterLabel(afterStop.title) : last;
  const choosePlacement = (value: StopPlacement) => { onPlacement(value); setSelector(null); };
  const toggleSelector = (value: 'day' | 'placement') => {
    Keyboard.dismiss();
    setSelector(current => current === value ? null : value);
  };
  return (
    <View pointerEvents="box-none" style={styles.addLayer}>
      {visible && showSuggestions && !place && search ? <SearchPlaces
        key={searchKey} query={localized} region={biasRegion}
        onResult={results => setResponse({ key: searchKey, results })}
      /> : null}
      {!place && !pinCoordinates ? <View pointerEvents="none" style={styles.crosshair}><Ionicons name="location" size={41} color={D6_ACCENT} /></View> : null}
      <View style={[styles.search, { top: Math.max(56, insets.top) }]}>
        <View style={styles.searchBar}>
          <D6Surface radius={MAP_SHEET_CORNER_RADIUS} />
          <View style={styles.searchIcon}><Ionicons name="search" size={20} color="#ffffffb0" /></View>
          <TextInput testID="map-search-input" accessibilityLabel={zh ? '搜尋地點' : 'Search places'}
            placeholder={session.stay ? (zh ? '搜尋住宿' : 'Search accommodation') : (zh ? '搜尋地點' : 'Search places')}
            placeholderTextColor="#ffffff80" value={query} onFocus={() => { setPinCoordinates(false); setShowSuggestions(true); }}
            onChangeText={value => { setQuery(value); setResponse(null); }} style={styles.searchInput} returnKeyType="search" />
          <SheetHeaderAction action="close" accessibilityLabel={zh ? '關閉搜尋' : 'Close search'} onPress={onClose} testID="d6-add-close" />
        </View>
        {showSuggestions && !place ? (
          <View style={[styles.results, { maxHeight: height * .40 }]}>
            <D6Surface radius={24} thick />
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {currentResponse === null ? <Text accessibilityRole="alert" style={styles.destructive}>{zh ? '搜尋暫時無法使用' : 'Search is temporarily unavailable'}</Text> : null}
              {currentResponse?.map(item => <Pressable key={item.id} accessibilityRole="button" style={styles.result}
                onPress={() => pick(item)}><Ionicons name={session.stay ? 'bed-outline' : 'location-outline'} size={20} color="#fff" /><Label>{item.name}</Label></Pressable>)}
              {!session.stay && !query.trim() ? favoritePlaces.map(item => <Pressable key={item.id} accessibilityRole="button" style={styles.result}
                onPress={() => pick({ id: item.id, name: item.title, address: item.address, coordinates: item.coordinates })}>
                <Ionicons name="heart-outline" size={19} color="#FFB5C7" /><Label>{item.title}</Label></Pressable>) : null}
              <Pressable testID="d6-add-coordinates" accessibilityRole="button" accessibilityLabel={zh ? '座標' : 'Coordinates'}
                style={styles.result} onPress={() => {
                  Keyboard.dismiss();
                  setShowSuggestions(false);
                  setPinCoordinates(true);
                }}><Ionicons name="grid-outline" size={20} color="#fff" /><Label>{zh ? '座標' : 'Coordinates'}</Label></Pressable>
              <Pressable accessibilityRole="button" style={styles.result} onPress={onImport}><Ionicons name="cloud-upload-outline" size={20} color="#fff" /><Label>{zh ? '匯入 KML' : 'Import KML'}</Label></Pressable>
            </ScrollView>
          </View>
        ) : null}
      </View>
      <View style={[d6ChromeStyles.bottomCard, { bottom: Math.max(24, insets.bottom - 8, keyboardHeight + 8),
        maxHeight: Math.max(160, height - Math.max(insets.bottom, keyboardHeight) - insets.top - 24) }]}>
        <D6Surface radius={MAP_SHEET_CORNER_RADIUS} thick />
        {!place && pinCoordinates ? <View testID="d6-coordinate-pin-hint" accessibilityLiveRegion="polite">
          <Text style={styles.pinTitle}>{zh ? '長按地圖選擇位置' : 'Touch and hold a spot on the map'}</Text>
          <Text style={styles.rowValue}>{zh ? '放下圖釘後，就能用該位置新增集合點。' : 'Drop a pin to use that location for your new stop.'}</Text>
        </View> : !place ? <Action title={zh ? '用地圖中心' : 'Use map center'} primary onPress={() => { Keyboard.dismiss(); setShowSuggestions(false); onCenter(); }} /> : <>
          <View style={styles.cardHead}>
            <View style={styles.addIdentity}>
              <View style={[styles.placeIcon, { backgroundColor: color }]}>
                <Ionicons name="location-outline" size={23} color="#fff" />
              </View>
              <View style={styles.grow}>
                <PlaceTitle key={place.id} title={title} name={place.name} zh={zh} onTitle={onTitle} />
                {place.address ? <HitherText style={styles.placeAddress} numberOfLines={2}>{place.address}</HitherText> : null}
              </View>
            </View>
            <SheetHeaderAction action={favorite ? 'favorited' : 'favorite'} disabled={favoriteBusy} onPress={onFavorite} testID="d6-place-favorite"
              accessibilityLabel={favorite ? (zh ? '從我的最愛移除' : 'Remove from favorites') : (zh ? '加到我的最愛' : 'Add to favorites')} />
          </View>
          <ScrollView style={styles.addFieldsScroll} keyboardShouldPersistTaps="handled" nestedScrollEnabled contentContainerStyle={styles.addFields}>
            <AddChoice label={zh ? '行程日期' : 'Trip date'} value={dayDate(session.day) ?? dayName(session.day)}
              expanded={selector === 'day'} onPress={props.tripDays > 1 ? () => toggleSelector('day') : undefined} testID="d6-place-day" />
            {selector === 'day' ? <ScrollView testID="d6-place-day-options" style={styles.optionList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {Array.from({ length: props.tripDays }, (_, index) => index + 1).map(day => <AddOption key={day} label={dayDate(day) ?? dayName(day)}
                description={dayDate(day) ? dayName(day) : undefined} selected={session.day === day} testID={`d6-place-day-${day}`}
                onPress={() => { onDay(day); setSelector(null); }} />)}
            </ScrollView> : null}
            {canEdit && !session.stay ? <>
              <AddChoice label={zh ? '加入哪一站' : 'Place in itinerary'} value={placementLabel} expanded={selector === 'placement'}
                onPress={stops.length ? () => toggleSelector('placement') : undefined} testID="d6-place-position" />
              {selector === 'placement' && stops.length > 0 ? <ScrollView testID="d6-place-position-options" style={styles.optionList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                <AddOption label={first} selected={placement.kind === 'first'} testID="d6-place-first" onPress={() => choosePlacement({ kind: 'first' })} />
                {stops.slice(0, -1).map(stop => <AddOption key={stop.id} label={afterLabel(stop.title)}
                  selected={placement.kind === 'after' && placement.stopId === stop.id}
                  testID={`d6-place-after-${stop.id}`} onPress={() => choosePlacement({ kind: 'after', stopId: stop.id })} />)}
                <AddOption label={last} selected={placement.kind === 'last' || (placement.kind === 'after' && !afterStop)}
                  testID="d6-place-last" onPress={() => choosePlacement({ kind: 'last' })} />
              </ScrollView> : null}
            </> : null}
            {canSetStay ? <View style={styles.stayRow}>
              <View style={styles.grow}>
                <HitherText style={styles.choiceLabel}>{zh ? '設為住宿' : 'Set as accommodation'}</HitherText>
                {session.stay ? <HitherText style={styles.optionDetail}>{zh ? '住宿會顯示在獨立區塊。' : 'Shown in a separate accommodation section.'}</HitherText> : null}
              </View>
              <SystemToggle testID="d6-add-stay" accessibilityLabel={zh ? '設為住宿' : 'Set as accommodation'} value={session.stay}
                disabled={busy} onValueChange={stay => { setSelector(null); onStay(stay); }} />
            </View> : null}
          </ScrollView>
          {error ? <Text accessibilityRole="alert" style={styles.destructive}>{error}</Text> : null}
          <Action testID="confirm-place-add" title={quota ? (zh ? '解鎖更多集合點' : 'Unlock more stops') : canEdit ? (zh ? '加入' : 'Add') : (zh ? '建議' : 'Suggest')}
            primary disabled={busy || !title.trim()} onPress={onCommit} />
        </>}
      </View>
    </View>
  );
}

export function defaultD6Departure(departureDate?: string) {
  return departureDate ?? localDayKey(new Date());
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 10 },
  cardBody: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
  editorClip: { overflow: 'hidden' },
  editorMeasure: { position: 'absolute', top: 0, left: 0, right: 0 },
  cardIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: MAP_SHEET_ACTION_HIT_SIZE },
  tile: { width: MAP_SHEET_ACTION_HIT_SIZE, height: MAP_SHEET_ACTION_HIT_SIZE, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  tileEmoji: { fontSize: 25, color: '#fff' },
  name: { color: '#fff', fontSize: APP_TEXT_SIZE.heading, fontWeight: '800' },
  editName: { color: '#fff', fontSize: APP_TEXT_SIZE.title, fontWeight: '800', minHeight: 44, paddingVertical: 2 },
  softIcon: { backgroundColor: '#ffffff1f' },
  soft: { backgroundColor: '#ffffff1f' },
  row: { minHeight: 58, paddingVertical: 8, paddingRight: 8, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#ffffff25' },
  radiusEditor: { paddingTop: 8, paddingBottom: 14 },
  automatic: { width: '50%', alignSelf: 'center', flexGrow: 0, marginTop: 8 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  action: { flexGrow: 1, minHeight: 52 },
  rowLabel: { color: '#fff', fontSize: APP_TEXT_SIZE.body, fontWeight: '600' },
  rowValue: { color: '#ffffffba', fontSize: APP_TEXT_SIZE.body, flexShrink: 1, fontVariant: ['tabular-nums'] },
  actionText: { color: '#fff', fontSize: APP_TEXT_SIZE.body, fontWeight: '700', textAlign: 'center' },
  pinTitle: { color: '#fff', fontSize: APP_TEXT_SIZE.title, fontWeight: '700', marginBottom: 6 },
  disabled: { opacity: .45 },
  destructive: { color: '#FF8686' },
  editor: { padding: 10, borderRadius: 18, backgroundColor: '#ffffff0b' },
  timeControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 5 },
  bigTime: { color: '#fff', fontSize: APP_TEXT_SIZE.metric, fontWeight: '800', fontStyle: 'italic', fontVariant: ['tabular-nums'] },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 4, marginBottom: 6 },
  emojiChoice: { width: '20%', minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  emojiText: { fontSize: 27, color: '#fff' },
  addLayer: { ...StyleSheet.absoluteFill, zIndex: 83 },
  crosshair: { position: 'absolute', left: '50%', top: '50%', marginLeft: -20, marginTop: -40 },
  search: { position: 'absolute', left: MAP_FLOATING_EDGE_INSET, right: MAP_FLOATING_EDGE_INSET },
  searchBar: { minHeight: 88, flexDirection: 'row', alignItems: 'flex-start', borderRadius: MAP_SHEET_CORNER_RADIUS, gap: 8, padding: SHEET_CORNER_ACTION_INSET },
  searchIcon: { height: MAP_SHEET_ACTION_HIT_SIZE, justifyContent: 'center' },
  searchInput: { flex: 1, minHeight: MAP_SHEET_ACTION_HIT_SIZE, fontSize: APP_TEXT_SIZE.body, color: '#fff' },
  results: { marginTop: 8, borderRadius: 24, paddingHorizontal: 12, paddingVertical: 4 },
  result: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ffffff1a' },
  addIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  placeIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  placeAddress: { color: '#ffffffa6', fontSize: APP_TEXT_SIZE.caption, marginTop: 3 },
  rename: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 23 },
  renameText: { color: '#BDCAFA', fontSize: APP_TEXT_SIZE.caption, fontWeight: '600' },
  addFieldsScroll: { flexGrow: 0, flexShrink: 1, marginBottom: 12 },
  addFields: { gap: 5 },
  choice: { flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 10, paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: 14, backgroundColor: '#ffffff12' },
  choiceExpanded: { backgroundColor: '#879DFF2b' },
  choiceLabel: { color: '#fff', fontSize: APP_TEXT_SIZE.caption, fontWeight: '600', flexShrink: 1 },
  choiceHeading: { flexBasis: '35%' },
  choiceValue: { color: '#D7DFFD', fontSize: APP_TEXT_SIZE.caption, flex: 1, textAlign: 'left' },
  optionList: { flexGrow: 0, maxHeight: 184, backgroundColor: '#090C18a8', borderRadius: 14 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingVertical: 7, paddingHorizontal: 13 },
  optionSelected: { backgroundColor: '#879DFF24' },
  optionTitle: { color: '#fff', fontSize: APP_TEXT_SIZE.caption, fontWeight: '600' },
  optionDetail: { color: '#C1C8DA', fontSize: APP_TEXT_SIZE.caption, marginTop: 2 },
  optionMark: { width: 22, alignItems: 'center' },
  stayRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 12, minHeight: 48 },
});
