/**
 * #182 — group tour highlight geometry, targets, and final card.
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { measureTargetWithRetry } from '../featureTour/measureTarget';
import { HOLE_PAD, HOLE_RADIUS, holeRadius, paddedHole, placeTourCard } from '../featureTour/overlayLayout';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

jest.mock('../i18n', () => ({
  useTranslation: () => ({
    language: 'en',
    t: (key: string) => key,
  }),
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  BackHandler: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
  AccessibilityInfo: { setAccessibilityFocus: jest.fn() },
  findNodeHandle: jest.fn(() => 1),
  useWindowDimensions: () => ({ width: 390, height: 844 }),
  StyleSheet: {
    create: (s: unknown) => s,
    absoluteFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
    hairlineWidth: 1,
  },
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Animated: {
    Value: class {
      constructor(public v: number) {}
      setValue(v: number) {
        this.v = v;
      }
    },
    timing: () => ({ start: (cb?: () => void) => cb?.() }),
    View: 'Animated.View',
  },
}));

const { act, create } = require('react-test-renderer') as {
  act: (callback: () => void | Promise<void>) => Promise<void>;
  create: (element: React.ReactElement) => {
    root: {
      findAll: (fn: (n: { props: Record<string, unknown> }) => boolean) => Array<{
        props: Record<string, unknown>;
      }>;
    };
  };
};

const { GroupFeatureTourOverlay } = require('../featureTour/GroupFeatureTourOverlay') as typeof import('../featureTour/GroupFeatureTourOverlay');

const map = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');
const overlaySrc = readFileSync(join(__dirname, '../featureTour/GroupFeatureTourOverlay.tsx'), 'utf8');
const hookSrc = readFileSync(join(__dirname, '../featureTour/useGroupFeatureTour.ts'), 'utf8');

describe('paddedHole + ring share one rounded geometry (#182)', () => {
  it('pads the measured rect with the same inset the overlay uses', () => {
    expect(paddedHole({ x: 10, y: 20, width: 100, height: 40 })).toEqual({
      x: 2,
      y: 12,
      w: 100 + HOLE_PAD * 2,
      h: 40 + HOLE_PAD * 2,
    });
    expect(HOLE_RADIUS).toBeGreaterThan(0);
    expect(overlaySrc).toContain('paddedHole');
    expect(overlaySrc).toContain('holeRadius');
    expect(overlaySrc).toContain('HoleCorner');
    expect(overlaySrc).toContain('tour-hole-ring');
    const compact = paddedHole({ x: 10, y: 20, width: 52, height: 52 });
    expect(holeRadius(compact, 'compact')).toBe(Math.min(compact.w, compact.h) / 2);
    expect(holeRadius({ w: 376, h: 256 }, 'card')).toBeLessThanOrEqual(16);
  });
});

describe('measureTargetWithRetry requireStable (#182)', () => {
  it('rejects the first collapsed height and keeps the expanded rect', async () => {
    const collapsed = { x: 8, y: 80, width: 360, height: 88 };
    const expanded = { x: 8, y: 80, width: 360, height: 240 };
    const measure = jest
      .fn()
      .mockResolvedValueOnce(collapsed)
      .mockResolvedValueOnce(expanded)
      .mockResolvedValue(expanded);
    const rect = await measureTargetWithRetry({
      measure,
      target: 'gatherCard',
      requireStable: true,
      maxAttempts: 5,
      sleep: async () => undefined,
    });
    expect(rect).toEqual(expanded);
    expect(measure).toHaveBeenCalledTimes(3);
  });

  it('still returns the first non-zero rect when stability is not required', async () => {
    const first = { x: 1, y: 2, width: 10, height: 10 };
    const second = { x: 1, y: 2, width: 10, height: 80 };
    const measure = jest.fn().mockResolvedValueOnce(first).mockResolvedValue(second);
    const rect = await measureTargetWithRetry({
      measure,
      target: 'avatar',
      requireStable: false,
      maxAttempts: 3,
      sleep: async () => undefined,
    });
    expect(rect).toEqual(first);
    expect(measure).toHaveBeenCalledTimes(1);
  });
});

describe('expanding steps wait for a stable rect (#182)', () => {
  it('useGroupFeatureTour asks for stability on expandCard steps', () => {
    const measureSrc = readFileSync(join(__dirname, '../featureTour/measureTarget.ts'), 'utf8');
    expect(hookSrc).toContain('requireStable: Boolean(step.expandCard)');
    expect(measureSrc).toContain("target: 'stageTwoPlacement'");
    expect(hookSrc).toContain('placementRect');
  });
});

describe('measure waits for carousel selection alignment (#179)', () => {
  it('hook remeasures when selectedDestinationId catches up to tourDestinationId', () => {
    expect(hookSrc).toContain('selectedDestinationId');
    expect(hookSrc).toContain('selectedDest !== tourDest');
    expect(map).toContain('selectedDestinationId: selectedDestination?.id');
  });
});

describe('MapScreen highlight owners (#182)', () => {
  it('pins arrival progress to the people chip, not the metrics row', () => {
    expect(map).toMatch(/setTourTargetRef\('arrivalProgress'/);
    expect(map).not.toMatch(/Arrival progress chip is the people count control above; alias for tour/);
    const chipIdx = map.indexOf('styles.arrivalPeopleChip');
    const arrivalRefIdx = map.indexOf("setTourTargetRef('arrivalProgress'");
    expect(arrivalRefIdx).toBeGreaterThan(-1);
    expect(Math.abs(arrivalRefIdx - chipIdx)).toBeLessThan(400);
  });

  it('pins members to status+list and Stage Two placement to the tab strip', () => {
    expect(map).toContain('tour-members-content');
    expect(map).toContain('tour-stage-two-placement');
    expect(map).toContain("setTourTargetRef('stageTwoPlacement'");
    const membersWrap = map.slice(
      map.indexOf('tour-members-content'),
      map.indexOf('tour-members-content') + 1800,
    );
    expect(membersWrap).toContain('myStatusBar');
    expect(membersWrap).not.toContain('settings.preciseLocation');
    expect(membersWrap).not.toContain('map.inviteMembers');
  });
});

describe('final card has no title and is horizontally centered (#182)', () => {
  it('omits the title node and uses symmetric left/right insets', async () => {
    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        React.createElement(GroupFeatureTourOverlay, {
          visible: true,
          title: '',
          body: 'You know the main controls. Tap Get started to enter the map.',
          ctaLabel: 'Get started',
          targetRect: null,
          onNext: jest.fn(),
          reduceMotion: true,
        }),
      );
    });
    const texts = tree!.root.findAll(
      (n) => n.props && typeof n.props.children === 'string',
    );
    const values = texts.map((n) => n.props.children);
    expect(values).not.toContain('');
    expect(values).toContain('You know the main controls. Tap Get started to enter the map.');
    expect(values).toContain('Get started');
    expect(overlaySrc).toMatch(/left:\s*20/);
    expect(overlaySrc).toMatch(/right:\s*20/);
    expect(overlaySrc).not.toMatch(/marginHorizontal:\s*20/);
    expect(overlaySrc).not.toMatch(/maxWidth:\s*winW\s*-\s*40/);
    const summary = tree!.root.findAll((n) => n.props.accessibilityRole === 'summary');
    expect(summary[0]?.props.accessibilityLabel).toBe(
      'You know the main controls. Tap Get started to enter the map.',
    );
    expect(summary[0]?.props.accessibilityLabel).not.toMatch(/^\./);
  });

  it('MapScreen passes an empty title on the final step', () => {
    expect(map).toContain('!tourStep.final');
    expect(map).toContain('placementRect={tourPlacementRect}');
  });
});

describe('Stage Two placement is independent of highlight size (#182)', () => {
  it('placeTourCard uses the placement hole, not a large members rect', () => {
    const tabHole = paddedHole({ x: 16, y: 420, width: 358, height: 48 });
    const membersHole = paddedHole({ x: 16, y: 480, width: 358, height: 280 });
    const fromTabs = placeTourCard({
      hole: tabHole,
      windowWidth: 390,
      windowHeight: 844,
      insets: { top: 47, bottom: 34 },
      cardHeight: 160,
    });
    const fromMembers = placeTourCard({
      hole: membersHole,
      windowWidth: 390,
      windowHeight: 844,
      insets: { top: 47, bottom: 34 },
      cardHeight: 160,
    });
    expect(fromTabs.cardTop).not.toBe(fromMembers.cardTop);
    expect(overlaySrc).toContain('placementHole');
  });
});
