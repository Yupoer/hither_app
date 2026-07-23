import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeAvatarProfiles } from '../utils/gatherCommand';

const i18n = readFileSync(join(__dirname, '../i18n/index.ts'), 'utf8');
const locationHook = readFileSync(
  join(__dirname, '../screens/MapScreen/hooks/useDeviceLocation.ts'),
  'utf8',
);
const groupMap = readFileSync(join(__dirname, '../components/GroupMap.tsx'), 'utf8');
const groupService = readFileSync(
  join(__dirname, '../api/services/GroupService.ts'),
  'utf8',
);

const mapScreen = readFileSync(
  join(__dirname, '../screens/MapScreen.tsx'),
  'utf8',
);

describe('measured performance regressions', () => {
  it('keeps the translator stable so effects do not resubscribe on every render', () => {
    expect(i18n).toContain("import { useMemo } from 'react'");
    expect(i18n).toMatch(/return useMemo\(\(\) => \(\{[\s\S]*?language,[\s\S]*?t:/);
    expect(i18n).toContain('}), [dict, language])');
  });

  it('does not put translator identity in gathering-workflow effect deps', () => {
    expect(mapScreen).toContain('tRef.current');
    expect(mapScreen).toContain('WORKFLOW_MIN_INTERVAL_MS');
    expect(mapScreen).toContain('workflowInFlightRef');
    expect(mapScreen).toContain('workflowPendingRef');
    // Effect deps must not include bare `t` (historical SELECT storm).
    expect(mapScreen).toMatch(
      /}, \[groupId, loadGatheringWorkflow, scheduleWorkflowReload\]\);/,
    );
  });

  it('force-syncs on foreground and keeps an independent motion-aware heartbeat', () => {
    expect(locationHook).toContain('refreshDeviceLocation');
    expect(locationHook).toContain('HEARTBEAT_TICK_MS');
    expect(locationHook).toContain('reduceMotionState');
    expect(locationHook).toContain('uploadHeartbeatForCadence');
    expect(locationHook).toContain('immediate: true');
  });

  it('uses MapKit as the iOS foreground location owner and keeps the native blue dot', () => {
    expect(groupMap).toContain('showsUserLocation');
    expect(groupMap).toContain('onUserLocationChange');
    expect(groupMap).toContain('onUserLocationSample');
    expect(groupMap).toContain("...(Platform.OS === 'ios' && onUserLocationSample");
    expect(locationHook).toContain('nativeMapLocationEnabled');
    expect(locationHook).toContain('consumeForegroundSample');
    expect(mapScreen).toContain("nativeMapLocationEnabled: Platform.OS === 'ios'");
    expect(mapScreen).toContain('consumeForegroundSample');
    expect(mapScreen).toContain('startNavigationEnergyMonitor');
  });

  it('does not rewrite GroupMap initialCenter on every deviceCoords sample', () => {
    expect(mapScreen).toContain('const [mapInitialCenter, setMapInitialCenter]');
    expect(mapScreen).toContain('initialCenter={mapInitialCenter ?? undefined}');
    expect(mapScreen).not.toContain('initialCenter={fromCoords}');
    expect(mapScreen).toContain('setMapInitialCenter((current) => current ?? fromCoords)');
  });

  it('coalesces location outbox uploads instead of flushing after every sample', () => {
    expect(locationHook).toContain('scheduleOutboxFlush');
    expect(locationHook).toContain('const OUTBOX_FLUSH_DELAY_MS = 20_000');
    expect(locationHook).not.toContain('.then(() => flushLocationOutbox())');
  });

  it('keeps debug route local and removes eager multi-round log drain patterns', () => {
    const debugStart = locationHook.indexOf('// DEV debug route');
    const debugEnd = locationHook.indexOf('// Expo watch is fallback', debugStart);
    const debugBlock = locationHook.slice(debugStart, debugEnd);
    expect(debugStart).toBeGreaterThanOrEqual(0);
    expect(debugBlock).toContain('applySampleToUi');
    expect(debugBlock).not.toContain('enqueueUpload');
    const performance = readFileSync(join(__dirname, '../state/performance.ts'), 'utf8');
    const uploadLocalLogs = readFileSync(join(__dirname, '../utils/uploadLocalLogs.ts'), 'utf8');
    const app = readFileSync(join(__dirname, '../../App.tsx'), 'utf8');
    expect(performance).not.toContain('FLUSH_DELAY_MS');
    expect(uploadLocalLogs).not.toContain('MAX_DIAGNOSTIC_FLUSH_ROUNDS');
    expect(app).not.toMatch(/if \(initializing \|\| !user\) return;[\s\S]*drainPayloads/);
  });

  it('animates member markers between real coordinate endpoints only', () => {
    expect(groupMap).toContain('AnimatedRegion');
    expect(groupMap).toContain('MarkerAnimated');
    expect(groupMap).toContain('regionRef.current');
    expect(groupMap).toContain('.timing(');
    // Only animate to the latest real lat/lng — never invent a predicted point.
    expect(groupMap).toContain('never invent a next point');
    expect(groupMap).not.toMatch(/predictedCoords|velocityPredict|deadReckon/);
  });

  it('persists joined-group avatars and merges cache on lite fetch', () => {
    expect(groupService).toContain('joined-group-avatars:');
    expect(groupService).toContain('mergeAvatarProfiles');
    expect(groupService).toContain('readAvatarDiskCache');
    const hit = mergeAvatarProfiles(
      [{}, {}],
      [{ avatar: '🐑', avatarColor: '#abc' }, { avatar: '🦊' }],
    );
    expect(hit[0]?.avatar).toBe('🐑');
    expect(hit[0]?.avatarColor).toBe('#abc');
    expect(hit[1]?.avatar).toBe('🦊');
  });
});
