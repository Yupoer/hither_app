import React from 'react';
import { Host, VStack, HStack, Text, Button, Spacer } from '@expo/ui/swift-ui';
import { background, buttonStyle, cornerRadius, font, foregroundColor, frame, padding } from '@expo/ui/swift-ui/modifiers';
import type { NoticeContentProps } from './AppNoticeContent';

/** Text, material and actions are SwiftUI views, including native accessibility. */
export default function AppNoticeContent({ notice, dismiss, closeLabel }: NoticeContentProps) {
  return <Host matchContents={{ vertical: true }} colorScheme="dark">
    <VStack alignment="leading" spacing={8} modifiers={[
      frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ all: 16 }),
      background('#24262C'), cornerRadius(22),
    ]}>
      <Text modifiers={[font({ size: 16, weight: 'semibold' }), foregroundColor('#FFFFFF')]}>{notice.title}</Text>
      {notice.message ? <Text modifiers={[font({ size: 14 }), foregroundColor('#FFFFFF')]}>{notice.message}</Text> : null}
      <HStack spacing={12}>
        <Spacer />
        {notice.onAction ? <Button onPress={() => { dismiss(); void notice.onAction?.(); }} modifiers={[buttonStyle('bordered')]}><Text>{notice.actionLabel}</Text></Button> : null}
        <Button onPress={dismiss} modifiers={[buttonStyle('bordered')]}><Text>{closeLabel}</Text></Button>
      </HStack>
    </VStack>
  </Host>;
}
