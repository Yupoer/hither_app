jest.mock('../api/supabase', () => ({
  supabase: {
    getLocalAuthActorId: jest.fn(),
    auth: { getSession: jest.fn() },
  },
}));

import { requireLocalActorId } from '../api/services/_helpers';
import { supabase } from '../api/supabase';

const mockedSupabase = supabase as unknown as {
  getLocalAuthActorId: jest.Mock;
  auth: { getSession: jest.Mock };
};

beforeEach(() => {
  jest.clearAllMocks();
});

it('reads the local actor without touching network session recovery', async () => {
  mockedSupabase.getLocalAuthActorId.mockResolvedValue('actor-a');

  await expect(requireLocalActorId()).resolves.toBe('actor-a');
  expect(mockedSupabase.auth.getSession).not.toHaveBeenCalled();
});

it('fails closed when no persisted actor exists and never reuses another actor', async () => {
  mockedSupabase.getLocalAuthActorId
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce('actor-b');

  await expect(requireLocalActorId()).rejects.toMatchObject({
    code: 'local_auth_actor_missing',
  });
  await expect(requireLocalActorId()).resolves.toBe('actor-b');
  expect(mockedSupabase.auth.getSession).not.toHaveBeenCalled();
});

it('propagates local storage failures instead of selecting a fallback actor', async () => {
  const failure = new Error('storage denied');
  mockedSupabase.getLocalAuthActorId.mockRejectedValue(failure);

  await expect(requireLocalActorId()).rejects.toBe(failure);
  expect(mockedSupabase.auth.getSession).not.toHaveBeenCalled();
});
