/**
 * ProfileService — user profile CRUD (nickname, avatar, onboarding, pro).
 */
import { supabase } from '../supabase';
import { requireUserId, orThrow } from './_helpers';

export async function updateNickname(nickname: string): Promise<string> {
  const uid = await requireUserId();
  const trimmed = nickname.trim();
  if (!trimmed) {
    throw new Error('暱稱不能為空');
  }
  const { error } = await supabase
    .from('profiles')
    .update({ nickname: trimmed })
    .eq('id', uid);
  orThrow(error);
  return trimmed;
}

export async function updateProfile(fields: {
  nickname?: string;
  avatar?: string;
  avatarColor?: string;
}): Promise<void> {
  const patch: { nickname?: string; avatar?: string; avatar_color?: string } = {};
  const nickname = fields.nickname?.trim();
  if (nickname) patch.nickname = nickname;
  if (fields.avatar) patch.avatar = fields.avatar;
  if (fields.avatarColor) patch.avatar_color = fields.avatarColor;
  if (!patch.nickname && !patch.avatar && !patch.avatar_color) return;
  const uid = await requireUserId();
  const { error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', uid);
  orThrow(error);
}

export async function saveOnboardingProfile(answers: object): Promise<void> {
  const uid = await requireUserId();
  const { error } = await supabase
    .from('profiles')
    .update({ onboarding: answers })
    .eq('id', uid);
  if (error) throw new Error(error.message);
}

export async function setProStatus(userId: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ pro: true }).eq('id', userId);
  orThrow(error);
}

export async function redeemPromoCode(code: string): Promise<{ plan_name: string }> {
  const { data, error } = await supabase.rpc('redeem_promo_code', { p_code: code });
  orThrow(error);
  if (!data.success) {
    throw new Error(data.error || '兌換失敗');
  }
  return { plan_name: data.plan_name };
}
