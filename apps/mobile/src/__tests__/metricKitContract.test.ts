import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../');
const swiftPath = join(root, 'modules/hither-metrics/ios/HitherMetricsModule.swift');
const androidPath = join(
  root,
  'modules/hither-metrics/android/src/main/java/expo/modules/hithermetrics/HitherMetricsModule.kt',
);

describe('MetricKit native spool contract', () => {
  it('ships an iOS MetricKit subscriber with bounded atomic Application Support files', () => {
    expect(existsSync(swiftPath)).toBe(true);
    const swift = readFileSync(swiftPath, 'utf8');
    expect(swift).toContain('import MetricKit');
    expect(swift).toContain('class MetricKitSubscriber: NSObject, MXMetricManagerSubscriber');
    expect(swift).not.toContain('class HitherMetricsModule: Module, MXMetricManagerSubscriber');
    expect(swift).toContain('MXMetricManager.shared.add');
    expect(swift).toContain('MXMetricManager.shared.remove');
    expect(swift).toContain('didReceive(_ payloads: [MXMetricPayload])');
    expect(swift).toContain('didReceive(_ payloads: [MXDiagnosticPayload])');
    expect(swift).toContain('payload.jsonRepresentation()');
    expect(swift).toContain('options: .atomic');
    expect(swift).toContain('applicationSupportDirectory');
    expect(swift).toContain('maximumPayloadFiles = 20');
    expect(swift).toContain('OnCreate');
    expect(swift).toContain('OnDestroy');
    expect(swift).toContain('AsyncFunction("setCollectionEnabled")');
    expect(swift).toContain('AsyncFunction("purgePayloads")');
    const onCreate = swift.match(/OnCreate\s*\{[\s\S]*?\n\s*\}/);
    expect(onCreate?.[0] ?? '').toContain('prepare()');
    expect(onCreate?.[0] ?? '').not.toContain('MXMetricManager.shared.add');
  });

  it('gates collection via consent in App and optional JS bridge', () => {
    expect(existsSync(androidPath)).toBe(true);
    const android = readFileSync(androidPath, 'utf8');
    const bridge = readFileSync(join(root, 'src/native/metrics.ts'), 'utf8');
    const app = readFileSync(join(root, 'App.tsx'), 'utf8');
    // Android still returns empty MetricKit spool (no crash SDK).
    expect(android).toMatch(/drainPayloads[\s\S]{0,200}emptyList/);
    expect(bridge).toContain('drainPayloads');
    expect(bridge).toContain('removePayloads');
    expect(bridge).toContain('setCollectionEnabled');
    expect(bridge).toContain('purgePayloads');
    expect(app).toContain('diagnosticUploadEnabled');
    expect(app).toContain('setLogBatchSchedulerEnabled');
    expect(app).toContain('configureLogBatchScheduler');
    expect(app).toContain('metrics.setCollectionEnabled');
    expect(app).not.toMatch(/if \(initializing \|\| !user\) return;[\s\S]*drainPayloads/);
    expect(app).not.toContain("errorCode: 'metric_upload_failed'");
  });

  it('Android HitherMetrics declares the full JS bridge surface with runtime sampling', () => {
    const android = readFileSync(androidPath, 'utf8');
    for (const name of [
      'drainPayloads',
      'removePayloads',
      'samplePerformance',
      'setCollectionEnabled',
      'purgePayloads',
      'previousLaunch',
      'markLaunchPhase',
    ]) {
      expect(android).toContain(`AsyncFunction("${name}")`);
    }
    expect(android).toContain('sampleRuntime');
    expect(android).toContain('Debug.MemoryInfo');
  });

  it('reports false when HitherMetrics native module is absent', async () => {
    jest.resetModules();
    jest.doMock('expo-modules-core', () => ({
      requireOptionalNativeModule: () => null,
    }));
    const metrics = await import('../native/metrics');
    await expect(metrics.setCollectionEnabled(true)).resolves.toBe(false);
    await expect(metrics.purgePayloads()).resolves.toBeUndefined();
    await expect(metrics.drainPayloads()).resolves.toEqual([]);
    await expect(metrics.markLaunchPhase('js_root_mounted')).resolves.toBeUndefined();
    await expect(metrics.previousLaunch()).resolves.toBeNull();
  });

  it('reports safe defaults when HitherMetrics methods are missing', async () => {
    jest.resetModules();
    jest.doMock('expo-modules-core', () => ({
      // Module object exists (dev build) but methods not yet stubbed.
      requireOptionalNativeModule: () => ({}),
    }));
    const metrics = await import('../native/metrics');
    await expect(metrics.markLaunchPhase('js_root_mounted')).resolves.toBeUndefined();
    await expect(metrics.previousLaunch()).resolves.toBeNull();
    await expect(metrics.setCollectionEnabled(true)).resolves.toBe(false);
    await expect(metrics.purgePayloads()).resolves.toBeUndefined();
    await expect(metrics.drainPayloads()).resolves.toEqual([]);
  });

  it('persists only bounded launch phases and reports the previous incomplete launch', () => {
    const swift = readFileSync(swiftPath, 'utf8');
    const bridge = readFileSync(join(root, 'src/native/metrics.ts'), 'utf8');
    const app = readFileSync(join(root, 'App.tsx'), 'utf8');

    expect(swift).toContain('private enum LaunchPhase');
    expect(swift).toContain('AsyncFunction("previousLaunch")');
    expect(swift).toContain('AsyncFunction("markLaunchPhase")');
    expect(swift).toContain('Bundle.main.infoDictionary?["CFBundleVersion"]');
    expect(swift).not.toContain('synchronize()');
    expect(bridge).toContain('export async function previousLaunch');
    expect(bridge).toContain('export async function markLaunchPhase');
    // Double optional: module present + method missing must not throw.
    expect(bridge).toMatch(/markLaunchPhase\?\./);
    expect(bridge).toMatch(/previousLaunch\?\./);
    expect(app).toContain("metrics.markLaunchPhase('js_root_mounted')");
    expect(app).toContain("event: 'previous_launch_incomplete'");
  });
});
