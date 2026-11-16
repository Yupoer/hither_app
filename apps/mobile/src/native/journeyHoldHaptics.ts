import { requireOptionalNativeModule } from 'expo-modules-core';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

type NativeJourneyHold = {
  startJourneyHoldHaptics?: (durationMs: number, intervalMs: number) => Promise<void>;
  stopJourneyHoldHaptics?: () => Promise<void>;
};

const native = Platform.OS === 'ios' ? requireOptionalNativeModule<NativeJourneyHold>('HitherMetrics') : null;
const INTERVAL_MS = 30;

export function startJourneyHoldHaptics(durationMs: number): () => void {
  if (native?.startJourneyHoldHaptics && native.stopJourneyHoldHaptics) {
    void native.startJourneyHoldHaptics(durationMs, INTERVAL_MS).catch(() => undefined);
    const stop = native.stopJourneyHoldHaptics;
    return () => { void stop().catch(() => undefined); };
  }
  const pulse = () => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid).catch(() => undefined); };
  pulse();
  const timer = setInterval(pulse, INTERVAL_MS);
  return () => clearInterval(timer);
}
