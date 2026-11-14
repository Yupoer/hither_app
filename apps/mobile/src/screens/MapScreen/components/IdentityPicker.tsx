import React, { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Pressable from '../../../components/MotionPressable';
import { HitherText } from '../../../components/HitherText';
import { AVATAR_EMOJI, HOME_AVATAR_COLORS } from '../../../constants/avatars';
import { useMountEffect } from '../../../hooks/useMountEffect';
import { useTranslation } from '../../../i18n';
import { useReducedMotion } from 'react-native-reanimated';
import { selectionTick } from '../../../utils/haptics';

const EMOJI_WIDTH = 60;
const EMOJI_STRIDE = 70;
const COLOR_NAMES = {
  '#E0634A': { zh: '珊瑚紅', en: 'Coral red' },
  '#F08A3C': { zh: '橘色', en: 'Orange' },
  '#F3C443': { zh: '黃色', en: 'Yellow' },
  '#5FB36B': { zh: '綠色', en: 'Green' },
  '#3FB3A6': { zh: '藍綠色', en: 'Teal' },
  '#4A90E2': { zh: '藍色', en: 'Blue' },
  '#8A6AD9': { zh: '紫色', en: 'Purple' },
  '#E06A9E': { zh: '粉紅色', en: 'Pink' },
} satisfies Record<(typeof HOME_AVATAR_COLORS)[number], { zh: string; en: string }>;

function CenterAvatar({ center }: { center: () => void }) {
  useMountEffect(center);
  return null;
}

export function AvatarColors({ color, onChange, label, prefix }: {
  color: string;
  onChange: (value: string) => void;
  label: string;
  prefix: string;
}) {
  const { language } = useTranslation();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.colors} keyboardShouldPersistTaps="handled">
      {HOME_AVATAR_COLORS.map(value => (
        <Pressable key={value} testID={`${prefix}-color-${value}`}
          onPress={() => { selectionTick(); onChange(value); }}
          accessibilityRole="button"
          accessibilityLabel={`${label} ${COLOR_NAMES[value][language]}`}
          accessibilityState={{ selected: color === value }}
          style={styles.colorTap}
        >
          <View style={[styles.colorRing, color === value && styles.colorRingSelected]}>
            <View style={[styles.swatch, { backgroundColor: value }]} />
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function EmojiCarousel({ avatar, color, onChange, prefix }: {
  avatar: string;
  color: string;
  onChange: (value: string) => void;
  prefix: string;
}) {
  const scroll = useRef<ScrollView>(null);
  const reducedMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const initialAvatar = useRef(avatar);
  const indexFor = (value: string) => Math.max(0, AVATAR_EMOJI.findIndex(emoji => emoji === value));
  const [positioned, setPositioned] = useState(false);
  const [centeredAvatar, setCenteredAvatar] = useState(avatar);
  const centerAvatar = (value: string, animated: boolean) => {
    setCenteredAvatar(value);
    scroll.current?.scrollTo({ x: indexFor(value) * EMOJI_STRIDE, animated: animated && !reducedMotion });
  };

  const chooseNearest = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / EMOJI_STRIDE);
    const next = AVATAR_EMOJI[index];
    if (!next) return;
    setCenteredAvatar(next);
    if (next !== avatar) {
      selectionTick();
      onChange(next);
    }
  };

  return (
    <View style={styles.carousel} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      {positioned && avatar !== centeredAvatar ? <CenterAvatar key={avatar} center={() => centerAvatar(avatar, true)} /> : null}
      {width > 0 ? (
        <ScrollView ref={scroll} horizontal decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          snapToInterval={EMOJI_STRIDE}
          onMomentumScrollEnd={chooseNearest}
          onScrollEndDrag={event => {
            if (Math.abs(event.nativeEvent.velocity?.x ?? 0) < 0.05) chooseNearest(event);
          }}
          onContentSizeChange={() => {
            if (positioned) return;
            centerAvatar(initialAvatar.current, false);
            setPositioned(true);
          }}
          contentContainerStyle={[styles.emojiRow, { paddingHorizontal: Math.max(0, (width - EMOJI_WIDTH) / 2) }]}
        >
          {AVATAR_EMOJI.map(value => (
            <Pressable key={value}
              testID={`${prefix}-avatar-${value}`}
              accessibilityRole="button"
              accessibilityLabel={value}
              accessibilityState={{ selected: avatar === value }}
              onPress={() => {
                selectionTick();
                onChange(value);
                centerAvatar(value, true);
              }}
              style={[styles.emoji, avatar === value && { backgroundColor: color, borderColor: '#fff', transform: [{ scale: 1.18 }] }]}
            >
              <HitherText typeRole="emoji" style={styles.emojiText}>{value}</HitherText>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  colors: { flexGrow: 1, flexDirection: 'row', justifyContent: 'center' },
  colorTap: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  colorRing: { width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  colorRingSelected: { borderColor: '#fff' },
  swatch: { width: 28, height: 28, borderRadius: 14 },
  carousel: { alignSelf: 'stretch', marginHorizontal: -16, marginTop: 16 },
  emojiRow: { gap: 10, alignItems: 'center', paddingVertical: 14 },
  emoji: { width: EMOJI_WIDTH, height: EMOJI_WIDTH, borderRadius: EMOJI_WIDTH / 2, borderWidth: 2, borderColor: 'transparent', backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center' },
  emojiText: { fontSize: 32 },
});
