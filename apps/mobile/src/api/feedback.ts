import { supabase } from './supabase';

export async function submitFeedback(category: string, description: string): Promise<void> {
  const { error } = await supabase.rpc('submit_feedback', {
    p_context_tag: category, p_description: description.trim(),
  });
  if (error) throw error;
}
