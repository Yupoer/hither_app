import {
  isPremiumProjectionActive,
  waitUntilPremiumProjectionActive,
} from '../utils/waitUntilPremiumProjection';

const inactive = {
  personalPremiumActive: false,
  teamPremiumActive: false,
  status: 'none' as const,
  productId: null,
  expiresAt: null,
  sourceVersion: null,
};

const active = {
  ...inactive,
  personalPremiumActive: true,
  status: 'active' as const,
};

describe('waitUntilPremiumProjectionActive', () => {
  it('treats personal or team premium as unlocked', () => {
    expect(isPremiumProjectionActive(inactive)).toBe(false);
    expect(isPremiumProjectionActive(active)).toBe(true);
    expect(isPremiumProjectionActive({
      ...inactive,
      teamPremiumActive: true,
    })).toBe(true);
  });

  it('does not finish on client-only success before projection is premium', async () => {
    const getPremiumProjection = jest.fn()
      .mockResolvedValueOnce(inactive)
      .mockResolvedValueOnce(inactive)
      .mockResolvedValueOnce(active);
    const ok = await waitUntilPremiumProjectionActive({
      groupId: 'g1',
      getPremiumProjection,
      timeoutMs: 1_000,
      intervalMs: 1,
      sleep: async () => undefined,
    });
    expect(ok).toBe(true);
    expect(getPremiumProjection).toHaveBeenCalledTimes(3);
  });

  it('returns false when projection never becomes premium', async () => {
    const getPremiumProjection = jest.fn().mockResolvedValue(inactive);
    const ok = await waitUntilPremiumProjectionActive({
      getPremiumProjection,
      timeoutMs: 5,
      intervalMs: 10,
      now: (() => {
        let t = 0;
        return () => {
          t += 3;
          return t;
        };
      })(),
      sleep: async () => undefined,
    });
    expect(ok).toBe(false);
  });

  it('returns immediately when already active', async () => {
    const getPremiumProjection = jest.fn();
    await expect(waitUntilPremiumProjectionActive({
      getPremiumProjection,
      alreadyActive: true,
    })).resolves.toBe(true);
    expect(getPremiumProjection).not.toHaveBeenCalled();
  });
});
