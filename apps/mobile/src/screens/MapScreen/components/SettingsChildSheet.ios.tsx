import React, { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../../../components/AppText';
import SheetHeaderAction from '../../../components/SheetHeaderAction';
import SheetPresentation, { type SheetDetent } from '../../../components/SheetPresentation';
import {
  MAP_SHEET_ACTION_HIT_SIZE,
  SHEET_CORNER_ACTION_INSET,
  SETTINGS_SHEET_CONTENT_INSET,
} from '../../../components/mapSheetChrome';
import { useMountEffect } from '../../../hooks/useMountEffect';
import type { SettingsSheetPanelProps } from './SettingsSheetPanel';

const STAGE_ONE_RATIO = 0.52;
const STAGE_TWO_RATIO = 0.8;
const MIN_COMPACT_HEIGHT = 232;
const PRESENTATION_VERTICAL_PADDING = 24;

function ResetSettingsScroll({ scrollRef }: { scrollRef: React.RefObject<ScrollView | null> }) {
  useMountEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  });
  return null;
}

export default function SettingsChildSheet({
  visible,
  onClose,
  onDismissComplete,
  testID,
  navigation,
  onBack,
  backLabel = 'back',
  action = 'close',
  doneLabel = action === 'close' ? 'close' : 'commit',
  onCommit,
  title,
  titleFontSize,
  children,
  initialStage = 0,
  stageOneRatio = STAGE_ONE_RATIO,
  stageTwoRatio = STAGE_TWO_RATIO,
  darkMaterial = false,
  wrapContentInScrollView = true,
  singleStage = false,
  home = false,
  fitContent = false,
  fillContent = false,
  scrollResetKey,
}: SettingsSheetPanelProps) {
  const { height } = useWindowDimensions();
  const { top, bottom } = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [contentSize, setContentSize] = useState<{ page?: string; height: number }>();
  const [activeStage, setActiveStage] = useState({ visible, initialStage, stage: initialStage });
  if (activeStage.visible !== visible || activeStage.initialStage !== initialStage) {
    setActiveStage({ visible, initialStage, stage: initialStage });
    if (visible) setContentSize(undefined);
  }

  const lifecycle = useRef({ visible, awaitingDismissal: visible, closeRequested: false });
  if (lifecycle.current.visible !== visible) {
    lifecycle.current.visible = visible;
    if (visible) {
      lifecycle.current.awaitingDismissal = true;
      lifecycle.current.closeRequested = false;
    }
  }
  function requestClose() {
    if (!visible || lifecycle.current.closeRequested) return;
    lifecycle.current.closeRequested = true;
    onClose();
  }
  function completeDismissal() {
    if (!lifecycle.current.awaitingDismissal) return;
    lifecycle.current.awaitingDismissal = false;
    requestClose();
    onDismissComplete?.();
  }

  const stageOneDetent = { fraction: stageOneRatio };
  const stageTwoDetent = { fraction: stageTwoRatio };
  const contentHeight = contentSize?.page === scrollResetKey ? contentSize?.height ?? 0 : 0;
  const compactHeight = Math.max(
    MIN_COMPACT_HEIGHT,
    Math.ceil(headerHeight + contentHeight + PRESENTATION_VERTICAL_PADDING),
  );
  const compactDetent = contentHeight === 0 || headerHeight === 0
    ? stageOneDetent
    : compactHeight < (height - top - bottom) * stageTwoRatio
      ? { height: compactHeight }
      : stageTwoDetent;
  const isChild = navigation === 'child';
  const usesSystemBackground = navigation != null || fitContent;
  const preferredDetent = fitContent ? compactDetent
    : singleStage || activeStage.stage === 1 ? stageTwoDetent : stageOneDetent;
  const [pageSelection, setPageSelection] = useState({ page: scrollResetKey, adjustHeight: !!onBack });
  if (pageSelection.page !== scrollResetKey) {
    setPageSelection({ page: scrollResetKey, adjustHeight: !pageSelection.adjustHeight });
  }
  // Expo reapplies the selection only when its value changes.
  const selectedDetent = !onBack || !pageSelection.adjustHeight ? preferredDetent
    : 'height' in preferredDetent ? { height: preferredDetent.height - 1 }
    : { fraction: preferredDetent.fraction - 0.001 };
  const backDetent = !onBack ? undefined : 'height' in selectedDetent
    ? { height: selectedDetent.height - 60 } : { fraction: selectedDetent.fraction - 0.09 };
  const usesTwoDetents = !singleStage && !isChild && !fitContent;

  function handleSelectionChange(detent: SheetDetent) {
    if (detent === 'medium') return;
    if (backDetent) {
      if ('height' in backDetent ? 'height' in detent && detent.height === backDetent.height
        : 'fraction' in detent && detent.fraction === backDetent.fraction) onBack?.();
      return;
    }
    if (!('fraction' in detent)) return;
    const stage = detent.fraction === stageTwoRatio ? 1 : 0;
    setActiveStage(current => current.stage === stage ? current : { ...current, stage });
  }

  const header = navigation === 'root' && !title ? null : (
    <View style={[styles.header, usesSystemBackground && styles.insetHeader]}
      onLayout={fitContent ? event => setHeaderHeight(event.nativeEvent.layout.height) : undefined}>
      {isChild ? (
        <SheetHeaderAction
          testID="settings-child-back"
          action="back"
          useSystemStyle
          onPress={onBack ?? requestClose}
          accessibilityLabel={backLabel}
        />
      ) : <View style={styles.headerActionSlot} />}
      <AppText accessibilityRole="header" style={[styles.title, titleFontSize != null && { fontSize: titleFontSize }]}
        numberOfLines={titleFontSize == null ? 1 : 2}>{title}</AppText>
      {isChild ? <View style={styles.headerActionSlot} /> : (
        <SheetHeaderAction
          testID={home || singleStage || navigation === 'root' ? 'settings-root-close' : 'settings-child-back'}
          action={action}
          useSystemStyle={usesSystemBackground}
          onPress={action === 'commit' ? () => onCommit?.() : requestClose}
          accessibilityLabel={doneLabel}
          disabled={action === 'commit' && !onCommit}
        />
      )}
    </View>
  );

  const [firstChild, ...nestedSheets] = React.Children.toArray(children);
  const splitChildren = singleStage || initialStage === 1;
  const mainContent = splitChildren ? firstChild : children;
  return (
    <SheetPresentation
      visible={visible}
      onClose={onBack ?? requestClose}
      onDismiss={completeDismissal}
      testID={testID}
      detents={backDetent ? [backDetent, selectedDetent] : usesTwoDetents ? [stageOneDetent, stageTwoDetent] : [selectedDetent]}
      selection={selectedDetent}
      onSelectionChange={backDetent || usesTwoDetents ? handleSelectionChange : undefined}
      backgroundColor={darkMaterial ? '#263230f7' : undefined}
      useSystemBackground={usesSystemBackground}
      dismissDisabled={!!onBack}
    >
      <View style={styles.body} onAccessibilityEscape={onBack ?? requestClose}>
        {header}
        {wrapContentInScrollView ? (
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={[
              styles.scrollContent,
              navigation ? styles.settingsScrollContent : fitContent && styles.compactScrollContent,
              fillContent && styles.fillScrollContent,
            ]}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            onContentSizeChange={fitContent ? (_width, measuredHeight) => {
              setContentSize({ page: scrollResetKey, height: measuredHeight });
            } : undefined}
          >
            {mainContent}
          </ScrollView>
        ) : <View style={styles.body}>{mainContent}</View>}
        {visible && scrollResetKey != null ? <ResetSettingsScroll key={scrollResetKey} scrollRef={scrollRef} /> : null}
        {splitChildren && nestedSheets.length > 0 ? (
          <View pointerEvents="box-none" style={styles.nestedLayer}>
            {nestedSheets}
          </View>
        ) : null}
      </View>
    </SheetPresentation>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: 12, paddingHorizontal: 16, paddingBottom: 24 },
  settingsScrollContent: { paddingTop: 16, paddingHorizontal: SETTINGS_SHEET_CONTENT_INSET },
  compactScrollContent: { paddingBottom: 14 },
  fillScrollContent: { flexGrow: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SHEET_CORNER_ACTION_INSET },
  insetHeader: { paddingTop: 8, paddingHorizontal: SETTINGS_SHEET_CONTENT_INSET },
  headerActionSlot: { width: MAP_SHEET_ACTION_HIT_SIZE, height: MAP_SHEET_ACTION_HIT_SIZE },
  title: { flex: 1, textAlign: 'center', color: '#fff', fontSize: 17, fontWeight: '700' },
  nestedLayer: { ...StyleSheet.absoluteFill, zIndex: 2 },
});
