import React, { type ReactNode } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import Animated, { Easing, SlideInRight, SlideOutRight, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { SETTINGS_SHEET_CONTENT_INSET } from '../../../components/mapSheetChrome';
import { useMountEffect } from '../../../hooks/useMountEffect';

const PUSH_EASING = Easing.bezier(0.2, 0.9, 0.25, 1);
const PUSH = SlideInRight.duration(380).easing(PUSH_EASING);
const POP = SlideOutRight.duration(300).easing(Easing.out(Easing.cubic));
/** iOS slides a covered page a third of the way out while the next one pushes over it. */
const COVERED_SHIFT = -0.3;

export type SettingsStackPage<Key extends string> = { key: Key; fill?: boolean; content: ReactNode };

/**
 * Settings pages pushed inside one sheet. The newest page slides in from the trailing edge over the
 * page below, which shifts aside and fades so the translucent sheet never shows two pages at once.
 */
export function SettingsPageStack<Key extends string>({ pages, width, testID }: {
  pages: readonly SettingsStackPage<Key>[];
  width: number;
  testID?: string;
}) {
  return (
    <Animated.View testID={testID} style={styles.stack}>
      {pages.map((page, index) => (
        <StackPage key={`${index}:${page.key}`} depth={index} covered={index < pages.length - 1} width={width} fill={page.fill}>
          {page.content}
        </StackPage>
      ))}
    </Animated.View>
  );
}

function StackPage({ depth, covered, width, fill, children }: {
  depth: number;
  covered: boolean;
  width: number;
  fill?: boolean;
  children: ReactNode;
}) {
  const cover = useSharedValue(covered ? 1 : 0);
  const style = useAnimatedStyle(() => ({
    opacity: 1 - cover.get(),
    transform: [{ translateX: cover.get() * COVERED_SHIFT * width }],
  }));
  return (
    <Animated.View entering={depth > 0 ? PUSH : undefined} exiting={depth > 0 ? POP : undefined}
      pointerEvents={covered ? 'none' : 'auto'} accessibilityElementsHidden={covered}
      importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
      style={[StyleSheet.absoluteFill, style]}>
      <CoverTo key={String(covered)} value={cover} covered={covered} />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, fill && styles.fill]}
        keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </Animated.View>
  );
}

function CoverTo({ value, covered }: { value: SharedValue<number>; covered: boolean }) {
  useMountEffect(() => {
    value.set(withTiming(covered ? 1 : 0, { duration: covered ? 380 : 300, easing: covered ? PUSH_EASING : Easing.out(Easing.cubic) }));
  });
  return null;
}

const styles = StyleSheet.create({
  stack: { flex: 1, overflow: 'hidden' },
  scroll: { flex: 1 },
  content: { paddingTop: 16, paddingHorizontal: SETTINGS_SHEET_CONTENT_INSET, paddingBottom: 24 },
  fill: { flexGrow: 1 },
});
