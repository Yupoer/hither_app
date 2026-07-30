import {
  __resetSharedLiveActivityTokenGateForTests,
  createLiveActivityTokenGate,
} from '../utils/liveActivityTokenGate';

describe('liveActivityTokenGate', () => {
  beforeEach(() => {
    __resetSharedLiveActivityTokenGateForTests();
  });

  const id = {
    userId: 'u1',
    deviceId: 'd1',
    token: 'tok',
    enabled: true,
  };

  it('registers once then skips identical identity (idempotent cache)', () => {
    const gate = createLiveActivityTokenGate();
    expect(gate.shouldRegister(id).action).toBe('register');
    gate.recordResult(id, 'upserted');
    expect(gate.shouldRegister(id)).toEqual({
      action: 'skip',
      reason: 'idempotent_cache',
    });
  });

  it('stops permanent conflict until identity changes', () => {
    const gate = createLiveActivityTokenGate();
    gate.recordResult(id, 'token_unique_unresolved');
    expect(gate.shouldRegister(id)).toEqual({
      action: 'skip',
      reason: 'permanent_conflict',
    });
    // Token rotation unlocks.
    const rotated = { ...id, token: 'tok2' };
    expect(gate.shouldRegister(rotated).action).toBe('register');
  });

  it('foreign conflict is permanent for that identity', () => {
    const gate = createLiveActivityTokenGate();
    gate.recordResult(id, 'foreign_token_conflict');
    expect(gate.shouldRegister(id)).toEqual({
      action: 'skip',
      reason: 'permanent_conflict',
    });
  });

  it('transient errors use bounded backoff', () => {
    let now = 1_000;
    const gate = createLiveActivityTokenGate({
      backoffBaseMs: 1_000,
      now: () => now,
    });
    gate.recordResult(id, 'unknown_error');
    expect(gate.shouldRegister(id)).toEqual({ action: 'skip', reason: 'backoff' });
    now = 10_000;
    expect(gate.shouldRegister(id).action).toBe('register');
  });

  it('disable path (null token) is a distinct identity', () => {
    const gate = createLiveActivityTokenGate();
    gate.recordResult(id, 'upserted');
    const off = { ...id, token: null, enabled: false };
    expect(gate.shouldRegister(off).action).toBe('register');
    gate.recordResult(off, 'upserted');
    expect(gate.shouldRegister(off).action).toBe('skip');
  });

  it('records unknown_error into backoff (thrown upsert path)', () => {
    let now = 1_000;
    const gate = createLiveActivityTokenGate({
      backoffBaseMs: 2_000,
      now: () => now,
    });
    gate.recordResult(id, 'unknown_error');
    expect(gate.shouldRegister(id)).toEqual({ action: 'skip', reason: 'backoff' });
    now = 5_000;
    expect(gate.shouldRegister(id).action).toBe('register');
  });

  it('hydrates permanent conflict from durable store', async () => {
    const key = `${id.userId}|${id.deviceId}|${id.token}|1`;
    const durable = {
      getPermanentKey: jest.fn(async () => key),
      setPermanentKey: jest.fn(async () => undefined),
    };
    const gate = createLiveActivityTokenGate({ durable });
    await gate.ready();
    expect(gate.shouldRegister(id)).toEqual({
      action: 'skip',
      reason: 'permanent_conflict',
    });
  });
});

