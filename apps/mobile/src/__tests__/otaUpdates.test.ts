jest.mock('expo-updates', () => ({
  isEnabled: true,
  isEmbeddedLaunch: false,
  updateId: 'new-update-id',
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));

jest.mock('react-native', () => ({
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import * as Updates from 'expo-updates';
import {
  __setOtaUsableForTests,
  applyOtaUpdate,
  applyOtaUpdateIfAvailable,
  consumeOtaAppliedNotice,
  currentOtaLaunchId,
  isOtaApplyInFlight,
  OTA_LAST_UPDATE_ID_KEY,
  shouldShowOtaAppliedToast,
  startOtaUpdateBootstrap,
} from '../utils/otaUpdates';

const checkForUpdateAsync = Updates.checkForUpdateAsync as jest.Mock;
const fetchUpdateAsync = Updates.fetchUpdateAsync as jest.Mock;
const reloadAsync = Updates.reloadAsync as jest.Mock;
const getItem = AsyncStorage.getItem as jest.Mock;
const setItem = AsyncStorage.setItem as jest.Mock;
const rollbackCheck: Updates.UpdateCheckResult = {
  isAvailable: false,
  isRollBackToEmbedded: true,
  manifest: undefined,
  reason: undefined,
};
const rollbackFetch: Updates.UpdateFetchResult = {
  isNew: false,
  isRollBackToEmbedded: true,
  manifest: undefined,
};

describe('otaUpdates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    checkForUpdateAsync.mockReset().mockResolvedValue({
      isAvailable: false,
      isRollBackToEmbedded: false,
    });
    fetchUpdateAsync.mockReset().mockResolvedValue({
      isNew: false,
      isRollBackToEmbedded: false,
    });
    reloadAsync.mockReset().mockResolvedValue(undefined);
    __setOtaUsableForTests(null);
  });

  afterEach(() => {
    __setOtaUsableForTests(null);
  });

  it('exposes apply + bootstrap entrypoints for App.tsx', () => {
    expect(typeof applyOtaUpdateIfAvailable).toBe('function');
    expect(typeof applyOtaUpdate).toBe('function');
    expect(typeof startOtaUpdateBootstrap).toBe('function');
    expect(typeof isOtaApplyInFlight).toBe('function');
  });

  it('wires expo-updates APIs used by production bootstrap', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../utils/otaUpdates.ts'),
      'utf8',
    );
    expect(src).toContain('checkForUpdateAsync');
    expect(src).toContain('fetchUpdateAsync');
    expect(src).toContain('reloadAsync');
    expect(src).toContain("AppState.addEventListener('change'");
    expect(src).toContain('consumeOtaAppliedNotice');
    expect(src).toContain('pendingManualFollowUp');
    expect(src).toContain('inFlight');
  });

  it('no-ops under Jest/dev without calling Updates', async () => {
    await expect(applyOtaUpdateIfAvailable()).resolves.toBe(false);
    await expect(applyOtaUpdate({ manual: true })).resolves.toMatchObject({
      status: 'disabled',
      reloading: false,
    });
    expect(checkForUpdateAsync).not.toHaveBeenCalled();
    expect(fetchUpdateAsync).not.toHaveBeenCalled();
    expect(reloadAsync).not.toHaveBeenCalled();
  });

  it('bootstrap registers an AppState listener cleanup', () => {
    const stop = startOtaUpdateBootstrap();
    expect(typeof stop).toBe('function');
    stop();
  });

  it('single-flight: concurrent callers share one reloadAsync', async () => {
    __setOtaUsableForTests(true);
    let resolveCheck: (v: { isAvailable: boolean }) => void = () => undefined;
    checkForUpdateAsync.mockImplementation(
      () =>
        new Promise<{ isAvailable: boolean }>((resolve) => {
          resolveCheck = resolve;
        }),
    );
    fetchUpdateAsync.mockResolvedValue({ isNew: true });
    reloadAsync.mockResolvedValue(undefined);

    const a = applyOtaUpdate({ manual: false });
    const b = applyOtaUpdate({ manual: true, skipCheck: true });
    expect(isOtaApplyInFlight()).toBe(true);
    resolveCheck({ isAvailable: true });
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.reloading).toBe(true);
    expect(rb.reloading).toBe(true);
    // One check + one fetch + one reload (no stacked reloads).
    expect(checkForUpdateAsync).toHaveBeenCalledTimes(1);
    expect(fetchUpdateAsync).toHaveBeenCalledTimes(1);
    expect(reloadAsync).toHaveBeenCalledTimes(1);
  });

  it('manual follow-up after soft auto no_update reloads once for all waiters', async () => {
    __setOtaUsableForTests(true);
    checkForUpdateAsync
      .mockResolvedValueOnce({ isAvailable: false })
      .mockResolvedValueOnce({ isAvailable: true });
    fetchUpdateAsync.mockResolvedValue({ isNew: true });
    reloadAsync.mockResolvedValue(undefined);

    const auto = applyOtaUpdate({ manual: false });
    // Join while auto in flight — marks pendingManualFollowUp inside shared chain.
    const manual = applyOtaUpdate({ manual: true });
    const [autoOut, manualOut] = await Promise.all([auto, manual]);
    // Shared promise drains manual follow-up; every waiter sees reloading.
    expect(autoOut).toEqual(manualOut);
    expect(autoOut.reloading).toBe(true);
    expect(reloadAsync).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('applies SDK rollback from check for manual=%s', async (manual) => {
    __setOtaUsableForTests(true);
    checkForUpdateAsync.mockResolvedValue(rollbackCheck);
    fetchUpdateAsync.mockResolvedValue(rollbackFetch);
    await expect(applyOtaUpdate({ manual })).resolves.toEqual({
      status: 'reloading', reloading: true,
    });
    expect(fetchUpdateAsync).toHaveBeenCalledTimes(1);
    expect(reloadAsync).toHaveBeenCalledTimes(1);
  });

  it('applies rollback arriving during fetch after an available update check', async () => {
    __setOtaUsableForTests(true);
    checkForUpdateAsync.mockResolvedValue({ isAvailable: true, isRollBackToEmbedded: false });
    fetchUpdateAsync.mockResolvedValue(rollbackFetch);
    await expect(applyOtaUpdateIfAvailable()).resolves.toBe(true);
    expect(reloadAsync).toHaveBeenCalledTimes(1);
  });

  it('shares one rollback fetch and reload across automatic and manual callers', async () => {
    __setOtaUsableForTests(true);
    let resolveCheck!: (value: Updates.UpdateCheckResult) => void;
    checkForUpdateAsync.mockImplementation(() => new Promise((resolve) => { resolveCheck = resolve; }));
    fetchUpdateAsync.mockResolvedValue(rollbackFetch);
    const automatic = applyOtaUpdate();
    const manual = applyOtaUpdate({ manual: true });
    resolveCheck(rollbackCheck);
    const results = await Promise.all([automatic, manual]);
    expect(results).toEqual([
      { status: 'reloading', reloading: true }, { status: 'reloading', reloading: true },
    ]);
    expect(checkForUpdateAsync).toHaveBeenCalledTimes(1);
    expect(fetchUpdateAsync).toHaveBeenCalledTimes(1);
    expect(reloadAsync).toHaveBeenCalledTimes(1);
    expect(isOtaApplyInFlight()).toBe(false);
  });

  it('does not reload when a rollback check fetches neither a bundle nor a directive', async () => {
    __setOtaUsableForTests(true);
    checkForUpdateAsync.mockResolvedValue(rollbackCheck);
    await expect(applyOtaUpdate()).resolves.toMatchObject({ status: 'no_update' });
    expect(fetchUpdateAsync).toHaveBeenCalledTimes(1);
    expect(reloadAsync).not.toHaveBeenCalled();
  });

  it('reloads a known pending manual update when fetch has no new directive', async () => {
    __setOtaUsableForTests(true);
    await expect(applyOtaUpdate({ manual: true, skipCheck: true })).resolves.toMatchObject({ status: 'reloading' });
    expect(checkForUpdateAsync).not.toHaveBeenCalled();
    expect(reloadAsync).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('preserves rollback fetch failure behavior for manual=%s', async (manual) => {
    __setOtaUsableForTests(true);
    checkForUpdateAsync.mockResolvedValue(rollbackCheck);
    fetchUpdateAsync.mockRejectedValue(new Error('fetch unavailable'));
    await expect(applyOtaUpdate({ manual })).resolves.toMatchObject({ status: manual ? 'fetch_failed' : 'no_update' });
    expect(reloadAsync).not.toHaveBeenCalled();
  });

  it.each([false, true])('preserves rollback reload failure behavior for manual=%s', async (manual) => {
    __setOtaUsableForTests(true);
    checkForUpdateAsync.mockResolvedValue(rollbackCheck);
    fetchUpdateAsync.mockResolvedValue(rollbackFetch);
    reloadAsync.mockRejectedValue(new Error('reload unavailable'));
    await expect(applyOtaUpdate({ manual })).resolves.toMatchObject({ status: manual ? 'reload_failed' : 'no_update' });
    expect(reloadAsync).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('preserves check failure behavior for manual=%s', async (manual) => {
    __setOtaUsableForTests(true);
    checkForUpdateAsync.mockRejectedValue(new Error('check unavailable'));
    fetchUpdateAsync.mockResolvedValue(rollbackFetch);
    await expect(applyOtaUpdate({ manual })).resolves.toMatchObject({ status: manual ? 'reloading' : 'no_update' });
    expect(fetchUpdateAsync).toHaveBeenCalledTimes(manual ? 1 : 0);
  });

  it('checks rollback on boot and foreground through the shared lifecycle', async () => {
    __setOtaUsableForTests(true);
    checkForUpdateAsync.mockResolvedValue(rollbackCheck);
    fetchUpdateAsync.mockResolvedValue(rollbackFetch);
    const stop = startOtaUpdateBootstrap();
    await applyOtaUpdate();
    const listener = (AppState.addEventListener as jest.Mock).mock.calls.at(-1)[1];
    listener('background');
    expect(checkForUpdateAsync).toHaveBeenCalledTimes(1);
    listener('active');
    await applyOtaUpdate();
    expect(checkForUpdateAsync).toHaveBeenCalledTimes(2);
    expect(reloadAsync).toHaveBeenCalledTimes(2);
    stop();
    stop();
  });
});

describe('shouldShowOtaAppliedToast', () => {
  it('hides on first launch (no last seen id)', () => {
    expect(
      shouldShowOtaAppliedToast({
        lastSeenId: null,
        currentId: 'abc',
        isEmbeddedLaunch: false,
      }),
    ).toBe(false);
  });

  it('hides when embedded / no current id', () => {
    expect(
      shouldShowOtaAppliedToast({
        lastSeenId: 'old',
        currentId: 'new',
        isEmbeddedLaunch: true,
      }),
    ).toBe(false);
    expect(
      shouldShowOtaAppliedToast({
        lastSeenId: 'old',
        currentId: null,
        isEmbeddedLaunch: false,
      }),
    ).toBe(false);
  });

  it('hides when update id unchanged', () => {
    expect(
      shouldShowOtaAppliedToast({
        lastSeenId: 'same',
        currentId: 'same',
        isEmbeddedLaunch: false,
      }),
    ).toBe(false);
  });

  it('shows when update id changed', () => {
    expect(
      shouldShowOtaAppliedToast({
        lastSeenId: 'old-id',
        currentId: 'new-id',
        isEmbeddedLaunch: false,
      }),
    ).toBe(true);
  });
});

describe('consumeOtaAppliedNotice', () => {
  it('returns true and persists when id changed', async () => {
    getItem.mockResolvedValue('old-id');
    await expect(consumeOtaAppliedNotice()).resolves.toBe(true);
    expect(setItem).toHaveBeenCalledWith(OTA_LAST_UPDATE_ID_KEY, 'new-update-id');
  });

  it('returns false and still seeds storage on first run', async () => {
    getItem.mockResolvedValue(null);
    await expect(consumeOtaAppliedNotice()).resolves.toBe(false);
    expect(setItem).toHaveBeenCalledWith(OTA_LAST_UPDATE_ID_KEY, 'new-update-id');
  });

  it('keeps embedded rollback launches silent and persists the embedded identity', async () => {
    const embedded = jest.replaceProperty(Updates, 'isEmbeddedLaunch', true);
    try {
      getItem.mockResolvedValue('old-id');
      expect(currentOtaLaunchId()).toBe('embedded');
      await expect(consumeOtaAppliedNotice()).resolves.toBe(false);
      expect(setItem).toHaveBeenCalledWith(OTA_LAST_UPDATE_ID_KEY, 'embedded');
    } finally {
      embedded.restore();
    }
  });

  it('softly ignores unavailable notice storage', async () => {
    getItem.mockRejectedValue(new Error('storage unavailable'));
    await expect(consumeOtaAppliedNotice()).resolves.toBe(false);
  });
});
