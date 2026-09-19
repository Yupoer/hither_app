const mockDb = {
  execAsync: jest.fn(async () => undefined),
  runAsync: jest.fn(async (_sql: string) => undefined),
  getAllAsync: jest.fn(async () => [] as Array<{ name: string }>),
};
const mockOpen = jest.fn(async () => mockDb);
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: () => mockOpen() }));
beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  mockOpen.mockResolvedValue(mockDb);
  mockDb.execAsync.mockResolvedValue(undefined);
  mockDb.getAllAsync.mockResolvedValue([]);
});
it('shares initialization and upgrades only columns absent from the installed schema', async () => {
  mockDb.getAllAsync.mockResolvedValue([{ name: 'actor_id' }, { name: 'sequence' }]);
  const { initializeHitherDatabase, getHitherDatabase } = require('../state/hitherDatabase');
  const [first, second] = await Promise.all([initializeHitherDatabase(), getHitherDatabase()]);
  expect(first).toBe(mockDb);
  expect(second).toBe(mockDb);
  expect(mockOpen).toHaveBeenCalledTimes(1);
  expect(mockDb.runAsync.mock.calls.map(call => call[0])).toEqual([
    "ALTER TABLE core_operation_outbox ADD COLUMN dependency_ids TEXT NOT NULL DEFAULT '[]'",
    'ALTER TABLE core_operation_outbox ADD COLUMN inflight_started_at INTEGER',
    'ALTER TABLE core_operation_outbox ADD COLUMN last_error TEXT',
  ]);
});
it('retries failed storage initialization instead of caching a rejected promise', async () => {
  mockDb.execAsync.mockRejectedValueOnce(new Error('SQLite disk full'));
  const { initializeHitherDatabase } = require('../state/hitherDatabase');
  await expect(initializeHitherDatabase()).rejects.toThrow('SQLite disk full');
  await expect(initializeHitherDatabase()).resolves.toBe(mockDb);
  expect(mockOpen).toHaveBeenCalledTimes(2);
});
it('does not attempt duplicate columns for an already-upgraded install', async () => {
  mockDb.getAllAsync.mockResolvedValue(['actor_id', 'sequence', 'dependency_ids', 'inflight_started_at', 'last_error'].map(name => ({ name })));
  const { getHitherDatabase } = require('../state/hitherDatabase');
  await getHitherDatabase();
  expect(mockDb.runAsync).not.toHaveBeenCalled();
});
