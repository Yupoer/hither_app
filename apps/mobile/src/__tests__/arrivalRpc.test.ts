jest.mock('../api/supabase', () => ({ supabase: {
  auth: { getSession: jest.fn() }, rpc: jest.fn(), from: jest.fn(),
} }));
import { supabase } from '../api/supabase';
import { applyCoreOperation } from '../api/services/CoreDataService';
import type { CoreOperation } from '../types/coreData';

const op: CoreOperation = { id: 'op', groupId: 'g', entityId: 'd', entityType: 'itinerary', entityVersion: 0,
  operationType: 'record_arrival', payload: { actorId: 'self', userId: 'self', completeSolo: true, arrivedAt: '2026-09-12T00:00:00Z' },
  status: 'pending', attempts: 0, nextAttemptAt: 0, conflictResult: null, createdAt: 0, updatedAt: 0 };
beforeEach(() => { jest.resetAllMocks(); });
it('does not call protected RPCs without an authenticated session or for another account', async () => {
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: null } });
  expect((await applyCoreOperation(op)).status).toBe('conflict');
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: { user: { id: 'other' } } } });
  expect((await applyCoreOperation(op)).status).toBe('conflict');
  expect(supabase.rpc).not.toHaveBeenCalled();
});
it('permission rejection makes one call and never attempts completion', async () => {
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: { user: { id: 'self' } } } });
  (supabase.rpc as jest.Mock).mockResolvedValue({ error: { code: '42501', message: 'permission denied' } });
  expect((await applyCoreOperation(op)).status).toBe('conflict');
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
  expect(supabase.from).not.toHaveBeenCalled();
});
it('confirms transactional server completion without calling complete a second time', async () => {
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: { user: { id: 'self' } } } });
  (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });
  const query = { select: jest.fn(), eq: jest.fn(), single: jest.fn().mockResolvedValue({ data: { closed_at: 'now' }, error: null }) };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  (supabase.from as jest.Mock).mockReturnValue(query);
  expect(await applyCoreOperation(op)).toMatchObject({ status: 'accepted', entity: { completeSolo: true } });
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
});
