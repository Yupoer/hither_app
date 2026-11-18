import React, { useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { AppText as Text } from './AppText';
import SheetHeaderAction from './SheetHeaderAction';
import SheetPresentation from './SheetPresentation';
import { glass } from '../glass';
import { APP_TEXT_SIZE, GLOBAL_FONT_SCALE_CAP } from '../theme/typeScale';
import { MAP_SHEET_ACTION_HIT_SIZE, SHEET_CORNER_ACTION_INSET } from './mapSheetChrome';
import type { OverlaySheetProps } from './OverlaySheet';

function PositionedSheetContent({ children }: { children: React.ReactNode }) {
  const layer = useRef<View>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const { width, height } = useWindowDimensions();

  return (
    <View
      ref={layer}
      collapsable={false}
      pointerEvents="box-none"
      style={StyleSheet.absoluteFill}
      onLayout={() => layer.current?.measureInWindow((x, y) => setOrigin({ x, y }))}
    >
      {origin ? (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: -origin.x, top: -origin.y, width, height }}>
          {children}
        </View>
      ) : null}
    </View>
  );
}

export default function OverlaySheet({
  visible,
  onClose,
  onOpenComplete,
  onDismiss,
  dismissDisabled,
  onDone,
  title,
  doneLabel = 'Done',
  doneSystemImage,
  headerLeft,
  opaque,
  material = 'mapSheet',
  children,
  floatingContent,
  presentedContent,
}: OverlaySheetProps) {
  const headerSystemImage = doneSystemImage ?? (onDone ? 'checkmark' : 'xmark');

  return (
    <SheetPresentation
      visible={visible}
      onClose={onClose}
      onDismiss={onDismiss}
      dismissDisabled={dismissDisabled}
      testID="overlay-sheet"
      onOpenComplete={onOpenComplete}
      backgroundColor={material === 'default' && opaque ? glass.overlayOpaque : undefined}
    >
      <View style={styles.header}>
        <View style={styles.headerSide}>{headerLeft}</View>
        <Text maxFontSizeMultiplier={GLOBAL_FONT_SCALE_CAP} style={styles.title} numberOfLines={1}>{title}</Text>
        <SheetHeaderAction
          testID={onDone ? 'overlay-done' : 'overlay-header-close'}
          action={headerSystemImage === 'checkmark' ? 'commit' : 'close'}
          onPress={onDone ?? onClose}
          accessibilityLabel={doneLabel}
          style={styles.headerAction}
        />
      </View>
      <View style={styles.body}>{children}</View>
      {floatingContent ? <PositionedSheetContent>{floatingContent}</PositionedSheetContent> : null}
      {presentedContent}
    </SheetPresentation>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SHEET_CORNER_ACTION_INSET,
    paddingBottom: 18,
  },
  headerSide: {
    minWidth: MAP_SHEET_ACTION_HIT_SIZE,
    maxWidth: 110,
    flexShrink: 1,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  headerAction: { width: MAP_SHEET_ACTION_HIT_SIZE, height: MAP_SHEET_ACTION_HIT_SIZE },
  title: { flex: 1, fontSize: APP_TEXT_SIZE.body, textAlign: 'center', fontWeight: '700', color: glass.textPrimary },
  body: { flex: 1, minHeight: 0 },
});
