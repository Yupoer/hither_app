import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheet, ConcentricRectangle, EdgeCornerStyle, Group, Host, RNHostView, ZStack } from '@expo/ui/swift-ui';
import {
  interactiveDismissDisabled,
  onAppear,
  presentationBackground,
  presentationBackgroundInteraction,
  presentationCornerRadius,
  presentationDetents,
  presentationDragIndicator,
  foregroundStyle,
  ignoreSafeArea,
  type PresentationDetent,
  type ShapeStyle,
} from '@expo/ui/swift-ui/modifiers';
import {
  D6_SURFACE_SOLID_COLOR,
  MAP_FLOATING_EDGE_INSET,
  MAP_SHEET_CORNER_RADIUS,
} from './mapSheetChrome';
import type { SheetDetent, SheetPresentationProps } from './SheetPresentation';

export const PRESENTED_SHEET_CONTENT_TOP = 16;

const SHEET_CORNERS = {
  topLeadingCorner: EdgeCornerStyle.fixed(MAP_SHEET_CORNER_RADIUS),
  topTrailingCorner: EdgeCornerStyle.fixed(MAP_SHEET_CORNER_RADIUS),
  bottomLeadingCorner: EdgeCornerStyle.concentric(),
  bottomTrailingCorner: EdgeCornerStyle.concentric(),
};

const SYSTEM_MATERIAL: ShapeStyle = { type: 'material', material: 'thin' };

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
  surfaceTint,
  allowBackgroundInteraction = false,
  dismissDisabled = false,
  children,
}: SheetPresentationProps) {
  const usesSystemInsets = Number.parseInt(String(Platform.Version), 10) >= 26;
  const surfaceLayers: ShapeStyle[] = useSystemBackground
    ? [SYSTEM_MATERIAL, ...(surfaceTint ? [{ type: 'linearGradient' as const, colors: [...surfaceTint], startPoint: { x: 0.5, y: 0 }, endPoint: { x: 0.5, y: 1 } }] : [])]
    : [backgroundColor];

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
          presentationBackground('transparent'),
          ...(usesSystemInsets ? [presentationCornerRadius(MAP_SHEET_CORNER_RADIUS)] : []),
          presentationBackgroundInteraction(allowBackgroundInteraction ? 'enabled' : 'disabled'),
          interactiveDismissDisabled(dismissDisabled),
          ...(onOpenComplete ? [onAppear(onOpenComplete)] : []),
        ]}>
          <ZStack>
          {usesSystemInsets ? surfaceLayers.map((style, index) => (
            <ConcentricRectangle key={index} corners={SHEET_CORNERS} modifiers={[foregroundStyle(style), ignoreSafeArea({ edges: 'bottom' })]} />
          )) : null}
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
          </ZStack>
        </Group>
      </BottomSheet>
    </Host>
  );
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', width: 1, height: 1 },
  root: { flex: 1 },
  inset: { paddingHorizontal: MAP_FLOATING_EDGE_INSET, paddingBottom: 8 },
  content: { flex: 1, paddingTop: PRESENTED_SHEET_CONTENT_TOP },
  systemContent: { paddingBottom: 8 },
  insetSurface: {
    borderRadius: MAP_SHEET_CORNER_RADIUS,
    overflow: 'hidden',
  },
});
