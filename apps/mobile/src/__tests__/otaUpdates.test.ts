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
import * as Updates from 'expo-updates';
import {
  __setOtaUsableForTests,
  applyOtaUpdate,
  applyOtaUpdateIfAvailable,
  consumeOtaAppliedNotice,
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

describe('otaUpdates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
