/**
 * Members / Route / Tools / Store — native segmented control.
 * iOS: SwiftUI Picker segmented. Android: Compose segmented buttons.
 */
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import SegmentedControl from '@expo/ui/community/segmented-control';
import type { SheetPaneKey } from '../../../store/types';
import { selectionTick } from '../../../utils/haptics';

export interface SheetPaneTabOption {
  key: SheetPaneKey;
  label: string;
}

interface SheetPaneTabsProps {
  options: SheetPaneTabOption[];
  value: SheetPaneKey;
  onChange: (key: SheetPaneKey) => void;
  accent: string;
  onTabNode?: (key: SheetPaneKey, node: View | null) => void;
}

export const SheetPaneTabs = React.memo(function SheetPaneTabs({
  options,
  value,
  onChange,
  onTabNode,
}: SheetPaneTabsProps) {
  const labels = useMemo(() => options.map((opt) => opt.label), [options]);
  const selectedIndex = Math.max(0, options.findIndex((opt) => opt.key === value));

  return (
    <View
      style={styles.track}
      testID="sheet-pane-tabs"
      accessibilityRole="tablist"
      ref={(node) => {
        options.forEach((opt) => onTabNode?.(opt.key, node));
      }}
    >
      <SegmentedControl
        values={labels}
        selectedIndex={selectedIndex}
        onChange={(event) => {
          const index = event.nativeEvent.selectedSegmentIndex;
          const next = options[index];
          if (!next || next.key === value) return;
          selectionTick();
          onChange(next.key);
        }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  track: {
    width: '100%',
    minHeight: 36,
    justifyContent: 'center',
  },
});
