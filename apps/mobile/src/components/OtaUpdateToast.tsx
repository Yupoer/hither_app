/**
 * Global top toast when an EAS OTA just applied (any screen).
 * Mount once under SafeAreaProvider so insets are correct.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { glass } from '../glass';
import { useTranslation } from '../i18n';
import { consumeOtaAppliedNotice } from '../utils/otaUpdates';

const VISIBLE_MS = 3200;
const FADE_MS = 280;

export default function OtaUpdateToast() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-12)).current;

  useEffect(() => {
    let cancelled = false;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    void (async () => {
      const show = await consumeOtaAppliedNotice();
      if (cancelled || !show) return;
      setVisible(true);
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: FADE_MS,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: FADE_MS,
          useNativeDriver: true,
        }),
      ]).start();

      hideTimer = setTimeout(() => {
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 0,
            duration: FADE_MS,
            useNativeDriver: true,
          }),
          Animated.timing(translateY, {
            toValue: -8,
            duration: FADE_MS,
            useNativeDriver: true,
          }),
        ]).start(({ finished }) => {
          if (finished && !cancelled) setVisible(false);
        });
      }, VISIBLE_MS);
    })();

    return () => {
      cancelled = true;
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [opacity, translateY]);

  if (!visible) return null;

  return (
    <View
      pointerEvents="none"
      style={[styles.host, { paddingTop: Math.max(insets.top, 8) + 4 }]}
    >
      <Animated.View
        style={[
          styles.pill,
          {
            opacity,
            transform: [{ translateY }],
          },
        ]}
        accessibilityLiveRegion="polite"
        accessibilityRole="text"
      >
        <Text style={styles.text} numberOfLines={1}>
          {t('ota.appliedToast')}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    elevation: 9999,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  pill: {
    maxWidth: 360,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: glass.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(245, 177, 66, 0.45)',
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  text: {
    color: '#F5F7FB',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
});
