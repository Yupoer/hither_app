import React from 'react';
import { Keyboard, StyleSheet } from 'react-native';
import { Button, HStack, Host, Image, Label, Menu, Spacer, Text } from '@expo/ui/swift-ui';
import {
  accessibilityHint, accessibilityLabel, accessibilityValue, buttonStyle, fixedSize, font, foregroundColor, frame, lineLimit,
  menuIndicator, menuStyle, padding,
} from '@expo/ui/swift-ui/modifiers';
import { APP_TEXT_SIZE } from '../../../theme/typeScale';
import type { AddPlaceChoiceProps } from './D6AddPlaceChoice';

export default function AddPlaceChoice({ label, value, testID, options }: AddPlaceChoiceProps) {
  const selectable = options.length > 0;
  const row = (
    <HStack spacing={10} modifiers={[padding({ horizontal: 16, vertical: 14 }), frame({ minHeight: CHOICE_ROW_HEIGHT, maxWidth: Infinity })]}>
      <Text modifiers={[font({ size: APP_TEXT_SIZE.caption, weight: 'semibold' }), foregroundColor('#fff'), lineLimit(1),
        fixedSize({ horizontal: true, vertical: false })]}>{label}</Text>
      <Spacer minLength={8} />
      <Text modifiers={[font({ size: APP_TEXT_SIZE.caption }), foregroundColor('#D7DFFD'), lineLimit(1)]}>{value}</Text>
      {selectable ? <Image systemName="chevron.down" modifiers={[font({ size: 12, weight: 'semibold' }), foregroundColor('#C2CCEF')]} /> : null}
    </HStack>
  );

  return (
    <Host colorScheme="dark" matchContents={{ vertical: true }} style={styles.row}>
      {selectable ? (
        <Menu testID={testID} label={row} modifiers={[
          menuStyle('button'), buttonStyle('plain'), menuIndicator('hidden'), accessibilityLabel(label), accessibilityValue(value),
        ]}>
          {options.map(option => {
            const title = option.selected
              ? <Label key="title" title={option.label} systemImage="checkmark" />
              : <Text key="title">{option.label}</Text>;
            return (
              <Button key={option.testID} testID={option.testID} onPress={() => { Keyboard.dismiss(); option.onPress(); }}
                modifiers={option.description ? [accessibilityHint(option.description)] : undefined}>
                {option.description ? [title, <Text key="subtitle">{option.description}</Text>] : title}
              </Button>
            );
          })}
        </Menu>
      ) : row}
    </Host>
  );
}

const CHOICE_ROW_HEIGHT = 56;

const styles = StyleSheet.create({
  row: { alignSelf: 'stretch', minHeight: CHOICE_ROW_HEIGHT, backgroundColor: '#ffffff12', borderRadius: 14 },
});
