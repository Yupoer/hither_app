import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const nativeModule = readFileSync(
  join(
    __dirname,
    '../../modules/hither-live-activity/ios/HitherLiveActivityModule.swift',
  ),
  'utf8',
);
const appAttributes = readFileSync(
  join(
    __dirname,
    '../../modules/hither-live-activity/ios/HitherGroupAttributes.swift',
  ),
  'utf8',
);
const widgetAttributes = readFileSync(
  join(__dirname, '../../targets/live-activity/HitherGroupAttributes.swift'),
  'utf8',
);
const jsBridge = readFileSync(join(__dirname, '../native/liveActivity.ts'), 'utf8');
const liveHook = readFileSync(join(__dirname, '../state/useLiveActivity.ts'), 'utf8');
const mapScreen = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');
const widget = readFileSync(
  join(__dirname, '../../targets/live-activity/HitherLiveActivity.swift'),
  'utf8',
);

function contentStateShape(source: string): string {
  return (
    source
      .match(/public struct ContentState[\s\S]*?public var groupName/)?.[0]
      .replace(/^\s*\/\/\/.*$/gm, '')
      .replace(/\s+/g, ' ')
      .trim() ?? ''
  );
}

describe('ActivityKit remote push contract', () => {
  it('requests a push token and publishes token rotations', () => {
    expect(nativeModule).toContain('pushType: .token');
    expect(nativeModule).toContain('pushTokenUpdates');
    expect(nativeModule).toContain('onPushToken');
    expect(nativeModule).toContain('activityId');
    expect(nativeModule).toContain('pushToken');
  });

  it('observes iOS 17.2 push-to-start token startup and rotations', () => {
    expect(nativeModule).toContain('Activity<HitherGroupAttributes>.pushToStartTokenUpdates');
    expect(nativeModule).toContain('#available(iOS 17.2, *)');
    expect(nativeModule).toContain('onPushToStartToken');
    expect(nativeModule).toContain('pushToStartTask');
    expect(nativeModule).toContain('OnCreate');
    expect(nativeModule).toContain('OnDestroy');
    expect(jsBridge).toContain('addPushToStartTokenListener');
    expect(liveHook).toContain('upsertDeviceActivityToken');
  });

  it('keeps app and widget ContentState shapes synchronized', () => {
    expect(contentStateShape(appAttributes)).toBe(contentStateShape(widgetAttributes));
    expect(contentStateShape(appAttributes)).toContain('memberArrived: [Bool]?');
  });

  it('exposes activity id, push token and per-member arrival to TypeScript', () => {
    expect(jsBridge).toContain('export interface ActivityStartResult');
    expect(jsBridge).toContain('activityId: string');
    expect(jsBridge).toContain('pushToken?: string');
    expect(jsBridge).toContain('memberArrived?: boolean[]');
  });

  it('registers and removes the Supabase live activity session in the hook', () => {
    expect(liveHook).toContain('upsertLiveActivitySession');
    expect(liveHook).toContain('deleteLiveActivitySession');
    expect(liveHook).toContain('addPushTokenListener');
  });

  it('can end every Live Activity without a JS handle (leave / orphan cleanup)', () => {
    expect(nativeModule).toContain('endAllGroupActivities');
    expect(jsBridge).toContain('endAllGroupActivities');
    expect(liveHook).toContain('clearLiveActivities');
    expect(liveHook).toContain('endAllGroupActivities');
  });

  it('clears Live Activities on leave, sign-out, and MyTeams leave', () => {
    const session = readFileSync(join(__dirname, '../state/SessionContext.tsx'), 'utf8');
    const myTeams = readFileSync(join(__dirname, '../screens/MyTeamsScreen.tsx'), 'utf8');
    expect(session).toContain('clearLiveActivities');
    expect(session).toContain('leaveGroupWithJourneyCleanup');
    expect(session).toContain('signOutWithJourneyCleanup');
    expect(myTeams).toContain('clearLiveActivities');
    expect(mapScreen).toContain('clearLiveActivities');
    expect(mapScreen).toContain('leaveGroups');
  });

  it('uses personal initial distance and persisted member status in MapScreen', () => {
    expect(mapScreen).not.toContain('PROGRESS_REF_M');
    expect(mapScreen).toContain('gatedJourneyProgress(');
    expect(mapScreen).toContain('shouldAnchorInitial(');
    expect(mapScreen).toContain("m.status === 'arrived'");
    expect(mapScreen).toContain('memberArrived:');
  });

  it('matches the approved black capsule information hierarchy', () => {
    expect(widget).toContain('static let card = Color.black');
    expect(widget).toContain('前往集合點 · GATHERING AT');
    expect(widget).toContain('已抵達');
    expect(widget).toContain('ProgressBar');
    expect(widget).toContain('formattedDistance');
    expect(widget).toContain('etaText');
  });

  it('dims each member from its own arrived boolean', () => {
    expect(widget).toContain('let arrived: [Bool]');
    expect(widget).toContain('isArrived = arrived.indices.contains(i) && arrived[i]');
    expect(widget).toContain('.opacity(isArrived ? 1 : 0.35)');
    expect(widget).toContain('.saturation(isArrived ? 1 : 0.25)');
    expect(widget).not.toContain('let gathered: Int');
  });
});
