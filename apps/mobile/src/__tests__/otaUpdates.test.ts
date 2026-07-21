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
  applyOtaUpdateIfAvailable,
  consumeOtaAppliedNotice,
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
  });

  it('exposes apply + bootstrap entrypoints for App.tsx', () => {
    expect(typeof applyOtaUpdateIfAvailable).toBe('function');
    expect(typeof startOtaUpdateBootstrap).toBe('function');
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
  });

  it('no-ops under Jest/dev without calling Updates', async () => {
    await expect(applyOtaUpdateIfAvailable()).resolves.toBe(false);
    expect(checkForUpdateAsync).not.toHaveBeenCalled();
    expect(fetchUpdateAsync).not.toHaveBeenCalled();
    expect(reloadAsync).not.toHaveBeenCalled();
  });

  it('bootstrap registers an AppState listener cleanup', () => {
    const stop = startOtaUpdateBootstrap();
    expect(typeof stop).toBe('function');
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
});
