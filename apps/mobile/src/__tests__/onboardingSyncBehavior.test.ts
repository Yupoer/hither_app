jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

jest.mock('../api/client', () => ({
  saveOnboardingProfile: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveOnboardingProfile } from '../api/client';
import {
  ONBOARDING_REPLAY_INTENT_KEY,
  ONBOARDING_STORAGE_KEY,
  isOnboardingCompleteForTourGate,
  markOnboardingReplayForHome,
  readOnboardingReplayIntent,
  readOnboardingState,
  shouldPresentFullOnboarding,
  syncOnboardingIfNeeded,
  writeOnboardingCompleted,
  writeOnboardingReplayIntent,
} from '../onboarding/sync';

const storage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const saveProfile = saveOnboardingProfile as jest.Mock;

const answers = { travelStyle: 'slow' } as any;

beforeEach(() => {
  jest.clearAllMocks();
  storage.getItem.mockResolvedValue(null);
  storage.setItem.mockResolvedValue(undefined);
  storage.removeItem.mockResolvedValue(undefined);
});

describe('onboarding durable state', () => {
  it('reads empty, valid, and malformed local state without inventing answers', async () => {
    await expect(readOnboardingState()).resolves.toBeNull();

    storage.getItem.mockResolvedValueOnce(JSON.stringify({
      completed: true,
      answers,
      completedAt: '2026-09-19T00:00:00.000Z',
    }));
    await expect(readOnboardingState()).resolves.toMatchObject({ completed: true, answers });

    storage.getItem.mockResolvedValueOnce('{bad json');
    await expect(readOnboardingState()).resolves.toBeNull();
  });

  it('writes completed answers and clears a pending replay intent', async () => {
    await writeOnboardingCompleted(answers);

    expect(storage.setItem).toHaveBeenNthCalledWith(
      1,
      ONBOARDING_STORAGE_KEY,
      expect.stringContaining('"completed":true'),
    );
    expect(storage.removeItem).toHaveBeenCalledWith(ONBOARDING_REPLAY_INTENT_KEY);
  });

  it('round-trips replay intent and fails closed on storage errors', async () => {
    storage.getItem.mockResolvedValueOnce('1');
    await expect(readOnboardingReplayIntent()).resolves.toBe(true);
    storage.getItem.mockResolvedValueOnce('true');
    await expect(readOnboardingReplayIntent()).resolves.toBe(true);
    storage.getItem.mockResolvedValueOnce('0');
    await expect(readOnboardingReplayIntent()).resolves.toBe(false);

    await writeOnboardingReplayIntent(true);
    expect(storage.setItem).toHaveBeenCalledWith(ONBOARDING_REPLAY_INTENT_KEY, '1');
    await writeOnboardingReplayIntent(false);
    expect(storage.removeItem).toHaveBeenCalledWith(ONBOARDING_REPLAY_INTENT_KEY);

    storage.getItem.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(readOnboardingReplayIntent()).resolves.toBe(false);
  });

  it('marks replay without navigating or retaining stale answers', async () => {
    await markOnboardingReplayForHome();

    expect(storage.setItem).toHaveBeenCalledWith(ONBOARDING_REPLAY_INTENT_KEY, '1');
    expect(storage.removeItem).toHaveBeenCalledWith(ONBOARDING_STORAGE_KEY);
  });
});

describe('onboarding presentation gates', () => {
  it.each([
    [{ storageCompleted: false, replayIntent: false, atHomeBoundary: false }, true],
    [{ storageCompleted: false, replayIntent: true, atHomeBoundary: false }, false],
    [{ storageCompleted: false, replayIntent: true, atHomeBoundary: true }, true],
    [{ storageCompleted: true, replayIntent: true, atHomeBoundary: true }, true],
    [{ storageCompleted: true, replayIntent: true, atHomeBoundary: false }, false],
    [{ storageCompleted: true, replayIntent: false, atHomeBoundary: true }, false],
  ] as const)('presents full onboarding for %p => %s', (input, expected) => {
    expect(shouldPresentFullOnboarding(input)).toBe(expected);
  });

  it.each([
    [{ storageCompleted: false, replayIntent: false }, false],
    [{ storageCompleted: true, replayIntent: false }, true],
    [{ storageCompleted: true, replayIntent: true }, false],
  ] as const)('tour gate for %p => %s', (input, expected) => {
    expect(isOnboardingCompleteForTourGate(input)).toBe(expected);
  });
});

describe('onboarding profile sync', () => {
  it('does nothing for absent, incomplete, or already synced state', async () => {
    await syncOnboardingIfNeeded();
    expect(saveProfile).not.toHaveBeenCalled();

    storage.getItem.mockResolvedValueOnce(JSON.stringify({ completed: false, answers }));
    await syncOnboardingIfNeeded();
    expect(saveProfile).not.toHaveBeenCalled();

    storage.getItem.mockResolvedValueOnce(JSON.stringify({ completed: true, synced: true, answers }));
    await syncOnboardingIfNeeded();
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it('uploads pending answers and marks the same durable record synced', async () => {
    storage.getItem.mockResolvedValueOnce(JSON.stringify({
      completed: true,
      answers,
      completedAt: '2026-09-19T00:00:00.000Z',
    }));
    saveProfile.mockResolvedValue(undefined);

    await syncOnboardingIfNeeded();

    expect(saveProfile).toHaveBeenCalledWith(answers);
    expect(storage.setItem).toHaveBeenCalledWith(
      ONBOARDING_STORAGE_KEY,
      expect.stringContaining('"synced":true'),
    );
  });

  it('keeps pending answers retryable after a profile write failure', async () => {
    const state = { completed: true, answers, completedAt: '2026-09-19T00:00:00.000Z' };
    storage.getItem.mockResolvedValueOnce(JSON.stringify(state));
    saveProfile.mockRejectedValueOnce({ status: 503, code: 'upstream', message: 'unavailable' });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(syncOnboardingIfNeeded()).resolves.toBeUndefined();

    expect(storage.setItem).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[onboarding] profile sync failed', expect.objectContaining({
      kind: 'service_unavailable',
      status: 503,
    }));
    warn.mockRestore();
  });
});
