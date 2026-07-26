/**
 * Source contracts: OTA-09 coordination lifecycle is reachable from MapScreen
 * and panel wires create / respond / override / refresh without blocking nav.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const mapScreen = read('screens/MapScreen.tsx');
const panel = read('screens/MapScreen/components/CoordinationRequestsPanel.tsx');
const hook = read('screens/MapScreen/hooks/useCoordinationRequests.ts');
const journeyNav = read('screens/MapScreen/hooks/useJourneyNavigation.ts');
const i18n = read('i18n/index.ts');
const client = read('api/client.ts');

describe('OTA-09 coordination UI wiring contracts', () => {
  it('exposes a MapScreen entry point on the route pane', () => {
    expect(mapScreen).toContain("setOverlay('ops')");
    expect(mapScreen).toContain("| 'ops'");
    expect(mapScreen).toContain('CoordinationRequestsPanel');
    expect(mapScreen).toContain('useCoordinationRequests');
    expect(mapScreen).toContain('testID="map-open-ops"');
    expect(mapScreen).toContain("t('map.opsCenter')");
    expect(mapScreen).toContain("t('coordination.title')");
    expect(i18n).toContain("'coordination.title'");
    expect(i18n).toContain("'map.opsCenter'");
  });

  it('panel supports list, response count, deadline, respond, override, create', () => {
    expect(panel).toContain('testID="coordination-list"');
    expect(panel).toContain('testID="coordination-detail"');
    expect(panel).toContain('testID="coordination-create-form"');
    expect(panel).toContain("t('coordination.responseCount'");
    expect(panel).toContain("t('coordination.deadline'");
    expect(panel).toContain('handleRespond');
    expect(panel).toContain('handleOverride');
    expect(panel).toContain('createRequest');
    expect(panel).toContain('RefreshControl');
    expect(panel).toContain("t('coordination.outcome'");
    expect(panel).toContain("t('coordination.silenceOk')");
  });

  it('hook uses client service exports and realtime/poll refresh', () => {
    expect(hook).toContain('fetchCoordinationRequests');
    expect(hook).toContain('fetchCoordinationResponses');
    expect(hook).toContain('createCoordinationRequest');
    expect(hook).toContain('respondToCoordinationRequest');
    expect(hook).toContain('overrideCoordinationRequest');
    expect(hook).toContain('cancelCoordinationRequest');
    expect(hook).toContain("table: 'coordination_requests'");
    expect(hook).toContain("table: 'coordination_responses'");
    expect(hook).toContain('POLL_INTERVAL_MS');
    expect(client).toContain('createCoordinationRequest');
    expect(client).toContain('respondToCoordinationRequest');
  });

  it('does not gate navigation start on coordination requests', () => {
    // Journey navigation must not import or await coordination lifecycle.
    expect(journeyNav).not.toContain('coordination');
    expect(journeyNav).not.toContain('CoordinationRequest');
    // MapScreen keeps start path independent of the coordination overlay.
    expect(mapScreen).toContain('useJourneyNavigation');
    expect(mapScreen).toContain('useCoordinationRequests');
    // startNavigation must not require an open coordination request.
    expect(mapScreen).not.toMatch(
      /startNavigation[\s\S]{0,400}coordination\.(openCount|requests)/,
    );
  });
});
