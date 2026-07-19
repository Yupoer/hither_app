jest.mock('../api/services/LocationService', () => ({
  ingestLocationBatch: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000777'),
}));
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
}));

import {
  createLocationOutbox,
  LOCATION_OUTBOX_KEY,
  type LocationOutboxDatabase,
  type LocationOutboxEntry,
  type LocationUploadEvent,
} from '../state/locationOutbox';

class MemoryLocationOutboxDatabase implements LocationOutboxDatabase {
  entries = new Map<string, LocationOutboxEntry>();

  async initialize(): Promise<void> {}

  async insert(entry: LocationOutboxEntry): Promise<void> {
    if (!this.entries.has(entry.id)) this.entries.set(entry.id, entry);
  }

  async removeExpired(now: number): Promise<void> {
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(id);
    }
  }

  async getDue(now: number, limit: number): Promise<LocationOutboxEntry[]> {
    return [...this.entries.values()]
      .filter((entry) => entry.nextAttemptAt <= now)
      .sort((a, b) => a.capturedAt - b.capturedAt || a.sequence - b.sequence)
      .slice(0, limit);
  }

  async resolveBatch(
    acceptedIds: string[],
    failed: Array<Pick<LocationOutboxEntry, 'id' | 'attempts' | 'nextAttemptAt'>>,
  ): Promise<void> {
    acceptedIds.forEach((id) => this.entries.delete(id));
    failed.forEach((update) => {
      const entry = this.entries.get(update.id);
      if (entry) this.entries.set(update.id, { ...entry, ...update });
    });
  }

  async count(): Promise<number> {
    return this.entries.size;
  }

  async purge(): Promise<void> {
    this.entries.clear();
  }
}

const event = (overrides: Partial<LocationUploadEvent> = {}): LocationUploadEvent => ({
  id: '00000000-0000-4000-8000-000000000001',
  groupId: 'g1',
  navigationSessionId: 'n1',
  capturedAt: 1_000,
  coords: { latitude: 25.04, longitude: 121.5, accuracy: 12 },
  trackingMode: 'teamNavigation',
  source: 'background_task',
  sequence: 1,
  ...overrides,
});

describe('SQLite location outbox', () => {
  it('uploads oldest entries in sequence order with one RPC call per batch', async () => {
    const database = new MemoryLocationOutboxDatabase();
    const upload = jest.fn(async (events: LocationUploadEvent[]) => ({
      acceptedIds: events.map((item) => item.id),
      rejected: [],
    }));
    const outbox = createLocationOutbox(database, upload, () => 10_000);

    await outbox.enqueue(event({ id: 'b', capturedAt: 2_000, sequence: 2 }));
    await outbox.enqueue(event({ id: 'c', capturedAt: 1_000, sequence: 3 }));
    await outbox.enqueue(event({ id: 'a', capturedAt: 1_000, sequence: 1 }));

    await expect(outbox.flush()).resolves.toEqual({
      sent: 3,
      discarded: 0,
      remaining: 0,
      retryScheduled: 0,
    });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0].map((item) => item.id)).toEqual(['a', 'c', 'b']);
  });

  it('keeps UUIDs stable across failures and applies capped exponential backoff', async () => {
    let now = 1_000;
    const database = new MemoryLocationOutboxDatabase();
    const upload = jest
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({
        acceptedIds: ['00000000-0000-4000-8000-000000000001'],
        rejected: [],
      });
    const outbox = createLocationOutbox(database, upload, () => now);

    await outbox.enqueue(event());
    await expect(outbox.flush()).resolves.toEqual({
      sent: 0,
      discarded: 0,
      remaining: 1,
      retryScheduled: 1,
    });
    expect(database.entries.values().next().value).toMatchObject({
      id: '00000000-0000-4000-8000-000000000001',
      attempts: 1,
      nextAttemptAt: 3_000,
    });

    now = 3_001;
    await expect(outbox.flush()).resolves.toEqual({
      sent: 1,
      discarded: 0,
      remaining: 0,
      retryScheduled: 0,
    });
    expect(upload.mock.calls[0][0][0].id).toBe(upload.mock.calls[1][0][0].id);

    const capped = createLocationOutbox(database, jest.fn().mockRejectedValue(new Error('offline')), () => now);
    await database.insert({ ...event({ id: 'cap' }), attempts: 20, nextAttemptAt: now, expiresAt: now + 86_400_000 });
    await capped.flush();
    expect(database.entries.get('cap')?.nextAttemptAt).toBe(now + 15 * 60_000);
  });

  it('deletes permanent RPC rejects and retries only transport failures', async () => {
    const database = new MemoryLocationOutboxDatabase();
    const upload = jest.fn(async (events: LocationUploadEvent[]) => ({
      acceptedIds: [events[0]!.id],
      rejected: [{ id: events[1]!.id, reason: 'invalid_event' }],
    }));
    const outbox = createLocationOutbox(database, upload, () => 10_000);
    await outbox.enqueue(event({ id: '00000000-0000-4000-8000-000000000001' }));
    await outbox.enqueue(event({ id: '00000000-0000-4000-8000-000000000002' }));

    await expect(outbox.flush()).resolves.toEqual({
      sent: 1,
      discarded: 1,
      remaining: 0,
      retryScheduled: 0,
    });
    expect(database.entries.size).toBe(0);
  });

  it('drops entries after the 24-hour TTL without uploading them', async () => {
    const now = 86_401_000;
    const database = new MemoryLocationOutboxDatabase();
    await database.insert({
      ...event(),
      attempts: 0,
      nextAttemptAt: 0,
      expiresAt: 86_401_000,
    });
    const upload = jest.fn();
    const outbox = createLocationOutbox(database, upload, () => now);

    await expect(outbox.flush()).resolves.toEqual({
      sent: 0,
      discarded: 0,
      remaining: 0,
      retryScheduled: 0,
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('purges every pending location when sharing is disabled', async () => {
    const database = new MemoryLocationOutboxDatabase();
    const outbox = createLocationOutbox(database, jest.fn(), () => 1_000);
    await outbox.enqueue(event());

    await outbox.purge();

    expect(await database.count()).toBe(0);
  });

  it('imports valid legacy entries once and removes the AsyncStorage key', async () => {
    const legacy = [{
      id: '00000000-0000-4000-8000-000000000099',
      groupId: 'g1',
      coordinates: { latitude: 25.04, longitude: 121.5 },
      capturedAt: 1_000,
      attempts: 0,
      nextAttemptAt: 1_000,
      expiresAt: 86_401_000,
    }];
    const storage = {
      getItem: jest.fn(async () => JSON.stringify(legacy)),
      removeItem: jest.fn(async () => undefined),
    };
    const database = new MemoryLocationOutboxDatabase();
    const outbox = createLocationOutbox(database, jest.fn(), () => 2_000, storage);

    await outbox.initialize();
    await outbox.initialize();

    expect(storage.getItem).toHaveBeenCalledTimes(1);
    expect(storage.removeItem).toHaveBeenCalledWith(LOCATION_OUTBOX_KEY);
    expect(database.entries.get('00000000-0000-4000-8000-000000000099')).toMatchObject({
      coords: { latitude: 25.04, longitude: 121.5, accuracy: 0 },
      trackingMode: 'foreground',
      source: 'foreground',
      sequence: 1_000,
    });
  });
});
