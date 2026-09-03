import React from 'react';
import { Host, Button, HStack, Image, Text, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  backgroundOverlay,
  buttonBorderShape,
  buttonStyle,
  font,
  foregroundColor,
  frame,
  cornerRadius,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import { liquidGlass } from '../native';
import type { NativeTeamCardProps } from './NativeTeamCard';

/** Native SwiftUI team-card header. Expanded actions stay RN siblings so each remains independently tappable. */
export default function NativeTeamCard({
  teamName,
  subtitle,
  inviteCode,
  groupEmoji,
  groupColor = 'rgba(255,255,255,0.16)',
  members,
  extraCount,
  expanded,
  onPress,
  accessibilityLabel: a11yLabel,
  testID,
  style,
}: NativeTeamCardProps) {
  const shownMembers = members.slice(0, 4);
  return (
    <Host style={[{ width: '100%', height: 84 }, style]} colorScheme="dark">
      <Button
        onPress={onPress}
        testID={testID}
        modifiers={[
          buttonStyle(liquidGlass.isLiquidGlassAvailable() ? 'glass' : 'bordered'),
          buttonBorderShape('roundedRectangle', 24),
          frame({ minWidth: 0, maxWidth: Infinity, height: 84 }),
          accessibilityLabel(a11yLabel),
        ]}
      >
        <HStack spacing={12} alignment="center" modifiers={[padding({ all: 16 })]}>
          <Text modifiers={[font({ size: 26 }), frame({ width: 48, height: 48 }), backgroundOverlay({ color: groupColor }), cornerRadius(14), foregroundColor('#fff')]}>{groupEmoji}</Text>
          <VStack alignment="leading" spacing={4} modifiers={[frame({ minWidth: 0, maxWidth: Infinity })]}>
            <Text modifiers={[font({ size: 16.5, weight: 'bold' }), foregroundColor('#fff')]}>{teamName}</Text>
            <HStack spacing={7} alignment="center">
              <Text modifiers={[font({ size: 13 }), foregroundColor('rgba(255,255,255,0.65)')]}>{subtitle}</Text>
              {inviteCode ? <Text modifiers={[font({ size: 14.5, weight: 'bold' }), foregroundColor('#ff9500')]}>{inviteCode}</Text> : null}
            </HStack>
          </VStack>
          <HStack spacing={-8} alignment="center">
            {shownMembers.map((member, index) => (
              <Text key={index} modifiers={[font({ size: 16 }), frame({ width: 32, height: 32 }), foregroundColor('#fff')]}>{member.placeholder ? '•' : member.emoji}</Text>
            ))}
            {extraCount > 0 ? <Text modifiers={[font({ size: 12, weight: 'bold' }), foregroundColor('#fff')]}>{`+${extraCount}`}</Text> : null}
          </HStack>
          <Image systemName={expanded ? 'chevron.up' : 'chevron.down'} size={18} color="rgba(255,255,255,0.55)" />
        </HStack>
      </Button>
    </Host>
  );
}
