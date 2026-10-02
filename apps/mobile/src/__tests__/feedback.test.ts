jest.mock('../api/supabase', () => ({ supabase: { rpc: jest.fn() } }));
import { supabase } from '../api/supabase';
import { submitFeedback } from '../api/feedback';

it('submits only category and trimmed text through bounded feedback RPC', async () => {
  (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });
  await submitFeedback('bug', ' Report ');
  expect(supabase.rpc).toHaveBeenCalledWith('submit_feedback', { p_context_tag: 'bug', p_description: 'Report' });
});

it('propagates server rejection instead of claiming feedback was sent', async () => {
  (supabase.rpc as jest.Mock).mockResolvedValue({ error: new Error('quota') });
  await expect(submitFeedback('bug', 'Report')).rejects.toThrow('quota');
});
