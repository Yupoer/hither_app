import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const androidPath = join(
  __dirname,
  '../../modules/hither-metrics/android/src/main/java/expo/modules/hithermetrics/HitherMetricsModule.kt',
);
const bridge = readFileSync(join(__dirname, '../native/metrics.ts'), 'utf8');

describe('Android metrics contract', () => {
  it('returns finite Android runtime metrics without iOS-only MetricKit keys', () => {
    expect(existsSync(androidPath)).toBe(true);
    const androidModule = readFileSync(androidPath, 'utf8');
    expect(androidModule).toContain('Debug.MemoryInfo');
    expect(androidModule).toContain('Runtime.getRuntime()');
    expect(androidModule).not.toContain('emptyMap<String, Any?>()');
    expect(androidModule).toContain('sampleRuntime');
    expect(androidModule).toContain('batteryLevel');
    expect(androidModule).toContain('memoryMb');
  });

  it('keeps drainPayloads empty until a reliable crash/ANR spool exists', () => {
    const androidModule = readFileSync(androidPath, 'utf8');
    expect(androidModule).toContain('drainPayloads');
    expect(androidModule).toMatch(/drainPayloads[\s\S]{0,200}emptyList/);
  });

  it('persists collection consent and launch phase breadcrumbs', () => {
    const androidModule = readFileSync(androidPath, 'utf8');
    expect(androidModule).toContain('setCollectionEnabled');
    expect(androidModule).toContain('collection_enabled');
    expect(androidModule).toContain('markLaunchPhase');
    expect(androidModule).toContain('previousLaunch');
    expect(androidModule).toContain('purgePayloads');
  });

  it('JS bridge still exposes the full PerformanceSample surface', () => {
    for (const key of [
      'cpuPercent',
      'memoryMb',
      'batteryLevel',
      'deviceModel',
      'osVersion',
    ]) {
      expect(bridge).toContain(key);
    }
  });
});
