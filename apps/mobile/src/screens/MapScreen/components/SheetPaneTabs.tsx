/**
 * Members / Route / Tools / Store icon tab bar (sheet chrome).
 * Compact equal-width tabs; active accent underline sits on the bottom edge.
 */
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { glass } from '../../../glass';
import { GLOBAL_FONT_SCALE_CAP } from '../../../theme/typeScale';
import { useFontLayout } from '../../../a11y/useFontScaleBucket';
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
}

const TAB_ICONS: Record<
  SheetPaneKey,
  { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap }
> = {
  members: { active: 'people', inactive: 'people-outline' },
  route: { active: 'location', inactive: 'location-outline' },
  tools: { active: 'build', inactive: 'build-outline' },
  store: { active: 'bag-handle', inactive: 'bag-handle-outline' },
};

export const SheetPaneTabs = React.memo(function SheetPaneTabs({
  options,
  value,
  onChange,
  accent,
}: SheetPaneTabsProps) {
  const { scale, boldText } = useFontLayout();
  const styles = useMemo(() => makeStyles(scale, boldText), [scale, boldText]);

  return (
    <View style={styles.track} testID="sheet-pane-tabs" accessibilityRole="tablist">
      {options.map((opt, i) => {
        const active = opt.key === value;
        const icons = TAB_ICONS[opt.key] ?? TAB_ICONS.members;
        const color = active ? accent : glass.textSecondary;
        return (
          <React.Fragment key={opt.key}>
            {i > 0 ? <View style={styles.divider} /> : null}
            <Pressable
              style={({ pressed }) => [
                styles.tab,
                pressed && { opacity: 0.65 },
              ]}
              onPress={() => {
                if (opt.key === value) return;
                selectionTick();
                onChange(opt.key);
              }}
              accessibilityRole="tab"
              accessibilityLabel={opt.label}
              accessibilityState={{ selected: active }}
              testID={`sheet-pane-tab-${opt.key}`}
            >
              <Ionicons
                name={active ? icons.active : icons.inactive}
                size={styles.iconSize}
                color={color}
              />
              <Text
                style={[styles.label, { color }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
                maxFontSizeMultiplier={GLOBAL_FONT_SCALE_CAP}
              >
                {opt.label}
              </Text>
              <View
                pointerEvents="none"
                style={[
                  styles.underline,
                  active && { backgroundColor: accent },
                ]}
              />
            </Pressable>
          </React.Fragment>
        );
      })}
    </View>
  );
});

const makeStyles = (scale: number, _boldText: boolean) => {
  const s = (n: number, min = 0) => Math.max(min, Math.round(n * scale));
  // Leaner “tall” chrome: one step smaller than body at standard Dynamic Type
  // (reads as 小→標準), regular weight, long bottom rail. Not chubby/bold.
  const iconSize = s(20, 18);
  return {
    iconSize,
    ...StyleSheet.create({
      track: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'stretch',
        minHeight: s(50, 46),
      },
      tab: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: s(6, 5),
        // Underline hugs bottom edge — no floating gap.
        paddingBottom: s(5, 4),
        gap: s(2, 1),
      },
      label: {
        // ~caption size at default scale (smaller than standard body).
        fontSize: s(11, 10),
        fontWeight: '400',
        textAlign: 'center',
        lineHeight: s(13, 12),
      },
      underline: {
        position: 'absolute',
        // Longer rail — almost full tab width.
        left: '8%',
        right: '8%',
        bottom: 0,
        height: 2,
        borderRadius: 1,
        backgroundColor: 'transparent',
      },
      divider: {
        width: StyleSheet.hairlineWidth,
        alignSelf: 'center',
        height: '45%',
        backgroundColor: glass.hairlineSoft,
      },
    }),
  };
};
