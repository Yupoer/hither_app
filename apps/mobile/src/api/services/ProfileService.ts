/**
 * ProfileService — user profile CRUD (nickname, avatar, onboarding, pro).
 */
import { supabase } from '../supabase';
import { requireUserId, orThrow } from './_helpers';
import type { AccountPreferences } from '../../types';

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
  preferences?: AccountPreferences;
}): Promise<void> {
  const patch: {
    nickname?: string;
    avatar?: string;
    avatar_color?: string;
    preferences?: AccountPreferences;
  } = {};
  const nickname = fields.nickname?.trim();
  if (nickname) patch.nickname = nickname;
  if (fields.avatar) patch.avatar = fields.avatar;
  if (fields.avatarColor) patch.avatar_color = fields.avatarColor;
  // BUG-23: always write preferences when provided (including nested quickCommand).
  // Use a plain JSON object so PostgREST never rejects a class instance.
  if (fields.preferences) {
    patch.preferences = JSON.parse(JSON.stringify(fields.preferences)) as AccountPreferences;
  }
  if (!patch.nickname && !patch.avatar && !patch.avatar_color && !patch.preferences) return;
  const uid = await requireUserId();
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', uid)
    .select('id')
    .maybeSingle();
  orThrow(error);
  // No row updated usually means the profile row is missing — create it so
  // custom quick-command / avatar writes still succeed after auth edge cases.
  if (!data) {
    const { error: insertError } = await supabase.from('profiles').upsert(
      { id: uid, nickname: nickname || '旅人', ...patch },
      { onConflict: 'id' },
    );
    orThrow(insertError);
  }
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
