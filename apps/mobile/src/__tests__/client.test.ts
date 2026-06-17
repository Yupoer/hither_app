// Mock the supabase singleton so importing the client does not pull in
// react-native-url-polyfill / AsyncStorage (native-only) or require env vars.
jest.mock('../api/supabase', () => ({
  supabase: { from: jest.fn(), auth: { getUser: jest.fn() } },
}));

import {
  createGroup,
  joinGroup,
  generateInviteCode,
  mapGroup,
  mapDestination,
  mapMember,
} from '../api/client';
import { supabase } from '../api/supabase';

const mockedAuth = supabase.auth as unknown as { getUser: jest.Mock };
const mockedFrom = supabase.from as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('pure mappers (snake_case row -> camelCase type)', () => {
  it('generateInviteCode: 6 chars from the schema set', () => {
    for (let i = 0; i < 25; i++) {
      expect(generateInviteCode()).toMatch(
        /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/,
      );
    }
  });

  it('mapGroup converts invite_code/created_by/created_at', () => {
    expect(
      mapGroup({
        id: 'g1',
        name: '週末出遊',
        invite_code: 'ABC234',
        created_by: 'u1',
        created_at: '2026-01-01T00:00:00Z',
      }),
    ).toEqual({
      id: 'g1',
      name: '週末出遊',
      inviteCode: 'ABC234',
      createdBy: 'u1',
      createdAt: '2026-01-01T00:00:00Z',
    });
  });

  it('mapDestination maps position->order and lat/lng->coordinates', () => {
    const d = mapDestination({
      id: 'd1',
      title: '集合點',
      description: null,
      address: null,
      latitude: 25.04,
      longitude: 121.56,
      position: 0,
    });
    expect(d.order).toBe(0);
    expect(d.title).toBe('集合點');
    expect(d.coordinates).toEqual({ latitude: 25.04, longitude: 121.56 });
  });

  it('mapMember combines membership + profile nickname + location', () => {
    expect(
      mapMember(
        { user_id: 'u1', role: 'leader', status: 'active' },
        { id: 'u1', nickname: '隊長小燈籠' },
        { user_id: 'u1', latitude: 25, longitude: 121, updated_at: 't0' },
      ),
    ).toEqual({
      userId: 'u1',
      name: '隊長小燈籠',
      role: 'leader',
      status: 'active',
      coordinates: { latitude: 25, longitude: 121 },
      lastUpdated: 't0',
    });
  });

  it('mapMember without a location row yields no coordinates', () => {
    const m = mapMember(
      { user_id: 'u2', role: 'follower', status: 'idle' },
      undefined,
      undefined,
    );
    expect(m.coordinates).toBeUndefined();
    expect(m.name).toBe('');
  });
});

describe('createGroup', () => {
  it('inserts a group as leader and returns the mapped group', async () => {
    mockedAuth.getUser.mockResolvedValue({
      data: { user: { id: 'uid' } },
      error: null,
    });
    const single = jest.fn().mockResolvedValue({
      data: {
        id: 'g1',
        name: '週末出遊',
        invite_code: 'ABC234',
        created_by: 'uid',
        created_at: 't0',
      },
      error: null,
    });
    const membershipInsert = jest.fn().mockResolvedValue({ error: null });
    mockedFrom.mockImplementation((table: string) =>
      table === 'groups'
        ? { insert: () => ({ select: () => ({ single }) }) }
        : { insert: membershipInsert },
    );

    const group = await createGroup('週末出遊');
    expect(group.name).toBe('週末出遊');
    expect(group.inviteCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(membershipInsert).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'leader', user_id: 'uid' }),
    );
  });
});

describe('joinGroup', () => {
  it('throws when the invite code matches no group', async () => {
    mockedAuth.getUser.mockResolvedValue({
      data: { user: { id: 'uid' } },
      error: null,
    });
    const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
    mockedFrom.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle }) }),
    });

    await expect(joinGroup('zzz999')).rejects.toThrow('找不到這個群組');
  });

  it('upper-cases the code and joins as follower', async () => {
    mockedAuth.getUser.mockResolvedValue({
      data: { user: { id: 'uid' } },
      error: null,
    });
    const maybeSingle = jest.fn().mockResolvedValue({
      data: {
        id: 'g1',
        name: '團',
        invite_code: 'ABC234',
        created_by: 'leader',
        created_at: 't0',
      },
      error: null,
    });
    const membershipUpsert = jest.fn().mockResolvedValue({ error: null });
    mockedFrom.mockImplementation((table: string) =>
      table === 'groups'
        ? { select: () => ({ eq: () => ({ maybeSingle }) }) }
        : { upsert: membershipUpsert },
    );

    const group = await joinGroup('abc234');
    expect(group.inviteCode).toBe('ABC234');
    expect(membershipUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'follower', user_id: 'uid' }),
      expect.objectContaining({ onConflict: 'group_id,user_id' }),
    );
  });
});
