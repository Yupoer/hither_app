/**
 * Members / Route / Tools / Store — native segmented control.
 * iOS: SwiftUI Picker segmented. Android: Compose segmented buttons.
 */
import React, { useMemo } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { SegmentedControl } from '@expo/ui/community/segmented-control';
import type { SheetPaneKey } from '../../../store/types';
import { selectionTick } from '../../../utils/haptics';

export interface SheetPaneTabOption {
  key: SheetPaneKey;
  label: string;
}

const TAB_ICONS: Record<SheetPaneKey, { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap }> = {
  members: { active: 'people', inactive: 'people-outline' },
  route: { active: 'location', inactive: 'location-outline' },
  tools: { active: 'build', inactive: 'build-outline' },
  store: { active: 'bag-handle', inactive: 'bag-handle-outline' },
};

interface SheetPaneTabsProps {
  options: SheetPaneTabOption[];
  value: SheetPaneKey;
  onChange: (key: SheetPaneKey) => void;
  onTabNode?: (key: SheetPaneKey, node: View | null) => void;
}

export const SheetPaneTabs = React.memo(function SheetPaneTabs({
  options,
  value,
  onChange,
  onTabNode,
}: SheetPaneTabsProps) {
  // The segmented control remains the native hit target/background. The
  // original Ionicons are a transparent overlay so no second glass/track is
  // painted while the familiar icon + label treatment remains visible.
  const labels = useMemo(() => options.map((opt) => `\u00a0${opt.label}`), [options]);
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
      <View pointerEvents="none" style={styles.iconOverlay}>
        {options.map((opt, index) => {
          const icons = TAB_ICONS[opt.key] ?? TAB_ICONS.members;
          const active = opt.key === value;
          return (
            <View
              key={opt.key}
              style={[
                styles.iconCell,
                { left: `${(index * 100) / options.length}%`, width: `${100 / options.length}%` },
              ]}
            >
              <Ionicons
                name={active ? icons.active : icons.inactive}
                size={16}
                color={active ? '#FFFFFF' : 'rgba(235,235,245,0.65)'}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  track: {
    width: '100%',
    minHeight: 36,
    justifyContent: 'center',
  },
  iconOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
  },
  iconCell: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingLeft: 8,
  },
});
