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

interface HitherMetricsModule {
  drainPayloads(): Promise<MetricPayloadFile[]>;
  removePayloads(ids: string[]): Promise<void>;
  samplePerformance(windowMs: number): Promise<PerformanceSample>;
}

const HitherMetrics = requireOptionalNativeModule<HitherMetricsModule>('HitherMetrics');

export async function drainPayloads(): Promise<MetricPayloadFile[]> {
  return await HitherMetrics?.drainPayloads() ?? [];
}

export async function removePayloads(ids: string[]): Promise<void> {
  if (ids.length > 0) await HitherMetrics?.removePayloads(ids);
}

export async function samplePerformance(windowMs: number): Promise<PerformanceSample | null> {
  return await HitherMetrics?.samplePerformance(windowMs) ?? null;
}
