import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { MEMBER_COLORS } from '../../glass';
import CrookIcon from '../../components/CrookIcon';
import { HitherText } from '../../components/HitherText';
import { useFontLayout } from '../../a11y/useFontScaleBucket';
import { useTheme } from '../../state/PreferencesContext';
import { useTranslation } from '../../i18n';
import { OnboardingIcons } from '../icons';
import type { StepProps } from '../types';
import StepShell from './StepShell';
import PrimaryButton from './PrimaryButton';

const MEMBER_ICONS = [
  OnboardingIcons.memberCool,
  OnboardingIcons.memberFox,
  OnboardingIcons.memberCompass,
  OnboardingIcons.memberBackpack,
] as const;
const STAGE_W = 280;
/** Scatter positions (from center) then settle on a soft arc. */
const SCATTER: { x: number; y: number }[] = [
  { x: -110, y: -36 },
  { x: 108, y: -28 },
  { x: -88, y: 52 },
  { x: 96, y: 48 },
];
const GATHER: { x: number; y: number }[] = [
  { x: -48, y: 28 },
  { x: -16, y: 42 },
  { x: 16, y: 42 },
  { x: 48, y: 28 },
];

function MemberDot({
  index,
  icon,
  color,
  reduceMotion,
}: {
  index: number;
  icon: ImageSourcePropType;
  color: string;
  reduceMotion: boolean;
}) {
  const scatter = SCATTER[index];
  const gather = GATHER[index];
  const progress = useSharedValue(reduceMotion ? 1 : 0);
  const opacity = useSharedValue(reduceMotion ? 1 : 0.35);

  useEffect(() => {
    if (reduceMotion) {
      progress.value = 1;
      opacity.value = 1;
      return;
    }
    // Scatter visible → gather spring (staggered). Members freeze at settle.
    opacity.value = withTiming(0.55, { duration: 400, easing: Easing.out(Easing.cubic) });
    progress.value = withDelay(
      900 + index * 70,
      withSpring(1, { stiffness: 180, damping: 16 }),
    );
    opacity.value = withDelay(
      900 + index * 70,
      withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  const style = useAnimatedStyle(() => {
    const t = progress.value;
    const x = scatter.x + (gather.x - scatter.x) * t;
    const y = scatter.y + (gather.y - scatter.y) * t;
    return {
      transform: [{ translateX: x }, { translateY: y }],
      opacity: opacity.value,
    };
  });

  return (
    <Animated.View style={[styles.member, { backgroundColor: color }, style]}>
      <Image source={icon} style={styles.memberIcon} resizeMode="contain" accessibilityIgnoresInvertColors />
    </Animated.View>
  );
}

function accentGlow(accent: string): string {
  const hex = accent.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, 0.08)`;
}

function GatherStage({ reduceMotion }: { reduceMotion: boolean }) {
  const { colors } = useTheme();
  const { scale } = useFontLayout();
  // Stage shrinks as type grows (and grows back when type shrinks) — continuous.
  const stageH = Math.round(Math.min(240, Math.max(160, 240 / scale)));

  const beaconOpacity = useSharedValue(reduceMotion ? 1 : 0);
  const beaconScale = useSharedValue(reduceMotion ? 1 : 0.85);

  useEffect(() => {
    if (reduceMotion) {
      beaconScale.value = 1;
      beaconOpacity.value = withRepeat(
        withSequence(
          withTiming(0.85, { duration: 1250 }),
          withTiming(1, { duration: 1250 }),
        ),
        -1,
        false,
      );
      return;
    }
    // Call 400–900ms, then after settle (~2.2s) slow breath — no scatter loop.
    beaconScale.value = withDelay(
      400,
      withSpring(1, { stiffness: 160, damping: 14 }),
    );
    beaconOpacity.value = withDelay(
      400,
      withSequence(
        withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) }),
        withDelay(
          1300,
          withRepeat(
            withSequence(
              withTiming(0.85, { duration: 1250 }),
              withTiming(1, { duration: 1250 }),
            ),
            -1,
            false,
          ),
        ),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  const beaconStyle = useAnimatedStyle(() => ({
    opacity: beaconOpacity.value,
    transform: [{ scale: beaconScale.value }],
  }));

  return (
    <View style={[styles.stage, { minHeight: stageH, width: STAGE_W }]}>
      <View style={[styles.glow, { backgroundColor: accentGlow(colors.accent) }]} />
      <Animated.View style={[styles.beacon, beaconStyle]}>
        <View style={[styles.beaconCore, { backgroundColor: colors.accent }]}>
          <CrookIcon size={28} color={colors.accentText} />
        </View>
        <Image
          source={OnboardingIcons.flag}
          style={styles.flag}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      </Animated.View>
      {MEMBER_ICONS.map((icon, i) => (
        <MemberDot
          key={i}
          index={i}
          icon={icon}
          color={MEMBER_COLORS[i % MEMBER_COLORS.length]}
          reduceMotion={reduceMotion}
        />
      ))}
    </View>
  );
}

export default function IntroStep({ onAnswer, onSkip }: StepProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (active) setReduceMotion(!!v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
      setReduceMotion(!!v);
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  return (
    <StepShell
      step="intro"
      role={undefined}
      title={t('onboarding.intro.title')}
      onSkip={onSkip}
      footer={<PrimaryButton label={t('onboarding.intro.start')} onPress={() => onAnswer({})} />}
    >
      <View style={styles.body}>
        <GatherStage reduceMotion={reduceMotion} />
        <HitherText typeRole="body" style={[styles.caption, { color: colors.textSecondary }]}>
          {t('onboarding.intro.body')}
        </HitherText>
      </View>
    </StepShell>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  stage: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  glow: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
  },
  beacon: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  beaconCore: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flag: {
    position: 'absolute',
    right: -12,
    top: -10,
    width: 20,
    height: 20,
  },
  member: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.55)',
    zIndex: 1,
  },
  memberIcon: { width: 22, height: 22 },
  caption: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    paddingHorizontal: 12,
    marginTop: 8,
  },
});
