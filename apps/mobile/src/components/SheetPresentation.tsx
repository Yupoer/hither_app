import React from 'react';
import { Modal, Pressable, StyleSheet, View, type DimensionValue } from 'react-native';
import { D6_SURFACE_SOLID_COLOR, MAP_FLOATING_EDGE_INSET, MAP_SHEET_CORNER_RADIUS } from './mapSheetChrome';

export type SheetDetent = 'medium' | { fraction: number } | { height: number };

export type SheetPresentationProps = {
  visible: boolean;
  onClose: () => void;
  onDismiss?: () => void;
  onOpenComplete?: () => void;
  testID?: string;
  detents?: readonly SheetDetent[];
  selection?: SheetDetent;
  onSelectionChange?: (detent: SheetDetent) => void;
  backgroundColor?: string;
  useSystemBackground?: boolean;
  allowBackgroundInteraction?: boolean;
  dismissDisabled?: boolean;
  children: React.ReactNode;
};

export default function SheetPresentation({
  visible,
  onClose,
  onOpenComplete,
  testID,
  detents,
  selection = detents?.[0],
  backgroundColor = D6_SURFACE_SOLID_COLOR,
  dismissDisabled,
  children,
}: SheetPresentationProps) {
  const height: DimensionValue = selection == null || selection === 'medium' ? '50%'
    : 'height' in selection ? selection.height : `${selection.fraction * 100}%`;
  const requestClose = dismissDisabled ? undefined : onClose;

  return (
    <Modal transparent visible={visible} animationType="slide" onShow={onOpenComplete} onRequestClose={requestClose}>
      <View style={styles.layer}>
        <Pressable style={StyleSheet.absoluteFill} onPress={requestClose} accessible={false} />
        <View testID={testID} style={[styles.sheet, { backgroundColor, height }]}>
          {children}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  layer: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: MAP_FLOATING_EDGE_INSET,
    backgroundColor: '#00000055',
  },
  sheet: { borderRadius: MAP_SHEET_CORNER_RADIUS, overflow: 'hidden' },
});
