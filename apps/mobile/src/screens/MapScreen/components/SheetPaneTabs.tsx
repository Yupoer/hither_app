/**
 * Members / Route / Tools / Store icon tab bar (sheet chrome).
 * Tap-only equal-width tabs with accent underline — replaces CoverFlow cards.
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
                style={[
                  styles.underline,
                  active && { backgroundColor: accent, opacity: 1 },
                ]}
              />
            </Pressable>
          </React.Fragment>
        );
      })}
    </View>
  );
});

const makeStyles = (scale: number, boldText: boolean) => {
  const s = (n: number, min = 0) => Math.max(min, Math.round(n * scale));
  const iconSize = s(22, 18);
  return {
    iconSize,
    ...StyleSheet.create({
      track: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'stretch',
        minHeight: s(56, 48),
        marginBottom: s(4, 2),
      },
      tab: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: s(10, 8),
        paddingBottom: s(8, 6),
        gap: s(4, 2),
      },
      label: {
        fontSize: s(boldText ? 12 : 13, 11),
        fontWeight: boldText ? '600' : '700',
        textAlign: 'center',
      },
      underline: {
        marginTop: s(4, 2),
        height: 3,
        width: '52%',
        borderRadius: 2,
        backgroundColor: 'transparent',
        opacity: 0,
      },
      divider: {
        width: StyleSheet.hairlineWidth,
        alignSelf: 'center',
        height: '55%',
        backgroundColor: glass.hairline,
      },
    }),
  };
};
