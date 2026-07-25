const mockStorage = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStorage.set(key, value);
  }),
}));

describe('exceptionHandlingStore', () => {
  beforeEach(() => {
    jest.resetModules();
    mockStorage.clear();
  });

  it('hydrates empty map and persists acknowledge/resolve', async () => {
    const store = await import('../state/exceptionHandlingStore');
    store.__resetExceptionHandlingStoreForTests();

    const loaded = await store.loadExceptionHandling('g1');
    expect(loaded).toEqual({});

    const afterAck = await store.applyExceptionHandlingAction(
      'g1',
      'nav:s|a|needs_help',
      'acknowledge',
      '2026-07-25T12:00:00.000Z',
    );
    expect(afterAck['nav:s|a|needs_help'].status).toBe('acknowledged');

    const afterResolve = await store.applyExceptionHandlingAction(
      'g1',
      'nav:s|a|needs_help',
      'resolve',
      '2026-07-25T12:01:00.000Z',
    );
    expect(afterResolve['nav:s|a|needs_help'].status).toBe('resolved');

    // Survives “refresh” (new module import after cache clear, same storage).
    store.__resetExceptionHandlingStoreForTests();
    const reloaded = await store.loadExceptionHandling('g1');
    expect(reloaded['nav:s|a|needs_help'].status).toBe('resolved');
  });

  it('serializes concurrent writes so both keys survive', async () => {
    const store = await import('../state/exceptionHandlingStore');
    store.__resetExceptionHandlingStoreForTests();

    await store.loadExceptionHandling('g1');
    const [a, b] = await Promise.all([
      store.applyExceptionHandlingAction(
        'g1',
        'nav:s|a|needs_help',
        'acknowledge',
        '2026-07-25T12:00:00.000Z',
      ),
      store.applyExceptionHandlingAction(
        'g1',
        'nav:s|b|offline',
        'resolve',
        '2026-07-25T12:00:01.000Z',
      ),
    ]);
    // Last returned map includes both (serialized apply).
    expect(a['nav:s|a|needs_help'] || b['nav:s|a|needs_help']).toBeTruthy();
    expect(a['nav:s|b|offline'] || b['nav:s|b|offline']).toBeTruthy();
    const final = store.getCachedExceptionHandling('g1');
    expect(final['nav:s|a|needs_help'].status).toBe('acknowledged');
    expect(final['nav:s|b|offline'].status).toBe('resolved');
  });

  it('does not wipe recent handling when session key flips nav→dest for same stop', async () => {
    const store = await import('../state/exceptionHandlingStore');
    store.__resetExceptionHandlingStoreForTests();

    await store.applyExceptionHandlingAction(
      'g1',
      'nav:sess-1|a|needs_help',
      'resolve',
      '2026-07-25T12:00:00.000Z',
    );
    await store.applyExceptionHandlingAction(
      'g1',
      'dest:d1|b|late',
      'acknowledge',
      '2026-07-25T12:00:00.000Z',
    );

    const pruned = await store.pruneExceptionHandlingForSession(
      'g1',
      'dest:d1',
      { destinationId: 'd1', nowMs: Date.parse('2026-07-25T12:00:00.000Z') },
    );
    // nav: keys retained so end-navigation does not erase episode handling.
    expect(pruned['nav:sess-1|a|needs_help']?.status).toBe('resolved');
    expect(pruned['dest:d1|b|late']?.status).toBe('acknowledged');
  });

  it('drops resolved entries older than TTL and other dest keys', async () => {
    const store = await import('../state/exceptionHandlingStore');
    store.__resetExceptionHandlingStoreForTests();

    const now = Date.parse('2026-07-25T12:00:00.000Z');
    const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(now - 60_000).toISOString();

    await store.applyExceptionHandlingAction(
      'g1',
      'nav:old|a|needs_help',
      'resolve',
      eightDaysAgo,
    );
    await store.applyExceptionHandlingAction(
      'g1',
      'nav:recent|b|offline',
      'resolve',
      recent,
    );
    await store.applyExceptionHandlingAction(
      'g1',
      'dest:other|c|late',
      'acknowledge',
      recent,
    );
    await store.applyExceptionHandlingAction(
      'g1',
      'dest:d1|d|late',
      'open' as never,
      recent,
    );
    // force open status via save
    await store.saveExceptionHandling('g1', {
      ...store.getCachedExceptionHandling('g1'),
      'dest:d1|d|late': { status: 'open', updatedAt: recent },
    });

    const pruned = await store.pruneExceptionHandlingForSession('g1', 'dest:d1', {
      destinationId: 'd1',
      nowMs: now,
    });
    expect(pruned['nav:old|a|needs_help']).toBeUndefined();
    expect(pruned['nav:recent|b|offline']?.status).toBe('resolved');
    expect(pruned['dest:other|c|late']).toBeUndefined();
    expect(pruned['dest:d1|d|late']?.status).toBe('open');
  });

  it('rejects corrupt storage payloads', async () => {
    const store = await import('../state/exceptionHandlingStore');
    store.__resetExceptionHandlingStoreForTests();
    mockStorage.set(store.exceptionHandlingStorageKey('g1'), '{"x":1}');
    await expect(store.loadExceptionHandling('g1')).resolves.toEqual({});
  });
});
