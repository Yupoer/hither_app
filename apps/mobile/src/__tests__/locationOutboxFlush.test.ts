jest.mock('../api/services/LocationService', () => ({
  ingestLocationBatch: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000777'),
}));
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
}));

import { createSingleFlightFlush } from '../utils/locationOutboxFlush';
import {
  createLocationOutbox,
  type LocationOutboxDatabase,
  type LocationOutboxEntry,
  type LocationUploadEvent,
} from '../state/locationOutbox';

class MemoryDb implements LocationOutboxDatabase {
  entries = new Map<string, LocationOutboxEntry>();
  async initialize(): Promise<void> {}
  async insert(entry: LocationOutboxEntry): Promise<void> {
    if (!this.entries.has(entry.id)) this.entries.set(entry.id, entry);
  }
  async removeExpired(now: number): Promise<void> {
    for (const [id, e] of this.entries) {
      if (e.expiresAt <= now) this.entries.delete(id);
    }
  }
  async getDue(now: number, limit: number): Promise<LocationOutboxEntry[]> {
    return [...this.entries.values()]
      .filter((e) => e.nextAttemptAt <= now)
      .sort((a, b) => a.capturedAt - b.capturedAt)
      .slice(0, limit);
  }
  async resolveBatch(
    acceptedIds: string[],
    failed: Array<Pick<LocationOutboxEntry, 'id' | 'attempts' | 'nextAttemptAt'>>,
  ): Promise<void> {
    acceptedIds.forEach((id) => this.entries.delete(id));
    failed.forEach((u) => {
      const e = this.entries.get(u.id);
      if (e) this.entries.set(u.id, { ...e, ...u });
    });
  }
  async count(): Promise<number> {
    return this.entries.size;
  }
  async purge(): Promise<void> {
    this.entries.clear();
  }
}

describe('createSingleFlightFlush', () => {
  it('coalesces concurrent callers into one run', async () => {
    let runs = 0;
    let resolve!: () => void;
    const barrier = new Promise<void>((r) => {
      resolve = r;
    });
    const { flush, isInFlight } = createSingleFlightFlush(async () => {
      runs += 1;
      await barrier;
      return runs;
    });
    const a = flush();
    const b = flush();
    expect(isInFlight()).toBe(true);
    resolve();
    await expect(Promise.all([a, b])).resolves.toEqual([1, 1]);
    expect(runs).toBe(1);
  });
});

describe('location outbox single-flight flush', () => {
  it('parallel flush shares one upload batch', async () => {
    const db = new MemoryDb();
    let uploads = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const upload = jest.fn(async (events: LocationUploadEvent[]) => {
      uploads += 1;
      await gate;
      return { acceptedIds: events.map((e) => e.id), rejected: [] };
    });
    const outbox = createLocationOutbox(db, upload, () => 10_000);
    await outbox.enqueue({
      id: '00000000-0000-4000-8000-000000000001',
      groupId: 'g1',
      navigationSessionId: null,
      capturedAt: 1_000,
      coords: { latitude: 25, longitude: 121 },
      trackingMode: 'foreground',
      source: 'foreground',
      sequence: 1,
    });

    const p1 = outbox.flush();
    const p2 = outbox.flush();
    release();
    await Promise.all([p1, p2]);
    expect(uploads).toBe(1);
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
