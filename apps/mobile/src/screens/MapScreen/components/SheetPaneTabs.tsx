/**
 * Members / Route / Tools / Store — Android native segmented fallback.
 * iOS uses the HitherSheetPaneTabs SwiftUI native module.
 */
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { SegmentedControl } from '@expo/ui/community/segmented-control';
import { MAP_SHEET_PANE_TABS_HEIGHT } from '../../../components/mapSheetChrome';
import type { SheetPaneKey } from '../../../store/types';
import { selectionTick } from '../../../utils/haptics';
import { MemberInboxBadge } from './MemberInboxBadge';

export interface SheetPaneTabOption {
  key: SheetPaneKey;
  label: string;
  badge?: { count: number; accessibilityLabel: string };
}

interface SheetPaneTabsProps {
  options: SheetPaneTabOption[];
  selectedSection: SheetPaneKey;
  onChange: (key: SheetPaneKey) => void;
  onTabNode?: (key: SheetPaneKey, node: View | null) => void;
}

export const SheetPaneTabs = React.memo(function SheetPaneTabs({
  options,
  selectedSection,
  onChange,
  onTabNode,
}: SheetPaneTabsProps) {
  const labels = useMemo(() => options.map((option) => option.label), [options]);
  const selectedIndex = Math.max(0, options.findIndex((opt) => opt.key === selectedSection));

  return (
    <View
      style={styles.track}
      testID="sheet-pane-tabs"
      accessibilityRole="tablist"
    >
      <SegmentedControl
        values={labels}
        selectedIndex={selectedIndex}
        onChange={(event) => {
          const index = event.nativeEvent.selectedSegmentIndex;
          const next = options[index];
          if (!next || next.key === selectedSection) return;
          selectionTick();
          onChange(next.key);
        }}
      />
      <View pointerEvents="none" style={styles.measurementLayer}>
        {options.map((option) => (
          <View
            key={option.key}
            ref={(node) => onTabNode?.(option.key, node)}
            style={styles.measurementCell}
            accessible={false}
          >
            {option.badge && (
              <MemberInboxBadge
                count={option.badge.count}
                accessibilityLabel={option.badge.accessibilityLabel}
                style={styles.tabBadge}
                testID={`sheet-pane-badge-${option.key}`}
              />
            )}
          </View>
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  track: {
    width: '100%',
    minHeight: MAP_SHEET_PANE_TABS_HEIGHT.android,
    justifyContent: 'center',
  },
  measurementLayer: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
  },
  measurementCell: {
    flex: 1,
  },
  tabBadge: { top: 14, right: 5 },
});
