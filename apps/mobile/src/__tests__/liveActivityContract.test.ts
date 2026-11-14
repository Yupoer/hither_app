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
const mapScreen = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8') + '\n' + readFileSync(join(__dirname, '../screens/MapScreen/hooks/useAccountActions.ts'), 'utf8');
const androidModule = readFileSync(
  join(
    __dirname,
    '../../modules/hither-live-activity/android/src/main/java/expo/modules/hitherliveactivity/HitherLiveActivityModule.kt',
  ),
  'utf8',
);
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
    expect(nativeModule).toContain('OnCreate');
    expect(nativeModule).toContain('OnDestroy');
    expect(jsBridge).toContain('addPushToStartTokenListener');
    expect(liveHook).toContain('upsertDeviceActivityToken');
  });

  it('keeps app and widget ContentState shapes synchronized', () => {
    expect(contentStateShape(appAttributes)).toBe(contentStateShape(widgetAttributes));
    expect(contentStateShape(appAttributes)).toContain('memberArrived: [Bool]?');
    expect(contentStateShape(appAttributes)).toContain('destinationEmoji: String?');
    expect(contentStateShape(appAttributes)).toContain('language: String?');
    expect(contentStateShape(appAttributes)).toContain('destinationId: String?');
    expect(contentStateShape(appAttributes)).toContain('personalArrivalAtMs: Double?');
  });

  it('serializes native foreground/headless updates through the same snapshot merge', () => {
    expect(nativeModule).toContain('HitherLiveActivitySnapshot.merge(incoming: incoming, current: current)');
    expect(nativeModule.match(/await self\.snapshotUpdates\.perform/g)).toHaveLength(6);
    expect(nativeModule.match(/await self\.update\(activity, incoming: state\)/g)).toHaveLength(2);
    expect(liveHook).toContain('state.personalArrivalAtMs,');
    expect(jsBridge).toContain('personalArrived?: boolean;');
  });

  it('decodes and renders destinationEmoji on native Live Activity', () => {
    expect(appAttributes).toContain('destinationEmoji');
    expect(widgetAttributes).toContain('destinationEmoji');
    expect(jsBridge).toContain('destinationEmoji?: string');
    expect(appAttributes).toContain('destinationIcon');
    expect(widget).toContain('Text(presentation.icon)');
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

  it('adopts rotated push tokens on the reconciler before persist (#146 Sol)', () => {
    expect(liveHook).toContain('adoptPushToken');
    expect(liveHook).toContain('adoptObservedActivity');
    expect(liveHook).toContain('decidePushTokenAdoption');
    // Persist still uses reconciler token (updated by adopt).
    expect(liveHook).toContain('reconcilerRef.current?.currentPushToken');
    // Adoption success required before persist (no foreign id + stale token).
    expect(liveHook).toContain('if (!adopted) return');
    expect(liveHook).toContain('destinationId: event.destinationId');
    expect(liveHook).toContain('navigationSessionId: event.navigationSessionId');
    expect(nativeModule).toContain('row["navigationSessionId"] = sessionId');
    expect(nativeModule).toContain('row["destinationId"] = destinationId');
  });

  it('uses generation-aware lifecycle reconciler for start/stop races (#146)', () => {
    expect(liveHook).toContain('LiveActivityLifecycleReconciler');
    expect(liveHook).toContain("kind: 'start'");
    expect(liveHook).toContain("kind: 'stop'");
    expect(liveHook).toContain('clearSessions');
  });

  it('can end every Live Activity without a JS handle (leave / orphan cleanup)', () => {
    expect(nativeModule).toContain('endAllGroupActivities');
    expect(jsBridge).toContain('endAllGroupActivities');
    expect(liveHook).toContain('clearLiveActivities');
    expect(liveHook).toContain('endAllGroupActivities');
  });

  it('Android Live Activity module exposes every JS-facing method (Live Updates)', () => {
    for (const name of [
      'isSupported',
      'startGroupActivity',
      'updateGroupActivity',
      'updateAllGroupActivities',
      'endGroupActivity',
      'endAllGroupActivities',
      'startPushToStartTokenObservation',
      'observeExistingActivities',
      'listGroupActivities',
    ]) {
      expect(androidModule).toContain(name);
    }
    // Real Live Update service (not a pure no-op stub).
    expect(androidModule).toContain('HitherLiveUpdateService');
    expect(jsBridge).toMatch(/startPushToStartTokenObservation\?\./);
    expect(jsBridge).toMatch(/observeExistingActivities\?\./);
    expect(jsBridge).toMatch(/listGroupActivities\?\./);
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

  it('does not wipe title/avatars on background updateAll (#194 A6)', () => {
    const background = readFileSync(
      join(__dirname, '../state/backgroundJourney.ts'),
      'utf8',
    );
    expect(background).toContain('gatheringTitle: config.gatheringTitle');
    expect(background).toContain('memberEmojis: config.memberEmojis');
    expect(background).toContain('derivePersonalProgress');
    expect(background).not.toContain("groupName: ''");
  });

  it('uses personal initial distance and persisted member status in MapScreen', () => {
    expect(mapScreen).not.toContain('PROGRESS_REF_M');
    expect(mapScreen).toContain('gatedJourneyProgress(');
    const progressResource = readFileSync(join(__dirname, '../screens/MapScreen/MapJourneyProgressResources.tsx'), 'utf8');
    expect(progressResource).toContain('shouldAnchorInitial(');
    expect(mapScreen).not.toContain("m.status === 'arrived'");
    expect(mapScreen).toContain('a.destinationId === navTarget?.id && a.userId === m.userId');
    expect(mapScreen).toContain('memberArrived:');
  });

  it('connects all system presentations to the D6 card and phase deep link', () => {
    expect(widget.match(/LiveActivityCard\(presentation: presentation, expanded:/g)).toHaveLength(2);
    expect(widget).toContain('hither://live-activity/journey');
    expect(widget).toContain('hither://live-activity/team');
    expect(widget).toContain('MinimalActivity(presentation: presentation)');
    expect(widget).not.toContain('activityBackgroundTint');
    expect(widget).not.toContain('Text(timerInterval:');
  });
});
