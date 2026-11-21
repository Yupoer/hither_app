import React from 'react';
import { Button, Host, Image, Menu } from '@expo/ui/swift-ui';
import {
  accessibilityLabel, background, buttonStyle, contentShape, font, foregroundColor,
  frame, glassEffect, menuIndicator, menuOrder, menuStyle, padding, shapes,
} from '@expo/ui/swift-ui/modifiers';
import { StyleSheet } from 'react-native';
import {
  MAP_SHEET_ACTION_HALO, MAP_SHEET_ACTION_HIT_SIZE, MAP_SHEET_ACTION_ICON_SIZE, SHEET_HEADER_SYMBOLS,
} from '../../../components/mapSheetChrome';
import { liquidGlass } from '../../../native';
import type { D6RouteMenuProps } from './D6RouteMenu';

export default function D6RouteMenu({ label, items }: D6RouteMenuProps) {
  const trigger = <Image systemName={SHEET_HEADER_SYMBOLS.more} modifiers={[
    font({ size: MAP_SHEET_ACTION_ICON_SIZE, weight: 'semibold' }),
    foregroundColor('#fff'),
    frame({ width: MAP_SHEET_ACTION_HIT_SIZE, height: MAP_SHEET_ACTION_HIT_SIZE }),
    contentShape(shapes.circle()),
  ]} />;
  const glass = liquidGlass.isLiquidGlassAvailable();

  return <Host colorScheme="dark" style={styles.host} matchContents={false}>
    <Menu testID="d6-route-options" label={trigger} modifiers={[
      menuStyle('button'),
      buttonStyle('plain'),
      menuIndicator('hidden'),
      menuOrder('fixed'),
      background('#ffffff26', shapes.circle()),
      ...(glass ? [glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'circle' })] : []),
      padding({ all: MAP_SHEET_ACTION_HALO }),
      accessibilityLabel(label),
    ]}>
      {items.map(item => <Button key={item.testID} testID={item.testID} label={item.title} onPress={item.onPress} />)}
    </Menu>
  </Host>;
}

const styles = StyleSheet.create({
  host: {
    width: MAP_SHEET_ACTION_HIT_SIZE + 2 * MAP_SHEET_ACTION_HALO,
    height: MAP_SHEET_ACTION_HIT_SIZE + 2 * MAP_SHEET_ACTION_HALO,
    margin: -MAP_SHEET_ACTION_HALO,
    zIndex: 1,
  },
});
