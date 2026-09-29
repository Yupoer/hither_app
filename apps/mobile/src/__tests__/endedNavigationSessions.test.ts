const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true, default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
  },
}));
import { readEndedNavigationSessions, rememberEndedNavigationSession } from '../state/endedNavigationSessions';
it('persists exact session identities and isolates actors and groups across module reload', async () => {
  await Promise.all([rememberEndedNavigationSession('actor-a', 'g', 'old-a'), rememberEndedNavigationSession('actor-a', 'g', 'old-b')]);
  jest.resetModules();
  const reopened = require('../state/endedNavigationSessions') as typeof import('../state/endedNavigationSessions');
  expect(await reopened.readEndedNavigationSessions('actor-a', 'g')).toEqual(new Set(['old-a', 'old-b']));
  expect((await reopened.readEndedNavigationSessions('actor-a', 'g')).has('new-session')).toBe(false);
  expect(await reopened.readEndedNavigationSessions('actor-b', 'g')).toEqual(new Set());
  expect(await readEndedNavigationSessions('actor-a', 'other-group')).toEqual(new Set());
});

it('normalizes legacy session identity across Postgres microseconds and local millisecond projections', () => {
  const { legacyNavigationSessionKey } = require('../state/endedNavigationSessions');
  expect(legacyNavigationSessionKey('2026-09-21T01:02:03.123678+00:00', 'point'))
    .toBe(legacyNavigationSessionKey('2026-09-21T01:02:03.124Z', 'point'));
  expect(legacyNavigationSessionKey('2026-09-21T01:02:03.999678+00:00', 'point'))
    .toBe(legacyNavigationSessionKey('2026-09-21T01:02:04.000Z', 'point'));
});

it('rejects corrupt persisted history instead of treating it as no ended sessions', async () => {
  mockStorage.set('@hither/ended-navigation/actor-a/corrupt', '{}');
  await expect(readEndedNavigationSessions('actor-a', 'corrupt')).rejects.toThrow('Invalid ended navigation history');
});
