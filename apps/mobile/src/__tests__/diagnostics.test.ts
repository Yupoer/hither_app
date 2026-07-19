jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    sessionId: 'device-session-1234',
    nativeBuildVersion: '42',
    expoConfig: { version: '0.1.3' },
  },
}));
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000555'),
}));
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('../api/services/DiagnosticService', () => ({
  ingestDiagnosticBatch: jest.fn(),
}));

const consentEnabled = { value: true };
jest.mock('../state/diagnosticConsent', () => ({
  getDiagnosticConsentEnabled: jest.fn(async () => consentEnabled.value),
  setDiagnosticConsentEnabled: jest.fn(async (next: boolean) => {
    consentEnabled.value = next;
  }),
}));
jest.mock('../state/logBatchScheduler', () => ({
  notifyLogRecorded: jest.fn(),
}));

import {
  createDiagnostics,
  type DiagnosticDatabase,
  type DiagnosticRecord,
} from '../state/diagnostics';

class MemoryDiagnosticDatabase implements DiagnosticDatabase {
  records = new Map<string, DiagnosticRecord>();

  async initialize(): Promise<void> {}

  async insert(record: DiagnosticRecord): Promise<void> {
    this.records.set(record.id, record);
  }

  async cleanup(cutoff: number, maximum: number): Promise<void> {
    for (const [id, record] of this.records) {
      if (record.timestamp < cutoff) this.records.delete(id);
    }
    const excess = [...this.records.values()]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(maximum);
    excess.forEach((record) => this.records.delete(record.id));
  }

  async list(limit: number): Promise<DiagnosticRecord[]> {
    return [...this.records.values()]
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-limit);
  }

  async getPending(limit: number): Promise<DiagnosticRecord[]> {
    return (await this.list(Number.MAX_SAFE_INTEGER))
      .filter((record) => record.uploadedAt === null)
      .slice(0, limit);
  }

  async resolveUpload(acceptedIds: string[], failedIds: string[], uploadedAt: number): Promise<void> {
    acceptedIds.forEach((id) => {
      const record = this.records.get(id);
      if (record) this.records.set(id, { ...record, uploadedAt });
    });
    failedIds.forEach((id) => {
      const record = this.records.get(id);
      if (record) this.records.set(id, { ...record, attempts: record.attempts + 1 });
    });
  }

  async pendingCount(): Promise<number> {
    return [...this.records.values()].filter((record) => record.uploadedAt === null).length;
  }

  async purgeUnuploaded(): Promise<void> {
    for (const [id, record] of [...this.records.entries()]) {
      if (record.uploadedAt === null) this.records.delete(id);
    }
  }
}

const metadata = {
  sessionId: '00000000-0000-4000-8000-000000000999',
  deviceId: 'device-session-1234',
  buildNumber: '42',
  appVersion: '0.1.3',
};

describe('bounded diagnostics', () => {
  beforeEach(() => {
    consentEnabled.value = true;
  });

  it('skips insert and upload when diagnostic consent is off', async () => {
    consentEnabled.value = false;
    const database = new MemoryDiagnosticDatabase();
    const upload = jest.fn();
    const diagnostics = createDiagnostics(
      database,
      upload,
      () => 1_000,
      metadata,
      () => 'id-1',
    );
    await diagnostics.write({ event: 'location_callback' });
    expect(database.records.size).toBe(0);
    await expect(diagnostics.flush()).resolves.toEqual({ sent: 0, remaining: 0 });
    expect(upload).not.toHaveBeenCalled();
  });

  it('redacts secrets, exact coordinates, email and raw error messages', async () => {
    const diagnostics = createDiagnostics(
      new MemoryDiagnosticDatabase(),
      jest.fn(),
      () => 1_000,
      metadata,
      () => '00000000-0000-4000-8000-000000000001',
    );

    await diagnostics.write({
      event: 'location_upload_failed',
      errorCode: 'offline',
      trackingMode: 'teamNavigation',
      pushToken: 'secret-token',
      token: 'secret-token-2',
      latitude: 25.04,
      longitude: 121.5,
      email: 'person@example.com',
      errorMessage: 'socket exposed a private URL',
    } as never);

    const exported = await diagnostics.exportJson();
    expect(exported).toContain('offline');
    expect(exported).toContain('teamNavigation');
    expect(exported).not.toMatch(/secret-token|25\.04|121\.5|person@example\.com|private URL/);
  });

  it('keeps at most 10,000 records and removes events older than 72 hours', async () => {
    let now = 72 * 60 * 60 * 1_000 + 1;
    let sequence = 0;
    const database = new MemoryDiagnosticDatabase();
    database.records.set('old', {
      id: 'old',
      timestamp: 0,
      sessionId: metadata.sessionId,
      event: 'diagnostic_error',
      navigationSessionId: null,
      payload: {},
      attempts: 0,
      uploadedAt: null,
    });
    const diagnostics = createDiagnostics(
      database,
      jest.fn(),
      () => now++,
      metadata,
      () => `event-${sequence++}`,
    );

    for (let index = 0; index < 10_005; index += 1) {
      await diagnostics.write({ event: 'diagnostic_error', errorCode: 'test' });
    }

    expect((await diagnostics.list()).length).toBe(10_000);
    expect(database.records.has('old')).toBe(false);
  });

  it('drops successful callback noise in minimal mode but preserves callback errors', async () => {
    let id = 0;
    const diagnostics = createDiagnostics(
      new MemoryDiagnosticDatabase(),
      jest.fn(),
      () => 1_000,
      metadata,
      () => `event-${id++}`,
      'minimal',
    );

    await diagnostics.write({ event: 'location_callback', success: true });
    await diagnostics.write({ event: 'location_callback', success: false, errorCode: 'timeout' });

    expect((await diagnostics.list()).map((record) => record.payload.errorCode)).toEqual(['timeout']);
  });

  it('uploads one batch of 100 and marks only accepted records uploaded', async () => {
    let id = 0;
    const database = new MemoryDiagnosticDatabase();
    const upload = jest.fn(async (records: DiagnosticRecord[]) => ({
      acceptedIds: records.slice(0, 99).map((record) => record.id),
      rejected: [{ id: records[99].id, reason: 'invalid_event' }],
    }));
    const diagnostics = createDiagnostics(
      database,
      upload,
      () => 5_000,
      metadata,
      () => `event-${id++}`,
    );
    for (let index = 0; index < 101; index += 1) {
      await diagnostics.write({ event: 'diagnostic_error', errorCode: 'test' });
    }

    await expect(diagnostics.flush()).resolves.toEqual({ sent: 99, remaining: 2 });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0]).toHaveLength(100);
    expect(database.records.get('event-99')).toMatchObject({ attempts: 1, uploadedAt: null });
  });

  it('summarizes event and pending counts without exposing payload values', async () => {
    let id = 0;
    const diagnostics = createDiagnostics(
      new MemoryDiagnosticDatabase(),
      jest.fn(),
      () => 8_000,
      metadata,
      () => `event-${id++}`,
    );
    await diagnostics.write({ event: 'location_upload_failed', errorCode: 'offline' });
    await diagnostics.write({ event: 'tracking_mode_changed', trackingMode: 'foreground' });

    await expect(diagnostics.summary()).resolves.toEqual({
      total: 2,
      pending: 2,
      lastTimestamp: 8_000,
      byEvent: { location_upload_failed: 1, tracking_mode_changed: 1 },
    });
  });

  it('allowlists navigation conflict release attribution only with consent', async () => {
    const database = new MemoryDiagnosticDatabase();
    const diagnostics = createDiagnostics(
      database,
      jest.fn(),
      () => 1_000,
      metadata,
      () => 'conflict-1',
    );

    await diagnostics.write({
      event: 'navigation_terminal_conflict',
      source: 'cancel',
      navigationSessionId: '11111111-1111-4111-8111-111111111111',
      expectedVersion: 1,
      updateId: 'eas-update-1',
      runtimeVersion: '56.0.0',
      appVersion: '0.1.3',
    });
    expect(database.records.get('conflict-1')?.payload).toEqual({
      source: 'cancel',
      expectedVersion: 1,
      updateId: 'eas-update-1',
      runtimeVersion: '56.0.0',
      appVersion: '0.1.3',
    });

    consentEnabled.value = false;
    await diagnostics.write({ event: 'navigation_terminal_conflict' });
    expect(database.records.size).toBe(1);
  });
});
