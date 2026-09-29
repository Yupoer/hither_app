import React from 'react';
import { Pressable, Text, View } from 'react-native';
import type { AppNotice } from '../state/appNotice';
export interface NoticeContentProps { notice: AppNotice; dismiss: () => void; closeLabel: string; }
export default function AppNoticeContent({ notice, dismiss, closeLabel }: NoticeContentProps) {
  return <View style={{ backgroundColor: '#24262C', borderRadius: 22, padding: 16, gap: 8 }}>
    <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>{notice.title}</Text>
    {notice.message ? <Text style={{ color: '#FFFFFF' }}>{notice.message}</Text> : null}
    {notice.onAction ? <Pressable accessibilityRole="button" onPress={() => { dismiss(); void notice.onAction?.(); }}>
      <Text style={{ color: '#F5B142' }}>{notice.actionLabel}</Text>
    </Pressable> : null}
    <Pressable accessibilityRole="button" onPress={dismiss}><Text style={{ color: '#F5B142' }}>{closeLabel}</Text></Pressable>
  </View>;
}
