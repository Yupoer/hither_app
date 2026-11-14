import { APP_TEXT_SIZE } from '../theme/typeScale';
import React, { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../i18n';
import { HitherText } from './HitherText';
import Pressable from './MotionPressable';

export default function TeamSwipeActions({ id, name, onLeave, children }: {
  id: string;
  name: string;
  onLeave: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const swipe = useRef<SwipeableMethods>(null);
  const [revealed, setRevealed] = useState(false);
  const leave = () => { swipe.current?.close(); onLeave(); };
  return (
    <ReanimatedSwipeable ref={swipe} testID={`team-swipe-${id}`} friction={1.6} rightThreshold={34} overshootRight={false}
      onSwipeableWillOpen={() => setRevealed(true)} onSwipeableOpen={() => setRevealed(true)}
      onSwipeableWillClose={() => setRevealed(false)}
      renderRightActions={() => (
        <View style={styles.slot} accessibilityElementsHidden={!revealed} importantForAccessibility={revealed ? 'auto' : 'no-hide-descendants'}>
          <Pressable style={styles.leave} testID="team-leave" accessibilityRole="button" accessibilityLabel={`${t('teams.leave')}：${name}`} onPress={leave}>
            <Ionicons name="exit-outline" size={20} color="#fff" />
            <HitherText style={styles.label}>{t('teams.leave')}</HitherText>
          </Pressable>
        </View>
      )}>
      {children}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  slot: { marginStart: 10, justifyContent: 'center' },
  leave: { minWidth: 74, minHeight: 50, borderRadius: 26, paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row',
    justifyContent: 'center', alignItems: 'center', gap: 5, backgroundColor: '#BA3545' },
  label: { color: '#fff', fontSize: APP_TEXT_SIZE.caption, fontWeight: '700' },
});
