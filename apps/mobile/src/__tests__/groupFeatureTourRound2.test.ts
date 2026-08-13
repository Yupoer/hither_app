/**
 * Sol REVIEW_FIX round 2 — high-level observable behavior for #129 / PR #142.
 * Node/ts-jest runner (same as CI `npm test`).
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { measureTargetWithRetry } from '../featureTour/measureTarget';
import { placeTourCard } from '../featureTour/overlayLayout';
import {
  pickTourDestinationId,
  tourDestinationIndex,
} from '../featureTour/tourDestination';
import {
  clearGroupFeatureTour,
  completeGroupFeatureTour,
  GROUP_FEATURE_TOUR_ACCOUNT_SYNC_PENDING_KEY,
  GROUP_FEATURE_TOUR_RESET_INTENT_KEY,
  parseTourAccountSyncPending,
  readGroupFeatureTourCompletedLocal,
  readTourAccountSyncPending,
  readTourResetIntent,
  retryPendingTourAccountSync,
  writeGroupFeatureTourCompletedLocal,
} from '../featureTour/storage';

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
  translate: (_lang: string, key: string) => key,
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
      findAllByType: (t: unknown) => unknown[];
      findAll: (fn: (n: { props: Record<string, unknown> }) => boolean) => Array<{
        props: Record<string, unknown>;
      }>;
    };
  };
};

const { useGroupFeatureTour } = require('../featureTour/useGroupFeatureTour') as typeof import('../featureTour/useGroupFeatureTour');
const { GroupFeatureTourOverlay } = require('../featureTour/GroupFeatureTourOverlay') as typeof import('../featureTour/GroupFeatureTourOverlay');

function flush() {
  return act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('R2: per-account pending tour sync', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('stores accountId + desired completed on failed complete', async () => {
    updateProfile.mockRejectedValueOnce(new Error('network'));
    await completeGroupFeatureTour({
      accountId: 'user-a',
      existingPreferences: {},
    });
    const pending = await readTourAccountSyncPending();
    expect(pending).toEqual({ accountId: 'user-a', completed: true });
  });

  it('stores completed:false on failed reset and retries that value', async () => {
    updateProfile.mockRejectedValueOnce(new Error('network'));
    await clearGroupFeatureTour({ accountId: 'user-a', existingPreferences: {} });
    expect(await readTourAccountSyncPending()).toEqual({
      accountId: 'user-a',
      completed: false,
    });

    updateProfile.mockResolvedValueOnce(undefined);
    await expect(
      retryPendingTourAccountSync({
        accountId: 'user-a',
        existingPreferences: { groupFeatureTourCompleted: true },
      }),
    ).resolves.toBe(true);
    expect(updateProfile).toHaveBeenLastCalledWith({
      preferences: expect.objectContaining({ groupFeatureTourCompleted: false }),
    });
    expect(await readTourAccountSyncPending()).toBeNull();
  });

  it('does not apply another account pending marker', async () => {
    await AsyncStorage.setItem(
      GROUP_FEATURE_TOUR_ACCOUNT_SYNC_PENDING_KEY,
      JSON.stringify({ accountId: 'user-a', completed: true }),
    );
    updateProfile.mockClear();
    await expect(
      retryPendingTourAccountSync({ accountId: 'user-b' }),
    ).resolves.toBe(false);
    expect(updateProfile).not.toHaveBeenCalled();
    expect(await readTourAccountSyncPending()).toEqual({
      accountId: 'user-a',
      completed: true,
    });
  });

  it('discards legacy unscoped pending markers', () => {
    expect(parseTourAccountSyncPending('1')).toBeNull();
    expect(parseTourAccountSyncPending('true')).toBeNull();
  });
});

describe('R2: measure retry + stable parent', () => {
  it('retries until a rect appears', async () => {
    const measure = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ x: 10, y: 20, width: 100, height: 40 });
    const sleep = jest.fn(async () => undefined);
    const rect = await measureTargetWithRetry({
      measure,
      target: 'navCommand',
      maxAttempts: 5,
      sleep,
    });
    expect(rect).toEqual({ x: 10, y: 20, width: 100, height: 40 });
    expect(measure).toHaveBeenCalledTimes(3);
  });

  it('falls back to gatherCard when control never measures', async () => {
    const measure = jest.fn(async (id: string) => {
      if (id === 'gatherCard') return { x: 0, y: 100, width: 300, height: 120 };
      return null;
    });
    const rect = await measureTargetWithRetry({
      measure,
      target: 'personalArrive',
      maxAttempts: 2,
      sleep: async () => undefined,
    });
    expect(rect).toEqual({ x: 0, y: 100, width: 300, height: 120 });
    expect(measure).toHaveBeenCalledWith('personalArrive');
    expect(measure).toHaveBeenCalledWith('gatherCard');
  });
});

describe('R2: single tour destination', () => {
  it('prefers shared target over selected index', () => {
    expect(
      pickTourDestinationId({
        destinationIds: ['a', 'b', 'c'],
        selectedIndex: 0,
        preferredId: 'b',
      }),
    ).toBe('b');
  });

  it('uses selected index when preferred is absent', () => {
    expect(
      pickTourDestinationId({
        destinationIds: ['a', 'b', 'c'],
        selectedIndex: 2,
        preferredId: 'missing',
      }),
    ).toBe('c');
  });

  it('maps id back to carousel index', () => {
    expect(tourDestinationIndex(['a', 'b', 'c'], 'b')).toBe(1);
  });
});

describe('R2: dynamic type card placement', () => {
  it('keeps card fully inside the window using measured height', () => {
    const placed = placeTourCard({
      hole: { x: 20, y: 500, w: 350, h: 80 },
      windowWidth: 390,
      windowHeight: 700,
      insets: { top: 40, bottom: 20 },
      cardHeight: 220,
    });
    expect(placed.cardTop).toBeGreaterThanOrEqual(40);
    expect(placed.cardTop + Math.min(220, placed.maxCardHeight)).toBeLessThanOrEqual(700 - 20);
    expect(placed.maxCardHeight).toBeGreaterThan(0);
  });

  it('clamps above placement when hole is low on screen', () => {
    const placed = placeTourCard({
      hole: { x: 10, y: 600, w: 300, h: 50 },
      windowWidth: 390,
      windowHeight: 800,
      insets: { top: 50, bottom: 30 },
      cardHeight: 180,
    });
    expect(placed.placeAbove).toBe(true);
    expect(placed.cardTop).toBeGreaterThanOrEqual(50);
  });
});

describe('R2: hook observable lifecycle', () => {
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

  it('notifies MapScreen when tour becomes active', async () => {
    const onTourActiveChange = jest.fn();
    const box: { latest?: ReturnType<typeof useGroupFeatureTour> } = {};
    await act(async () => {
      create(
        React.createElement(HookProbe, {
          input: baseInput({ onTourActiveChange }),
          onSnapshot: (s) => {
            box.latest = s;
          },
        }),
      );
    });
    for (let i = 0; i < 10 && !box.latest?.tourActive; i++) {
      await flush();
    }
    expect(box.latest?.tourActive).toBe(true);
    expect(onTourActiveChange).toHaveBeenCalledWith(true, 'dest-1');
  });

  it('expands the tour destination id (not a hard-coded first card)', async () => {
    const expandCard = jest.fn();
    const box: { latest?: ReturnType<typeof useGroupFeatureTour> } = {};
    await act(async () => {
      create(
        React.createElement(HookProbe, {
          input: baseInput({ expandCard, tourDestinationId: 'dest-shared' }),
          onSnapshot: (s) => {
            box.latest = s;
          },
        }),
      );
    });
    for (let i = 0; i < 10 && !box.latest?.tourActive; i++) {
      await flush();
    }
    expect(box.latest?.tourActive).toBe(true);
    await act(async () => {
      box.latest?.onNext();
    });
    await flush();
    expect(expandCard).toHaveBeenCalledWith('dest-shared');
  });
});

describe('R3: reset replay with stale account prefs', () => {
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
      accountPreferences: { groupFeatureTourCompleted: true },
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

  it('clear sets reset intent and does not leave local completed', async () => {
    await writeGroupFeatureTourCompletedLocal(true);
    await clearGroupFeatureTour({
      accountId: 'user-a',
      existingPreferences: { groupFeatureTourCompleted: true },
    });
    expect(await readGroupFeatureTourCompletedLocal()).toBe(false);
    expect(await readTourResetIntent()).toBe(true);
  });

  it('reevaluate after successful clear does not re-hydrate from stale prefs true', async () => {
    await writeGroupFeatureTourCompletedLocal(true);
    updateProfile.mockResolvedValue(undefined);
    await clearGroupFeatureTour({
      accountId: 'user-a',
      existingPreferences: { groupFeatureTourCompleted: true },
    });

    const box: { latest?: ReturnType<typeof useGroupFeatureTour> } = {};
    await act(async () => {
      create(
        React.createElement(HookProbe, {
          // Stale in-memory prefs still claim completed — the bug Sol found.
          input: baseInput({
            accountPreferences: { groupFeatureTourCompleted: true },
          }),
          onSnapshot: (s) => {
            box.latest = s;
          },
        }),
      );
    });
    for (let i = 0; i < 15 && !box.latest?.tourActive; i++) {
      await flush();
    }
    expect(await readGroupFeatureTourCompletedLocal()).toBe(false);
    expect(box.latest?.tourActive).toBe(true);
  });

  it('reevaluate after failed account clear still allows replay via pending false', async () => {
    await writeGroupFeatureTourCompletedLocal(true);
    updateProfile.mockRejectedValueOnce(new Error('network'));
    await clearGroupFeatureTour({
      accountId: 'user-a',
      existingPreferences: { groupFeatureTourCompleted: true },
    });
    expect(await readTourAccountSyncPending()).toEqual({
      accountId: 'user-a',
      completed: false,
    });

    updateProfile.mockResolvedValue(undefined);
    const box: { latest?: ReturnType<typeof useGroupFeatureTour> } = {};
    await act(async () => {
      create(
        React.createElement(HookProbe, {
          input: baseInput({
            accountPreferences: { groupFeatureTourCompleted: true },
          }),
          onSnapshot: (s) => {
            box.latest = s;
          },
        }),
      );
    });
    for (let i = 0; i < 15 && !box.latest?.tourActive; i++) {
      await flush();
    }
    expect(box.latest?.tourActive).toBe(true);
    expect(await readGroupFeatureTourCompletedLocal()).toBe(false);
  });

  it('MapScreen resetPrefs optimistically patches session tour flag', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const map = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');
    expect(map).toContain('groupFeatureTourCompleted: false');
    expect(map).toContain('updateProfile');
    expect(map).toContain('clearGroupFeatureTour');
    expect(map).toContain('clearAddPlaceTour');
    expect(map).toContain('addPlaceTourCompleted: false');
    expect(map).toContain('markOnboardingReplayForHome');
  });

  it('exports reset intent key', () => {
    expect(GROUP_FEATURE_TOUR_RESET_INTENT_KEY).toContain('resetIntent');
  });
});

describe('R2: overlay observable render', () => {
  it('renders title and body when visible', async () => {
    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        React.createElement(GroupFeatureTourOverlay, {
          visible: true,
          title: 'Tour title',
          body: 'Tour body text',
          ctaLabel: 'Next',
          targetRect: { x: 10, y: 100, width: 200, height: 50 },
          onNext: jest.fn(),
          reduceMotion: true,
        }),
      );
    });
    const texts = tree!.root.findAll(
      (n) => n.props && typeof n.props.children === 'string',
    );
    const values = texts.map((n) => n.props.children);
    expect(values).toContain('Tour title');
    expect(values).toContain('Tour body text');
    expect(values).toContain('Next');
  });
});

describe('REVIEW_FIX #179: remeasure after carousel locks to preferred dest', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    updateProfile.mockResolvedValue(undefined);
  });

  /**
   * Repro: preferred tour destination ≠ initial selected card.
   * First collapsedCard measure must not stick to the pre-lock gatherCard rect.
   */
  it('final gatherCard rect comes from preferred destination after selection aligns', async () => {
    const rectInitial = { x: 0, y: 100, width: 300, height: 80 };
    const rectPreferred = { x: 80, y: 100, width: 300, height: 80 };

    function AlignProbe() {
      const [selectedId, setSelectedId] = React.useState('dest-a');
      const measureTarget = React.useCallback(async () => {
        // Simulate MapScreen: only the active carousel card owns gatherCard ref.
        return selectedId === 'dest-b' ? rectPreferred : rectInitial;
      }, [selectedId]);
      const onTourActiveChange = React.useCallback(
        (active: boolean, destinationId: string | null) => {
          if (active && destinationId) setSelectedId(destinationId);
        },
        [],
      );
      const snap = useGroupFeatureTour({
        groupId: 'g1',
        destinationCount: 2,
        passiveMode: false,
        denseChrome: true,
        isLeader: true,
        accountId: 'user-a',
        accountPreferences: { groupFeatureTourCompleted: false },
        expandCard: jest.fn(),
        pauseAutoCollapse: jest.fn(),
        resumeAutoCollapse: jest.fn(),
        tourDestinationId: 'dest-b',
        selectedDestinationId: selectedId,
        setSheetMid: jest.fn(),
        selectSheetPane: jest.fn(),
        measureTarget,
        navCommandVisible: true,
        personalArriveVisible: true,
        onTourActiveChange,
      });
      return React.createElement('probe', {
        tourActive: snap.tourActive,
        targetRect: snap.targetRect,
        stepId: snap.step?.id ?? null,
      });
    }

    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(React.createElement(AlignProbe));
    });
    for (let i = 0; i < 20; i++) {
      await flush();
      const probe = tree!.root.findAll(
        (n) => n.props && n.props.tourActive === true,
      )[0];
      if (probe?.props.targetRect) break;
    }
    const probe = tree!.root.findAll((n) => n.props && 'targetRect' in n.props)[0];
    expect(probe?.props.tourActive).toBe(true);
    expect(probe?.props.stepId).toBe('collapsedCard');
    expect(probe?.props.targetRect).toEqual(rectPreferred);
    expect(probe?.props.targetRect).not.toEqual(rectInitial);
  });
});

describe('R2: MapScreen wires single tour destination + accountId', () => {
  it('source contracts', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const map = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');
    expect(map).toContain('pickTourDestinationId');
    expect(map).toContain('tourDestinationId');
    expect(map).toContain('accountId: user?.id');
    expect(map).toContain('onTourActiveChange');
    expect(map).toContain('selectedDestinationId');
    expect(map).not.toContain('firstDestinationId:');
  });

  it('eslint keeps compiler rules for featureTour (no global demotion)', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const cfg = readFileSync(join(__dirname, '../../eslint.config.js'), 'utf8');
    expect(cfg).toContain('LEGACY_REACT_COMPILER_BASELINE');
    expect(cfg).toContain("ignores: ['src/featureTour/**']");
    expect(cfg).not.toMatch(/react-hooks\/refs':\s*'warn'/);
  });
});
