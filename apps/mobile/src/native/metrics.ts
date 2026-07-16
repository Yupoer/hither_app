import { requireOptionalNativeModule } from 'expo-modules-core';

export interface MetricPayloadFile {
  id: string;
  kind: 'metric' | 'diagnostic';
  json: string;
  receivedAt: number;
}

interface HitherMetricsModule {
  drainPayloads(): Promise<MetricPayloadFile[]>;
  removePayloads(ids: string[]): Promise<void>;
}

const HitherMetrics = requireOptionalNativeModule<HitherMetricsModule>('HitherMetrics');

export async function drainPayloads(): Promise<MetricPayloadFile[]> {
  return await HitherMetrics?.drainPayloads() ?? [];
}

export async function removePayloads(ids: string[]): Promise<void> {
  if (ids.length > 0) await HitherMetrics?.removePayloads(ids);
}
