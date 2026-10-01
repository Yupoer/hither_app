import { requireOptionalNativeModule } from 'expo-modules-core';
import { updateRuntimePowerState, type RuntimePowerState } from '../state/runtimePowerState';

export interface MetricPayloadFile {
  id: string;
  kind: 'metric' | 'diagnostic';
  json: string;
  receivedAt: number;
}

export interface PerformanceSample {
  processCpuTimeMs?: number | null;
  processSampleTimestampMs?: number | null;
  cpuTimeKind?: 'cumulative' | 'window' | null;
  cpuCorePercent?: number | null;
  processorCount?: number | null;
  sampleWindowMs?: number | null;
  mainThreadDelayMs?: number | null;
  sampledMemoryPeakMb?: number | null;
  memoryWarningCount?: number | null;
  nativeAppVersion?: string | null;
  nativeBuildNumber?: string | null;
  hardwareModel?: string | null;
  cpuPercent: number | null;
  cpuTimeMs: number | null;
  memoryMb: number | null;
  uiFps: number | null;
  frameTimeP95Ms: number | null;
  missedFrameRatio: number | null;
  displayMaxFps: number | null;
  batteryLevel: number | null;
  batteryState: string | null;
  lowPowerMode: boolean | null;
  thermalState: string | null;
  appState: string | null;
  deviceModel: string | null;
  osVersion: string | null;
}

export type LaunchPhase =
  | 'js_root_mounted'
  | 'session_resolved'
  | 'navigation_ready'
  | 'stable';

export type EnergySignpostPhase = 'begin' | 'end' | 'event';

export interface PreviousLaunch {
  phase: string;
  build: string;
  recordedAt: number;
}

interface HitherMetricsModule {
  getPowerState?: () => Promise<RuntimePowerState | null>;
  addListener?: (event: 'powerStateChanged', listener: (state: RuntimePowerState) => void) => { remove: () => void };
  drainPayloads?: () => Promise<MetricPayloadFile[]>;
  removePayloads?: (ids: string[]) => Promise<void>;
  samplePerformance?: (windowMs: number) => Promise<PerformanceSample | null>;
  setCollectionEnabled?: (enabled: boolean) => Promise<boolean>;
  purgePayloads?: () => Promise<void>;
  previousLaunch?: () => Promise<PreviousLaunch | null>;
  markLaunchPhase?: (phase: LaunchPhase) => Promise<void>;
  signpost?: (
    name: string,
    phase: EnergySignpostPhase,
    token?: string,
  ) => Promise<void>;
}

const HitherMetrics = requireOptionalNativeModule<HitherMetricsModule>('HitherMetrics');

export async function drainPayloads(): Promise<MetricPayloadFile[]> {
  return (await HitherMetrics?.drainPayloads?.()) ?? [];
}

export async function removePayloads(ids: string[]): Promise<void> {
  if (ids.length > 0) await HitherMetrics?.removePayloads?.(ids);
}

export async function samplePerformance(windowMs: number): Promise<PerformanceSample | null> {
  const sample = (await HitherMetrics?.samplePerformance?.(windowMs)) ?? null;
  if (!HitherMetrics?.getPowerState || !HitherMetrics?.addListener) updateRuntimePowerState(sample);
  return sample;
}

export async function setCollectionEnabled(enabled: boolean): Promise<boolean> {
  return (await HitherMetrics?.setCollectionEnabled?.(enabled)) ?? false;
}

export async function purgePayloads(): Promise<void> {
  await HitherMetrics?.purgePayloads?.();
}

export async function previousLaunch(): Promise<PreviousLaunch | null> {
  return (await HitherMetrics?.previousLaunch?.()) ?? null;
}

export async function markLaunchPhase(phase: LaunchPhase): Promise<void> {
  await HitherMetrics?.markLaunchPhase?.(phase);
}

/**
 * Emit an allow-listed native signpost when the custom module is available.
 * The JS energyObservability seam owns the allowlist; this bridge remains
 * optional so Expo Go and Jest continue to operate without native support.
 */
export async function signpost(
  name: string,
  phase: EnergySignpostPhase,
  token?: string,
): Promise<void> {
  await HitherMetrics?.signpost?.(name, phase, token);
}

/** Safety consumes notifications and one initial read, never the diagnostic sampler. */
export function startRuntimePowerMonitoring(): () => void {
  let stopped = false;
  updateRuntimePowerState({ thermalState: 'unknown', lowPowerMode: null });
  let revision = 0;
  let subscription: { remove: () => void } | undefined;
  try {
    subscription = HitherMetrics?.addListener?.('powerStateChanged', state => {
      if (stopped) return;
      revision += 1;
      updateRuntimePowerState(state);
    });
  } catch { /* Partial native runtimes stay safely static. */ }
  const initialRevision = revision;
  try {
    void HitherMetrics?.getPowerState?.().then(state => {
      if (!stopped && revision === initialRevision) updateRuntimePowerState(state);
    }).catch(() => undefined);
  } catch { /* Optional native API may be unavailable in older binaries. */ }
  return () => { stopped = true; subscription?.remove(); };
}
