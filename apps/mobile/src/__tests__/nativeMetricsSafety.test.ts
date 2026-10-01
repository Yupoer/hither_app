import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const mockNative: Record<string, any> = {};
jest.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => mockNative }));
import * as metrics from '../native/metrics';
import { getRuntimePowerState, optionalVisualsAllowed, updateRuntimePowerState } from '../state/runtimePowerState';

beforeEach(() => { for (const key of Object.keys(mockNative)) delete mockNative[key]; });

it('keeps power safety independent of consent and fences stale initial reads and released listeners', async () => {
  let event: (value: any) => void = () => undefined;
  let resolve: (value: any) => void = () => undefined;
  const remove = jest.fn();
  mockNative.addListener = jest.fn((_name, callback) => { event = callback; return { remove }; });
  mockNative.getPowerState = jest.fn(() => new Promise(done => { resolve = done; }));
  mockNative.setCollectionEnabled = jest.fn();
  const stop = metrics.startRuntimePowerMonitoring();
  event({ thermalState: 'fair', lowPowerMode: false });
  resolve({ thermalState: 'nominal', lowPowerMode: false });
  await Promise.resolve();
  expect(getRuntimePowerState().thermalState).toBe('fair');
  expect(optionalVisualsAllowed(getRuntimePowerState())).toBe(false);
  expect(mockNative.setCollectionEnabled).not.toHaveBeenCalled();
  stop();
  event({ thermalState: 'nominal', lowPowerMode: false });
  expect(getRuntimePowerState().thermalState).toBe('fair');
  expect(remove).toHaveBeenCalledTimes(1);
  for (const thermalState of ['fair', 'serious', 'critical', 'unknown', null]) {
    expect(optionalVisualsAllowed({ thermalState, lowPowerMode: false })).toBe(false);
  }
  expect(optionalVisualsAllowed({ thermalState: 'nominal', lowPowerMode: true })).toBe(false);
  expect(optionalVisualsAllowed({ thermalState: 'nominal', lowPowerMode: false })).toBe(true);
});

it('refreshes initial power once and keeps partial or rejected native capabilities safe', async () => {
  mockNative.getPowerState = async () => ({ thermalState: 'nominal', lowPowerMode: false });
  metrics.startRuntimePowerMonitoring()();
  await Promise.resolve();
  updateRuntimePowerState({ thermalState: 'serious', lowPowerMode: false });
  metrics.startRuntimePowerMonitoring();
  await Promise.resolve();
  expect(getRuntimePowerState().thermalState).toBe('nominal');
  mockNative.addListener = () => { throw Error('old binary'); };
  mockNative.getPowerState = () => { throw Error('old binary'); };
  metrics.startRuntimePowerMonitoring()();
  mockNative.getPowerState = async () => { throw Error('unavailable'); };
  metrics.startRuntimePowerMonitoring()();
  await Promise.resolve();
  expect(await metrics.samplePerformance(1000)).toBeNull();
  expect(await metrics.setCollectionEnabled(false)).toBe(false);
  expect(await metrics.drainPayloads()).toEqual([]);
  expect(await metrics.previousLaunch()).toBeNull();
  await metrics.purgePayloads();
  await metrics.removePayloads([]);
  await metrics.markLaunchPhase('stable');
  await metrics.signpost('snapshot', 'event');
});

it('forwards the existing optional metrics boundary and consent cleanup', async () => {
  const sample = { cpuTimeMs: 10, thermalState: 'nominal', lowPowerMode: false };
  mockNative.samplePerformance = jest.fn(async () => sample);
  mockNative.setCollectionEnabled = jest.fn(async () => true);
  mockNative.drainPayloads = jest.fn(async () => [{ id: 'file' }]);
  mockNative.removePayloads = jest.fn();
  mockNative.purgePayloads = jest.fn();
  mockNative.previousLaunch = jest.fn(async () => ({ phase: 'stable' }));
  mockNative.markLaunchPhase = jest.fn();
  mockNative.signpost = jest.fn();
  expect(await metrics.samplePerformance(1000)).toBe(sample);
  expect(await metrics.setCollectionEnabled(false)).toBe(true);
  await metrics.purgePayloads();
  await metrics.removePayloads(['file']);
  await metrics.markLaunchPhase('stable');
  await metrics.signpost('route_calculation', 'begin', 'token');
  expect(await metrics.drainPayloads()).toEqual([{ id: 'file' }]);
  expect(await metrics.previousLaunch()).toEqual({ phase: 'stable' });
  expect(mockNative.removePayloads).toHaveBeenCalledWith(['file']);
  expect(mockNative.purgePayloads).toHaveBeenCalledTimes(1);
  expect(mockNative.signpost).toHaveBeenCalledWith('route_calculation', 'begin', 'token');
});

it('keeps native metric semantics cumulative and display cadence calibrated without polling power', () => {
  const native = readFileSync(join(__dirname, '../../modules/hither-metrics/ios/HitherMetricsModule.swift'), 'utf8');
  expect(native).toContain('getrusage(RUSAGE_SELF, &usage)');
  expect(native).toContain('link.targetTimestamp - link.timestamp');
  expect(native).toContain('guard self.sampleGeneration == generation');
  expect(native).toContain('guard self.enabled, self.displayLink == nil');
  expect(native).toContain('Events("powerStateChanged")');
  expect(native).toContain('ProcessInfo.thermalStateDidChangeNotification');
  expect(native).toContain('MXMetricManager.makeLogHandle');
  expect(native).toContain('mxSignpost(');
  expect(native).not.toContain('task_flavor_t(TASK_THREAD_TIMES_INFO)');
});
