jest.mock('../api/services/LocationService', () => ({
  updateMyLocation: jest.fn(),
}));

import {
  createLocationOutbox,
  LOCATION_OUTBOX_KEY,
  type LocationOutboxEntry,
} from '../state/locationOutbox';

function storageHarness(initial: LocationOutboxEntry[] = []) {
  let value = JSON.stringify(initial);
  return {
    getItem: jest.fn(async () => value),
    setItem: jest.fn(async (_key: string, next: string) => {
      value = next;
    }),
    read(): LocationOutboxEntry[] {
      return JSON.parse(value) as LocationOutboxEntry[];
    },
  };
}

describe('location outbox', () => {
  it('persists samples and flushes them oldest-first', async () => {
    let now = 1_000;
    const storage = storageHarness();
    const uploaded: LocationOutboxEntry[] = [];
    const outbox = createLocationOutbox(
      storage,
      async (entry) => {
        uploaded.push(entry);
      },
      () => now,
    );

    await outbox.enqueue({
      groupId: 'g1',
      coordinates: { latitude: 25.04, longitude: 121.5 },
      capturedAt: 2_000,
    });
    await outbox.enqueue({
      groupId: 'g1',
      coordinates: { latitude: 25.05, longitude: 121.51 },
      capturedAt: 1_000,
    });

    await expect(outbox.flush()).resolves.toEqual({ sent: 2, remaining: 0 });
    expect(uploaded.map((entry) => entry.capturedAt)).toEqual([1_000, 2_000]);
    expect(storage.getItem).toHaveBeenCalledWith(LOCATION_OUTBOX_KEY);
  });

  it('keeps failed samples and retries them after backoff', async () => {
    let now = 1_000;
    const storage = storageHarness();
    let attempts = 0;
    const outbox = createLocationOutbox(
      storage,
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('offline');
      },
      () => now,
    );

    await outbox.enqueue({
      groupId: 'g1',
      coordinates: { latitude: 25.04, longitude: 121.5 },
    });
    await expect(outbox.flush()).resolves.toEqual({ sent: 0, remaining: 1 });
    expect(storage.read()[0].attempts).toBe(1);

    now = 3_001;
    await expect(outbox.flush()).resolves.toEqual({ sent: 1, remaining: 0 });
  });

  it('drops entries past their TTL instead of uploading stale locations', async () => {
    const storage = storageHarness([
      {
        id: 'expired',
        groupId: 'g1',
        coordinates: { latitude: 25.04, longitude: 121.5 },
        capturedAt: 0,
        attempts: 0,
        nextAttemptAt: 0,
        expiresAt: 999,
      },
    ]);
    const uploader = jest.fn();
    const outbox = createLocationOutbox(storage, uploader, () => 1_000);

    await expect(outbox.flush()).resolves.toEqual({ sent: 0, remaining: 0 });
    expect(uploader).not.toHaveBeenCalled();
  });
});
