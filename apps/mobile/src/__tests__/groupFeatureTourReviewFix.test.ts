/**
 * Sol REVIEW_FIX regressions for parent #129 / PR #142.
 * Pure + contract seams (MapScreen wiring, overlay a11y, step plan).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTourSteps } from '../featureTour/constants';
import { stepOrder } from '../featureTour/tourController';
import { normalizeAccountPreferences } from '../types';

const SRC = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

describe('REVIEW_FIX: account hydrate preserves tour flag', () => {
  it('fresh-device profile hydrate keeps groupFeatureTourCompleted', () => {
    // Simulates server preferences on device B with empty local storage.
    const hydrated = normalizeAccountPreferences({
      groupFeatureTourCompleted: true,
      quickCommands: [null, null, null],
    });
    expect(hydrated.groupFeatureTourCompleted).toBe(true);
  });

  it('SessionContext and useAuthFlow use normalizeAccountPreferences', () => {
    const session = read('state/SessionContext.tsx');
    const auth = read('state/useAuthFlow.ts');
    expect(session).toContain('normalizeAccountPreferences');
    expect(auth).toContain('normalizeAccountPreferences');
    // Slot-only rebuild must not be the sole hydrate path for server prefs.
    expect(session).not.toMatch(
      /preferences:\s*accountPreferencesFromSlots\(\s*normalizeCustomQuickCommands\(row/,
    );
  });
});

describe('REVIEW_FIX: optional control step plan', () => {
  it('leader/member unavailable-control cases drop the matching step', () => {
    // Member with hidden nav (no command rendered).
    expect(
      stepOrder(buildTourSteps({ navCommandVisible: false, personalArriveVisible: true })),
    ).not.toContain('navCommand');
    // Arrival control gated off (not shared target / cannot mark).
    expect(
      stepOrder(buildTourSteps({ navCommandVisible: true, personalArriveVisible: false })),
    ).not.toContain('personalArrive');
  });

  it('MapScreen derives tour availability and wires it into the hook', () => {
    const map = read('screens/MapScreen.tsx');
    expect(map).toContain('tourControlAvailability');
    expect(map).toContain('navCommandVisible:');
    expect(map).toContain('personalArriveVisible:');
    expect(map).toContain('navCmd.kind !== \'hidden\'');
    // Plan/expand/refs share one destination (not hard-coded destinations[0] expand only).
    expect(map).toContain('tourDestinationId');
    expect(map).toContain('pickTourDestinationId');
  });
});

describe('REVIEW_FIX: Stage Two per-tab targets', () => {
  it('SheetPaneTabs exposes onTabNode for individual tab measurement', () => {
    const tabs = read('screens/MapScreen/components/SheetPaneTabs.tsx');
    expect(tabs).toContain('onTabNode');
    expect(tabs).toContain('ref={(n) => onTabNode?.(opt.key, n)}');
  });

  it('MapScreen maps each pane key to a distinct tour target id', () => {
    const map = read('screens/MapScreen.tsx');
    expect(map).toContain('onTabNode');
    expect(map).toContain("'paneMembers'");
    expect(map).toContain("'paneRoute'");
    expect(map).toContain("'paneTools'");
    expect(map).toContain("'paneStore'");
    // Old bug: one strip ref assigned to all four.
    expect(map).not.toMatch(
      /setTourTargetRef\('paneMembers'[\s\S]*setTourTargetRef\('paneRoute'[\s\S]*sheetPane ===/,
    );
  });
});

describe('REVIEW_FIX: durable complete + a11y overlay', () => {
  it('hook awaits complete before stopping the tour', () => {
    const hook = read('featureTour/useGroupFeatureTour.ts');
    expect(hook).toContain('await completeGroupFeatureTour');
    expect(hook).toContain('setCtrl(stopTour())');
    // stopTour must not precede the await of complete.
    const completeIdx = hook.indexOf('await completeGroupFeatureTour');
    const stopIdx = hook.indexOf('setCtrl(stopTour())');
    expect(completeIdx).toBeGreaterThan(-1);
    expect(stopIdx).toBeGreaterThan(completeIdx);
  });

  it('overlay implements reduceMotion fade and accessibility focus move', () => {
    const overlay = read('featureTour/GroupFeatureTourOverlay.tsx');
    expect(overlay).toContain('AccessibilityInfo.setAccessibilityFocus');
    expect(overlay).toContain('Animated.timing');
    expect(overlay).toContain('reduceMotion');
    // Ban the no-op ternary that always returned 1.
    expect(overlay).not.toContain('reduceMotion ? 1 : 1');
  });

  it('MapScreen passes reduceMotion and completing into the overlay', () => {
    const map = read('screens/MapScreen.tsx');
    expect(map).toContain('reduceMotion={tourReduceMotion}');
    expect(map).toContain('ctaDisabled={tourCompleting}');
  });
});
