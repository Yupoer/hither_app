import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { requireNativeView } from 'expo';
import { MAP_SHEET_PANE_TABS_HEIGHT } from '../../../components/mapSheetChrome';
import type { SheetPaneKey } from '../../../store/types';
import { selectionTick } from '../../../utils/haptics';
import { MemberInboxBadge } from './MemberInboxBadge';
import type { SheetPaneTabOption } from './SheetPaneTabs';

export type { SheetPaneTabOption } from './SheetPaneTabs';

type NativeSelectionEvent = {
  nativeEvent?: {
    index?: number;
  };
};

type NativeSheetPaneTabsProps = ViewProps & {
  labels: string[];
  selectedIndex: number;
  onSelectionChange?: (event: NativeSelectionEvent) => void;
};

const NativeSheetPaneTabs = requireNativeView<NativeSheetPaneTabsProps>('HitherSheetPaneTabs');

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
  const labels = useMemo(() => options.map((option) => option.badge?.accessibilityLabel ?? option.label), [options]);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.key === selectedSection));
  const handleSelectionChange = useCallback((event: NativeSelectionEvent) => {
    const index = event.nativeEvent?.index;
    const next = typeof index === 'number' ? options[index] : undefined;
    if (!next || next.key === selectedSection) return;
    selectionTick();
    onChange(next.key);
  }, [onChange, options, selectedSection]);

  return (
    <View
      style={styles.track}
      testID="sheet-pane-tabs"
      accessibilityRole="tablist"
    >
      <NativeSheetPaneTabs
        labels={labels}
        selectedIndex={selectedIndex}
        onSelectionChange={handleSelectionChange}
        style={styles.nativeSelector}
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
    minHeight: MAP_SHEET_PANE_TABS_HEIGHT.ios,
    justifyContent: 'center',
  },
  nativeSelector: {
    width: '100%',
    height: MAP_SHEET_PANE_TABS_HEIGHT.ios,
  },
  measurementLayer: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
  },
  measurementCell: {
    flex: 1,
  },
  tabBadge: { top: 3, right: 9 },
});
