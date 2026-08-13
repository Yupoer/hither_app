/**
 * Tour overlay hole/ring geometry, pointer sink, prev/next, Stage Two measure.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clipRectToWindow,
  holeKindForTarget,
  holeRadius,
  paddedHole,
  placeTourCard,
} from '../featureTour/overlayLayout';
import { retreatTour, startTour } from '../featureTour/tourController';
import { getWindowSize, measureTourStepRects, STAGE_TWO_SETTLE_MS } from '../featureTour/measureTarget';
import { TOUR_STEPS } from '../featureTour/constants';
import * as featureTour from '../featureTour';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const updateProfile = jest.fn().mockResolvedValue(undefined);
jest.mock('../api/services/ProfileService', () => ({
  updateProfile: (...args: unknown[]) => updateProfile(...args),
}));

jest.mock('../onboarding/sync', () => ({
  readOnboardingState: jest.fn(async () => ({ completed: true })),
  readOnboardingReplayIntent: jest.fn(async () => false),
  isOnboardingCompleteForTourGate: jest.fn(
    (input: { storageCompleted: boolean; replayIntent: boolean }) =>
      !input.replayIntent && input.storageCompleted,
  ),
}));

jest.mock('../i18n', () => ({
  useTranslation: () => ({
    language: 'en',
    t: (key: string) => key,
  }),
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  AccessibilityInfo: {
    setAccessibilityFocus: jest.fn(),
    isReduceMotionEnabled: jest.fn(async () => false),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  BackHandler: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
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

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

const { act, create } = require('react-test-renderer') as {
  act: (callback: () => void | Promise<void>) => Promise<void>;
  create: (element: React.ReactElement) => {
    unmount: () => void;
    root: {
      findAll: (fn: (n: { props: Record<string, unknown> }) => boolean) => Array<{
        props: Record<string, unknown>;
      }>;
    };
  };
};

const { GroupFeatureTourOverlay } = require('../featureTour/GroupFeatureTourOverlay') as typeof import('../featureTour/GroupFeatureTourOverlay');
const { useGroupFeatureTour } = require('../featureTour/useGroupFeatureTour') as typeof import('../featureTour/useGroupFeatureTour');

function flattenStyle(style: unknown): Record<string, unknown> {
  if (!style) return {};
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
  if (typeof style === 'object') return style as Record<string, unknown>;
  return {};
}

function flush() {
  return act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('featureTour barrel public seams', () => {
  it('re-exports retreatTour, hole helpers, and measure seams', () => {
    const names = Object.keys(featureTour);
    expect(names.length).toBeGreaterThan(20);
    const barrel = featureTour as Record<string, unknown>;
    for (const key of names) {
      expect(barrel[key]).not.toBeUndefined();
    }
    expect(typeof featureTour.retreatTour).toBe('function');
    expect(typeof featureTour.holeRadius).toBe('function');
    expect(typeof featureTour.clipRectToWindow).toBe('function');
    expect(typeof featureTour.holeKindForTarget).toBe('function');
    expect(typeof featureTour.measureTourStepRects).toBe('function');
    expect(featureTour.STAGE_TWO_SETTLE_MS).toBe(300);
  });
});

describe('holeRadius compact vs card', () => {
  it('every highlight kind is a sharp rectangle (radius 0)', () => {
    const chip = paddedHole({ x: 20, y: 80, width: 52, height: 52 });
    expect(holeRadius(chip, 'compact')).toBe(0);

    const card = paddedHole({ x: 8, y: 80, width: 360, height: 240 });
    expect(holeRadius(card, 'card')).toBe(0);

    expect(holeKindForTarget('externalMaps')).toBe('compact');
    expect(holeKindForTarget('avatar')).toBe('compact');
    expect(holeKindForTarget('gatherCard')).toBe('card');
    expect(holeKindForTarget('paneMembers')).toBe('card');
  });

  it('clipRectToWindow intersects and drops empty rects', () => {
    expect(
      clipRectToWindow({ x: -10, y: 10, width: 50, height: 40 }, 390, 844),
    ).toEqual({ x: 0, y: 10, width: 40, height: 40 });
    expect(
      clipRectToWindow({ x: 400, y: 10, width: 20, height: 20 }, 390, 844),
    ).toBeNull();
    expect(clipRectToWindow(null, 390, 844)).toBeNull();
    const win = getWindowSize();
    expect(win.width).toBeGreaterThan(0);
    expect(win.height).toBeGreaterThan(0);
  });
});

describe('overlay cutout r matches ring r', () => {
  it('draws a rectangular ring with no corner patches', async () => {
    const targetRect = { x: 20, y: 80, width: 52, height: 52 };
    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        React.createElement(GroupFeatureTourOverlay, {
          visible: true,
          title: 'Maps',
          body: 'Open maps',
          ctaLabel: 'Next',
          targetRect,
          targetKind: 'compact',
          onNext: jest.fn(),
          reduceMotion: true,
        }),
      );
    });
    const ring = tree!.root.findAll((n) => n.props.testID === 'tour-hole-ring')[0];
    expect(flattenStyle(ring.props.style).borderRadius).toBe(0);
    const corners = tree!.root.findAll((n) => n.props.testID === 'tour-hole-corner');
    expect(corners).toHaveLength(0);
  });
});

describe('overlay chrome fades together', () => {
  it('fades dim/ring/card on one opacity and never snaps to 0 on step change', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const overlaySrc = readFileSync(
      join(__dirname, '../featureTour/GroupFeatureTourOverlay.tsx'),
      'utf8',
    );
    expect(overlaySrc).toContain('FADE_OUT_MS = 150');
    expect(overlaySrc).toContain('FADE_IN_MS = 180');
    expect(overlaySrc).toContain('CTA_RESERVE_PX');
    expect(overlaySrc).toContain('setTransitioning(true)');
    expect(overlaySrc).not.toMatch(
      /if \(!visible\) \{\s*opacity\.setValue\(0\);\s*return;\s*\}\s*if \(reduceMotion\) \{\s*opacity\.setValue\(1\);\s*return;\s*\}\s*opacity\.setValue\(0\);/,
    );
  });
});

describe('overlay pointer sink and prev/next', () => {
  it('uses a full-screen sink; only Prev and Next have onPress', async () => {
    const onNext = jest.fn();
    const onPrev = jest.fn();
    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        React.createElement(GroupFeatureTourOverlay, {
          visible: true,
          title: 'Step',
          body: 'Body',
          ctaLabel: 'Next',
          targetRect: { x: 8, y: 80, width: 360, height: 240 },
          targetKind: 'card',
          onNext,
          onPrev,
          canGoPrev: true,
          reduceMotion: true,
        }),
      );
    });
    const sink = tree!.root.findAll((n) => n.props.testID === 'tour-pointer-sink')[0];
    expect(sink).toBeTruthy();
    expect(sink.props.onPress).toBeUndefined();
    expect(sink.props.pointerEvents).toBe('auto');
    const claimTouch = sink.props.onStartShouldSetResponder as (() => boolean) | undefined;
    expect(claimTouch?.()).toBe(true);

    const root = tree!.root.findAll((n) => n.props.accessibilityViewIsModal === true)[0];
    expect(root.props.pointerEvents).toBe('auto');

    const pressables = tree!.root.findAll((n) => typeof n.props.onPress === 'function');
    expect(pressables.map((n) => n.props.testID).sort()).toEqual(['tour-next', 'tour-prev']);
  });

  it('hides Previous when canGoPrev is false', async () => {
    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        React.createElement(GroupFeatureTourOverlay, {
          visible: true,
          title: 'First',
          body: 'Body',
          ctaLabel: 'Next',
          targetRect: null,
          onNext: jest.fn(),
          canGoPrev: false,
          reduceMotion: true,
        }),
      );
    });
    const pressables = tree!.root.findAll((n) => typeof n.props.onPress === 'function');
    expect(pressables.map((n) => n.props.testID)).toEqual(['tour-next']);
    expect(tree!.root.findAll((n) => n.props.testID === 'tour-prev')).toHaveLength(0);
  });
});

describe('retreatTour', () => {
  it('step 0 stays 0; mid goes back; never deactivates', () => {
    expect(retreatTour(startTour())).toEqual({ active: true, stepIndex: 0 });
    expect(retreatTour({ active: true, stepIndex: 6 })).toEqual({
      active: true,
      stepIndex: 5,
    });
    expect(retreatTour({ active: false, stepIndex: 3 }).active).toBe(false);
  });
});

describe('Stage Two members measure after settle', () => {
  it('after delay, members target is non-null and clipped', async () => {
    const members = { x: -8, y: 480, width: 400, height: 220 };
    const tabs = { x: 16, y: 420, width: 358, height: 48 };
    let slept = 0;
    const measure = jest.fn(async (id: string) => {
      if (id === 'paneMembers') return members;
      if (id === 'stageTwoPlacement') return tabs;
      return null;
    });
    const step = TOUR_STEPS.find((s) => s.id === 'paneMembers');
    expect(step?.openStageTwo).toBe(true);
    const result = await measureTourStepRects({
      measure,
      step: step!,
      winW: 390,
      winH: 844,
      sleep: async (ms) => {
        slept += ms;
      },
    });
    expect(slept).toBeGreaterThanOrEqual(STAGE_TWO_SETTLE_MS);
    expect(result.targetRect).toEqual(clipRectToWindow(members, 390, 844));
    expect(result.targetRect).not.toBeNull();
    expect(result.targetRect!.x).toBeGreaterThanOrEqual(0);
    expect(result.targetRect!.x + result.targetRect!.width).toBeLessThanOrEqual(390);
    expect(result.placementRect).toEqual(tabs);
  });

  it('falls back to stageTwoPlacement when members stay unmeasured', async () => {
    const tabs = { x: 16, y: 420, width: 358, height: 48 };
    const result = await measureTourStepRects({
      measure: async (id) => (id === 'stageTwoPlacement' ? tabs : null),
      step: TOUR_STEPS.find((s) => s.id === 'paneMembers')!,
      winW: 390,
      winH: 844,
      sleep: async () => undefined,
    });
    expect(result.targetRect).toEqual(tabs);
    expect(result.placementRect).toEqual(tabs);
  });
});

describe('placeTourCard huge hole stays in the safe viewport', () => {
  it('pins the card when both bands are under 140', () => {
    const placed = placeTourCard({
      hole: { x: 0, y: 20, w: 390, h: 800 },
      windowWidth: 390,
      windowHeight: 844,
      insets: { top: 47, bottom: 34 },
      cardHeight: 160,
    });
    const topSafe = 47 + 12;
    const bottomSafe = 844 - 34 - 12;
    expect(placed.placeAbove).toBe(false);
    expect(placed.cardTop).toBeGreaterThanOrEqual(topSafe);
    expect(placed.cardTop).toBeLessThan(bottomSafe);
    expect(placed.maxCardHeight).toBeGreaterThanOrEqual(140);
    expect(placed.cardTop + Math.min(160, placed.maxCardHeight)).toBeLessThanOrEqual(bottomSafe);
  });

  it('places the tooltip below an expanded gather card near the top', () => {
    const placed = placeTourCard({
      hole: { x: 8, y: 80, w: 374, h: 420 },
      windowWidth: 390,
      windowHeight: 844,
      insets: { top: 47, bottom: 34 },
      cardHeight: 160,
    });
    expect(placed.placeAbove).toBe(false);
    expect(placed.cardTop).toBeGreaterThanOrEqual(80 + 420);
    const bottomSafe = 844 - 34 - 12;
    expect(placed.cardTop + Math.min(160, placed.maxCardHeight)).toBeLessThanOrEqual(bottomSafe);
    expect(placed.maxCardHeight).toBeGreaterThanOrEqual(140);
  });
});

describe('hook onPrev + canGoPrev', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    updateProfile.mockResolvedValue(undefined);
  });

  function HookProbe(props: {
    onSnapshot: (s: ReturnType<typeof useGroupFeatureTour>) => void;
    input: Parameters<typeof useGroupFeatureTour>[0];
  }) {
    const snap = useGroupFeatureTour(props.input);
    props.onSnapshot(snap);
    return null;
  }

  function baseInput(overrides: Partial<Parameters<typeof useGroupFeatureTour>[0]> = {}) {
    return {
      groupId: 'g1',
      destinationCount: 1,
      passiveMode: false,
      denseChrome: true,
      isLeader: true,
      accountId: 'user-a',
      accountPreferences: { groupFeatureTourCompleted: false },
      expandCard: jest.fn(),
      pauseAutoCollapse: jest.fn(),
      resumeAutoCollapse: jest.fn(),
      tourDestinationId: 'dest-1',
      setSheetMid: jest.fn(),
      selectSheetPane: jest.fn(),
      measureTarget: jest.fn(async () => ({ x: 0, y: 0, width: 100, height: 40 })),
      navCommandVisible: true,
      personalArriveVisible: true,
      ...overrides,
    };
  }

  it('exposes canGoPrev and retreats without deactivating', async () => {
    const expandCard = jest.fn();
    const setSheetMid = jest.fn();
    const box: { latest?: ReturnType<typeof useGroupFeatureTour> } = {};
    await act(async () => {
      create(
        React.createElement(HookProbe, {
          input: baseInput({ expandCard, setSheetMid }),
          onSnapshot: (s) => {
            box.latest = s;
          },
        }),
      );
    });
    for (let i = 0; i < 12 && !box.latest?.tourActive; i++) {
      await flush();
    }
    expect(box.latest?.tourActive).toBe(true);
    expect(box.latest?.canGoPrev).toBe(false);
    expect(box.latest?.stepIndex).toBe(0);

    await act(async () => {
      box.latest?.onNext();
    });
    await flush();
    expect(box.latest?.stepIndex).toBe(1);
    expect(box.latest?.canGoPrev).toBe(true);
    expect(expandCard).toHaveBeenCalled();
    const expandCount = expandCard.mock.calls.length;

    await act(async () => {
      box.latest?.onPrev();
    });
    await flush();
    expect(box.latest?.stepIndex).toBe(0);
    expect(box.latest?.tourActive).toBe(true);
    expect(box.latest?.canGoPrev).toBe(false);

    await act(async () => {
      box.latest?.onNext();
    });
    await flush();
    expect(box.latest?.stepIndex).toBe(1);
    expect(expandCard.mock.calls.length).toBeGreaterThan(expandCount);
  });
});

describe('MapScreen wires prev + members highlight', () => {
  it('passes onPrev/canGoPrev and highlights the members tab', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const map = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');
    expect(map).toContain('onPrev={onTourPrev}');
    expect(map).toContain('canGoPrev={tourCanGoPrev}');
    expect(map).toContain('targetKind={holeKindForTarget(tourStep?.target)}');
    expect(map).not.toContain('tour-members-content');
    expect(map).toContain("'paneMembers'");
    expect(map).toContain("setTourTargetRef('search'");
    expect(map).toContain('clearAddPlaceTour');
  });
});
