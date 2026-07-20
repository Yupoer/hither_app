import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const groupMap = readFileSync(join(__dirname, '../components/GroupMap.tsx'), 'utf8');
const mapScreen = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');
const journeyNavigation = readFileSync(
  join(__dirname, '../screens/MapScreen/hooks/useJourneyNavigation.ts'),
  'utf8',
);

describe('MapKit route UI contract', () => {
  it('draws a route polyline and exposes a 45-degree camera command', () => {
    expect(groupMap).toContain('<Polyline');
    expect(groupMap).toContain('focusOblique: (coordinates: Coordinates) => void');
    expect(groupMap).toContain('pitch: 45');
  });

  it('uses member-to-gathering MapKit routes in the flock rows', () => {
    expect(mapScreen).toContain('useMapKitRoutes({');
    expect(mapScreen).toContain('memberRoutes[m.userId]');
    expect(mapScreen).toContain('gathering={activePoint}');
    expect(mapScreen).toContain('routePoints={selfRoute?.points}');
    expect(mapScreen).toContain('focusOblique(pendingPlace.coordinates)');
    expect(mapScreen).toContain('sameMetricDistance(');
    expect(mapScreen).toContain('gatedJourneyProgress(');
  });

  it('centers a follower once when the leader starts navigation', () => {
    expect(journeyNavigation).toContain('lastFollowerCenterKeyRef');
    expect(journeyNavigation).toContain('const centerKey =');
    expect(journeyNavigation).toContain(
      'if (lastFollowerCenterKeyRef.current === centerKey) return;',
    );
  });

  it('labels road ETA as 路線預估 and local haversine as 估算', () => {
    expect(mapScreen).toContain("t('map.routeEstimate')");
    expect(mapScreen).toContain("t('map.localEstimate')");
  });

  it('clears stale route state on null directions (fail-closed)', () => {
    const routesHook = readFileSync(
      join(__dirname, '../screens/MapScreen/hooks/useMapKitRoutes.ts'),
      'utf8',
    );
    expect(routesHook).toContain('selfRoute: next.selfRoute');
    expect(routesHook).toContain('if (!active) return');
  });

  it('opens external navigation via the shared boundary', () => {
    expect(journeyNavigation).toContain('openExternalNavigation');
    expect(mapScreen).toContain('openExternalNavigation(dest)');
  });
});
