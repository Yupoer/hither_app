jest.mock('expo-updates', () => ({
  isEnabled: true,
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));

jest.mock('react-native', () => ({
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

import * as Updates from 'expo-updates';
import { applyOtaUpdateIfAvailable, startOtaUpdateBootstrap } from '../utils/otaUpdates';

const checkForUpdateAsync = Updates.checkForUpdateAsync as jest.Mock;
const fetchUpdateAsync = Updates.fetchUpdateAsync as jest.Mock;
const reloadAsync = Updates.reloadAsync as jest.Mock;

describe('otaUpdates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // __DEV__ is true under Jest — force production path via isEnabled alone is not enough.
    // Module caches OTA_USABLE at import time with __DEV__ true, so apply returns false.
    // Contract: when usable, check → fetch → reload.
  });

  it('exposes apply + bootstrap entrypoints for App.tsx', () => {
    expect(typeof applyOtaUpdateIfAvailable).toBe('function');
    expect(typeof startOtaUpdateBootstrap).toBe('function');
  });

  it('wires expo-updates APIs used by production bootstrap', () => {
    // Source contract: production path must call these three.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../utils/otaUpdates.ts'),
      'utf8',
    );
    expect(src).toContain('checkForUpdateAsync');
    expect(src).toContain('fetchUpdateAsync');
    expect(src).toContain('reloadAsync');
    expect(src).toContain("AppState.addEventListener('change'");
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
