import {
  defaultSupabaseAuthStorageKey,
  readLocalAuthActor,
} from '../api/localAuthActor';

it('mirrors the installed Supabase default storage namespace', () => {
  expect(defaultSupabaseAuthStorageKey('https://project-ref.supabase.co'))
    .toBe('sb-project-ref-auth-token');
});

it('binds an offline draft to a persisted user even when its token expired, without network recovery', async () => {
  const storage = { getItem: jest.fn(async () => JSON.stringify({ access_token: 'expired-test-token',
    expires_at: 1, user: { id: 'actor-a' } })) };
  expect(await readLocalAuthActor(storage, 'session')).toBe('actor-a');
  expect(storage.getItem).toHaveBeenCalledWith('session');
});
it.each([null, '{', '{}', 'null', JSON.stringify({ user: { id: 'a' } })])('does not invent identity for invalid local session %s', async raw => {
  expect(await readLocalAuthActor({ getItem: async () => raw }, 'session')).toBeNull();
});
it('propagates a storage failure instead of silently assigning another actor', async () => {
  await expect(readLocalAuthActor({ getItem: async () => { throw new Error('storage denied'); } }, 'session'))
    .rejects.toThrow('storage denied');
});
