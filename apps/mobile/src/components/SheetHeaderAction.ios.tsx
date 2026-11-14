import React from 'react';
import { Host, Group } from '@expo/ui/swift-ui';
import { padding } from '@expo/ui/swift-ui/modifiers';
import { StyleSheet } from 'react-native';
import SheetHeaderActionContent from './SheetHeaderActionContent.ios';
import type { SheetHeaderActionProps } from './ReactNativeSheetHeaderAction';
import { MAP_SHEET_ACTION_HALO, MAP_SHEET_ACTION_HIT_SIZE } from './mapSheetChrome';

export type { SheetHeaderActionKind } from './mapSheetChrome';

export default function SheetHeaderAction({ style, ...props }: SheetHeaderActionProps) {
  return (
    <Host style={[style, styles.host]} colorScheme="dark" matchContents={false}>
      <Group modifiers={[padding({ all: MAP_SHEET_ACTION_HALO })]}><SheetHeaderActionContent {...props} /></Group>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: {
    width: MAP_SHEET_ACTION_HIT_SIZE + 2 * MAP_SHEET_ACTION_HALO,
    height: MAP_SHEET_ACTION_HIT_SIZE + 2 * MAP_SHEET_ACTION_HALO,
    margin: -MAP_SHEET_ACTION_HALO,
    zIndex: 1,
  },
});
