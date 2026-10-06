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
    expect(nativeModule).toContain('pushToStartTask');
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
    expect(nativeModule.match(/await self\.snapshotUpdates\.perform/g)).toHaveLength(5);
    expect(nativeModule.match(/await self\.update\(activity, incoming: state\)/g)).toHaveLength(2);
    expect(liveHook).toContain('state.personalArrivalAtMs,');
    expect(jsBridge).toContain('personalArrived?: boolean;');
  });

  it('decodes and renders destinationEmoji on native Live Activity', () => {
    expect(appAttributes).toContain('destinationEmoji');
    expect(widgetAttributes).toContain('destinationEmoji');
    expect(jsBridge).toContain('destinationEmoji?: string');
    const widgetUi = readFileSync(
      join(__dirname, '../../targets/live-activity/HitherLiveActivity.swift'),
      'utf8',
    );
    expect(widgetUi).toContain('destinationEmoji');
    expect(widgetUi).toContain('displayTitle');
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
    expect(mapScreen).toContain('shouldAnchorInitial(');
    expect(mapScreen).not.toContain("m.status === 'arrived'");
    expect(mapScreen).toContain('a.destinationId === navTarget?.id && a.userId === m.userId');
    expect(mapScreen).toContain('memberArrived:');
  });

  it('animates progress bar and percent ~600ms with Reduce Motion branch (#147)', () => {
    expect(widget).toContain('ProgressMotion');
    expect(widget).toContain('durationSeconds: Double = 0.6');
    expect(widget).toContain('reduceMotionDurationSeconds');
    expect(widget).toContain('accessibilityReduceMotion');
    expect(widget).toContain('contentTransition(.numericText())');
    // Shared ProgressRow drives Lock Screen + expanded Dynamic Island.
    expect(widget).toContain('ProgressRow(value: context.state.clampedProgress');
  });

  it('keeps the existing information hierarchy with native lock-screen glass', () => {
    expect(widget).toContain('static let card = Color.black');
    expect(widget).toContain('正在前往');
    expect(widget).not.toContain('前往集合點');
    expect(widget).not.toContain('GATHERING AT');
    expect(widget).toContain('已抵達');
    expect(widget).toContain('ProgressBar');
    expect(widget).toContain('formattedDistance');
    expect(widget).toContain('etaText');
    expect(widget).toContain('compactDuration');
    expect(widget).toContain('DestinationTitle');
    expect(widget).not.toContain('TimelineView');
    expect(widget).toContain('.lineLimit(2)');
    expect(widget).toContain('layoutPriority(0)');
    expect(widget).not.toContain('minWidth: 88');
    expect(widget).not.toContain('.fill(accent.opacity(0.22))');
    expect(widgetAttributes).toContain('1d12hr');
    expect(widgetAttributes).toContain('不到1分鐘');
    expect(widgetAttributes).toContain('1小時30分鐘');
    expect(widgetAttributes).toContain('zhDuration');
    expect(appAttributes).toContain('public var language: String?');
    expect(jsBridge).toContain('language?:');
    expect(mapScreen).toContain('language,');
  });

  it('uses native glass with a material fallback and shows an estimate without countdown', () => {
    const lockBackground = widget.slice(widget.indexOf('private struct LockScreenBackground'), widget.indexOf('// MARK: - Lock screen'));
    expect(lockBackground).toContain('#available(iOS 26.0, *)');
    expect(lockBackground).toContain('.glassEffect(.regular');
    expect(lockBackground).toMatch(/\.background\s*\{[\s\S]*RoundedRectangle[\s\S]*\.glassEffect\(\.regular\)/);
    expect(lockBackground).not.toMatch(/content\s*\.glassEffect/);
    expect(lockBackground).toContain('.background(.regularMaterial');
    expect(lockBackground).toContain('activityBackgroundTint(.clear)');
    expect(widget).toContain('contrast >= 4.5');
    expect(widget).not.toContain('Text(timerInterval:');
    expect(widget).toContain('EstimatedEta');
    expect(widget).toContain('Est. ');
    expect(appAttributes).toContain('etaTargetAtMs: Double?');
    expect(widgetAttributes).toContain('etaTargetAtMs: Double?');
    const dynamicIsland = widget.slice(widget.indexOf('} dynamicIsland:'), widget.indexOf('private struct DestinationTitle'));
    expect(dynamicIsland).not.toContain('glassEffect');
  });

  it('uses travel-mode leading identity and gathering-title precedence', () => {
    expect(widget).toContain('TravelModeBadge');
    expect(widget).toContain('displayTitle(fallbackGroupName:');
    expect(widget).toContain('modeAccessibilityLabel');
    // No crook brand mark as leading identity; no crook+mode pair in compact.
    expect(widget).not.toMatch(/compactLeading:[\s\S]*Crook\(/);
    // Single activity reconciliation still ends all before start.
    expect(liveHook).toContain('endAllGroupActivities');
    expect(liveHook).toContain('PERSIST_MIN_MS = 15_000');
    expect(liveHook).not.toContain('Math.round(state.distanceMeters / 10) * 10');
    expect(liveHook).toContain('state.distanceMeters,');
  });

  it('marks arrival with a check instead of making unarrived avatars unreadable', () => {
    expect(widget).toContain('let arrived: [Bool]');
    expect(widget).toContain('isArrived = arrived.indices.contains(i) && arrived[i]');
    expect(widget).toContain('checkmark.circle.fill');
    expect(widget).not.toContain('.opacity(isArrived ? 1 : 0.35)');
    expect(widget).not.toContain('let gathered: Int');
  });
});
