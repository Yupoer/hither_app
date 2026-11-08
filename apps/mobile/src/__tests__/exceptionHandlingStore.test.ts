const mockStorage = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStorage.set(key, value);
  }),
}));

describe('legacy exception handling', () => {
  beforeEach(() => {
    jest.resetModules();
    mockStorage.clear();
  });

  it('loads handled notices saved before the Members inbox', async () => {
    const store = await import('../state/exceptionHandlingStore');
    const saved = { 'nav:s|a|needs_help': { status: 'acknowledged', updatedAt: '2026-07-25T12:00:00.000Z' } };
    mockStorage.set(store.exceptionHandlingStorageKey('g1'), JSON.stringify(saved));
    await expect(store.loadExceptionHandling('g1')).resolves.toEqual(saved);
    await expect(store.loadExceptionHandling('g2')).resolves.toEqual({});
  });

  it('keeps relevant handled notices when the active session changes', async () => {
    const store = await import('../state/exceptionHandlingStore');
    const now = Date.parse('2026-07-25T12:00:00.000Z');
    const recent = new Date(now - 60_000).toISOString();
    const stale = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();
    const saved = {
      'nav:old|a|needs_help': { status: 'resolved', updatedAt: stale },
      'nav:recent|b|offline': { status: 'resolved', updatedAt: recent },
      'dest:other|c|late': { status: 'acknowledged', updatedAt: recent },
      'dest:d1|d|late': { status: 'acknowledged', updatedAt: recent },
    };
    const key = store.exceptionHandlingStorageKey('g1');
    mockStorage.set(key, JSON.stringify(saved));
    const expected = {
      'nav:recent|b|offline': saved['nav:recent|b|offline'],
      'dest:d1|d|late': saved['dest:d1|d|late'],
    };

    await expect(store.pruneExceptionHandlingForSession('g1', 'dest:d1', {
      destinationId: 'd1', nowMs: now,
    })).resolves.toEqual(expected);
    expect(JSON.parse(mockStorage.get(key)!)).toEqual(expected);
  });

  it('rejects corrupt storage payloads', async () => {
    const store = await import('../state/exceptionHandlingStore');
    mockStorage.set(store.exceptionHandlingStorageKey('g1'), '{"x":1}');
    await expect(store.loadExceptionHandling('g1')).resolves.toEqual({});
  });
});
