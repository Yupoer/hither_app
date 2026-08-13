import {
  assessLocationRefreshResponses,
  normalizeLocationRefreshRecipientIds,
  waitForLocationRefreshResponses,
} from '../utils/locationRefreshResponse';

const baseline = new Map([
  ['self', '2026-08-13T00:00:00.000Z'],
  ['a', '2026-08-13T00:00:01.000Z'],
  ['b', null],
]);

describe('location refresh response classification', () => {
  it('classifies all responders from newer real timestamps', () => {
    const members = [
      { userId: 'self', status: 'active', lastUpdated: '2026-08-13T00:00:02.000Z' },
      { userId: 'a', status: 'active', lastUpdated: '2026-08-13T00:00:04.000Z' },
      { userId: 'b', status: 'active', lastUpdated: '2026-08-13T00:00:03.000Z' },
    ];
    expect(assessLocationRefreshResponses({
      members,
      expectedUserIds: ['a', 'b'],
      baselineLastUpdated: baseline,
      requestedAtMs: Date.parse('2026-08-13T00:00:02.000Z'),
    })).toMatchObject({ status: 'all', respondedUserIds: ['a', 'b'] });
  });

  it('counts only the expiry-aware recipient ids returned by the request RPC', () => {
    const members = [
      { userId: 'active', status: 'active', lastUpdated: '2026-08-13T00:00:04.000Z' },
      { userId: 'expired-anonymous', status: 'active', lastUpdated: null },
    ];
    const expectedUserIds = normalizeLocationRefreshRecipientIds(['active']);
    expect(assessLocationRefreshResponses({
      members,
      expectedUserIds,
      baselineLastUpdated: new Map([['active', null]]),
      requestedAtMs: Date.parse('2026-08-13T00:00:02.000Z'),
    })).toMatchObject({
      status: 'all',
      expectedUserIds: ['active'],
      respondedUserIds: ['active'],
    });
  });

  it('classifies partial responses without inventing timestamps', () => {
    const result = assessLocationRefreshResponses({
      members: [
        { userId: 'a', status: 'active', lastUpdated: '2026-08-13T00:00:04.000Z' },
        { userId: 'b', status: 'active', lastUpdated: null },
      ],
      expectedUserIds: ['a', 'b'],
      baselineLastUpdated: baseline,
      requestedAtMs: Date.parse('2026-08-13T00:00:02.000Z'),
    });
    expect(result).toMatchObject({ status: 'partial', respondedUserIds: ['a'] });
  });

  it('waits at most eight seconds and reports no response', async () => {
    let clock = 0;
    const result = await waitForLocationRefreshResponses({
      getMembers: () => [
        { userId: 'a', status: 'active', lastUpdated: '2026-08-12T23:00:00.000Z' },
      ],
      expectedUserIds: ['a'],
      baselineLastUpdated: new Map([['a', '2026-08-12T23:00:00.000Z']]),
      requestedAtMs: 0,
      pollIntervalMs: 2_000,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    expect(clock).toBe(8_000);
    expect(result).toMatchObject({ status: 'none', expectedUserIds: ['a'], respondedUserIds: [] });
  });
});
