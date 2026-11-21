import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheet, Group, Host, RNHostView } from '@expo/ui/swift-ui';
import {
  interactiveDismissDisabled,
  onAppear,
  presentationBackground,
  presentationBackgroundInteraction,
  presentationDetents,
  presentationDragIndicator,
  type PresentationDetent,
} from '@expo/ui/swift-ui/modifiers';
import {
  D6_SURFACE_SOLID_COLOR,
  MAP_FLOATING_EDGE_INSET,
  MAP_SHEET_CORNER_RADIUS,
} from './mapSheetChrome';
import type { SheetDetent, SheetPresentationProps } from './SheetPresentation';

const DEFAULT_DETENTS: readonly SheetDetent[] = [{ fraction: 0.84 }];

export default function SheetPresentation({
  visible,
  onClose,
  onDismiss,
  onOpenComplete,
  testID,
  detents = DEFAULT_DETENTS,
  selection,
  onSelectionChange,
  backgroundColor = D6_SURFACE_SOLID_COLOR,
  useSystemBackground = false,
  allowBackgroundInteraction = false,
  dismissDisabled = false,
  children,
}: SheetPresentationProps) {
  const usesSystemInsets = Number.parseInt(String(Platform.Version), 10) >= 26;

  function handleSelectionChange(detent: PresentationDetent) {
    if (detent !== 'large') onSelectionChange?.(detent);
  }

  return (
    <Host style={styles.anchor} pointerEvents="box-none" colorScheme="dark">
      <BottomSheet
        testID={testID ? `${testID}-presentation` : undefined}
        isPresented={visible}
        onIsPresentedChange={presented => { if (!presented && visible && !dismissDisabled) onClose(); }}
        onDismiss={onDismiss}
      >
        <Group modifiers={[
          presentationDetents([...detents], { selection, onSelectionChange: onSelectionChange ? handleSelectionChange : undefined }),
          presentationDragIndicator(dismissDisabled && detents.length === 1 ? 'hidden' : 'visible'),
          ...(usesSystemInsets && useSystemBackground
            ? [] : [presentationBackground(usesSystemInsets ? backgroundColor : 'transparent')]),
          presentationBackgroundInteraction(allowBackgroundInteraction ? 'enabled' : 'disabled'),
          interactiveDismissDisabled(dismissDisabled),
          ...(onOpenComplete ? [onAppear(onOpenComplete)] : []),
        ]}>
          <RNHostView matchContents={false}>
            <GestureHandlerRootView style={[styles.root, !usesSystemInsets && styles.inset]}>
              <View testID={testID} style={[
                styles.content,
                usesSystemInsets ? styles.systemContent : [styles.insetSurface, { backgroundColor }],
              ]}>
                {children}
              </View>
            </GestureHandlerRootView>
          </RNHostView>
        </Group>
      </BottomSheet>
    </Host>
  );
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', width: 1, height: 1 },
  root: { flex: 1 },
  inset: { paddingHorizontal: MAP_FLOATING_EDGE_INSET, paddingBottom: 8 },
  content: { flex: 1, paddingTop: 16 },
  systemContent: { paddingBottom: 8 },
  insetSurface: {
    borderRadius: MAP_SHEET_CORNER_RADIUS,
    overflow: 'hidden',
  },
});
