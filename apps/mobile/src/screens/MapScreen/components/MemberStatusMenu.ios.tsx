import React from 'react';
import { Button, Host, HStack, Image, Label, Menu, Text } from '@expo/ui/swift-ui';
import {
  accessibilityHint, accessibilityLabel, background, buttonStyle, contentShape, fixedSize, font, foregroundColor,
  frame, glassEffect, menuIndicator, menuStyle, padding, shapes,
} from '@expo/ui/swift-ui/modifiers';
import { liquidGlass } from '../../../native';
import { MAP_SHEET_ACTION_HALO, MAP_SHEET_ACTION_HIT_SIZE } from '../../../components/mapSheetChrome';
import type { MemberStatusMenuProps } from './MemberStatusMenu';

export default function MemberStatusMenu({ items, onSelect, accessibilityLabel: label, label: title, style }: MemberStatusMenuProps) {
  const glass = liquidGlass.isLiquidGlassAvailable();
  const trigger = (
    <HStack spacing={8} modifiers={[
      padding({ horizontal: 14 }),
      frame({ height: MAP_SHEET_ACTION_HIT_SIZE }),
      foregroundColor('#fff'),
      contentShape(shapes.capsule()),
    ]}>
      <Text modifiers={[font({ size: 16, weight: 'semibold' }), fixedSize({ horizontal: true })]}>{title}</Text>
      <Image systemName="chevron.down" modifiers={[font({ size: 12, weight: 'bold' })]} />
    </HStack>
  );
  return <Host colorScheme="dark" matchContents style={[{ margin: -MAP_SHEET_ACTION_HALO }, style]}>
    <Menu testID="map-presence" label={trigger} modifiers={[
      menuStyle('button'),
      buttonStyle('plain'),
      menuIndicator('hidden'),
      background('#ffffff24', shapes.capsule()),
      ...(glass ? [glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'capsule' })] : []),
      padding({ all: MAP_SHEET_ACTION_HALO }),
      accessibilityLabel(label),
    ]}>
      {items.map(item => {
        const testID = `map-presence-option-${item.id}`;
        const onPress = () => onSelect(item.id);
        const titleView = item.selected
          ? <Label key="title" title={item.title} systemImage="checkmark" />
          : <Text key="title">{item.title}</Text>;
        return <Button key={item.id} testID={testID} onPress={onPress}
          modifiers={item.subtitle ? [accessibilityHint(item.subtitle)] : undefined}>
          {item.subtitle ? [titleView, <Text key="subtitle">{item.subtitle}</Text>] : titleView}
        </Button>;
      })}
    </Menu>
  </Host>;
}
