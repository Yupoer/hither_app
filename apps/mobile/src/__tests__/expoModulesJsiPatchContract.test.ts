import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const actor = readFileSync(
  join(__dirname, '../../node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI/Runtime/JavaScriptActor.swift'),
  'utf8'
);

describe('expo-modules-jsi actor patch', () => {
  it('places the synchronous bridge state inside JavaScriptExecutor', () => {
    const executorStart = actor.indexOf('internal class JavaScriptExecutor: SerialExecutor, @unchecked Sendable {');
    const enqueueStart = actor.indexOf('  func enqueue(_ job: UnownedJob) {', executorStart);

    expect(executorStart).toBeGreaterThanOrEqual(0);
    expect(enqueueStart).toBeGreaterThan(executorStart);

    const executorHeader = actor.slice(executorStart, enqueueStart);
    expect(executorHeader).toContain('private let capture: JavaScriptJobCapture?');
    expect(executorHeader).toContain('private let owner: Thread?');
    expect(executorHeader).toContain('fileprivate init(capture: JavaScriptJobCapture? = nil, owner: Thread? = nil)');
  });
});
