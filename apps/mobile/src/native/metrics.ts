import { requireOptionalNativeModule } from 'expo-modules-core';

export interface MetricPayloadFile {
  id: string;
  kind: 'metric' | 'diagnostic';
  json: string;
  receivedAt: number;
}

export interface PerformanceSample {
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
  return (await HitherMetrics?.samplePerformance?.(windowMs)) ?? null;
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
