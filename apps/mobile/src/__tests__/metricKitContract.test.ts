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
    expect(swift).toContain('MXMetricManager.shared.add(subscriber)');
    expect(swift).toContain('MXMetricManager.shared.remove(subscriber)');
    expect(swift).toContain('didReceive(_ payloads: [MXMetricPayload])');
    expect(swift).toContain('didReceive(_ payloads: [MXDiagnosticPayload])');
    expect(swift).toContain('payload.jsonRepresentation()');
    expect(swift).toContain('options: .atomic');
    expect(swift).toContain('applicationSupportDirectory');
    expect(swift).toContain('maximumPayloadFiles = 20');
    expect(swift).toContain('OnCreate');
    expect(swift).toContain('OnDestroy');
  });

  it('exposes drain/remove on both native platforms and startup ingestion in App', () => {
    expect(existsSync(androidPath)).toBe(true);
    const android = readFileSync(androidPath, 'utf8');
    const bridge = readFileSync(join(root, 'src/native/metrics.ts'), 'utf8');
    const app = readFileSync(join(root, 'App.tsx'), 'utf8');
    expect(android).toContain('emptyList');
    expect(bridge).toContain('drainPayloads');
    expect(bridge).toContain('removePayloads');
    expect(app).toContain('metrics.drainPayloads()');
    expect(app).toContain('uploadMetricPayload');
    expect(app).toContain('metrics.removePayloads(acknowledgedIds)');
    expect(app).toContain("errorCode: 'metric_upload_failed'");
    expect(app).not.toContain("event: 'metric_payload_received'");
  });
});
