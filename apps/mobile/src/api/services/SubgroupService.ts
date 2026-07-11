/**
 * SubgroupService — subgroup invites (send, accept, decline, fetch).
 */
import { supabase } from '../supabase';
import { demoInviteToSubgroup, isDemoGroup } from '../demo';
import type { PendingInvite } from '../../types';
import { orThrow } from './_helpers';
import { mapSubgroupInvite, type SubgroupInviteRow } from './GroupService';

export async function inviteToSubgroup(
  subgroupId: string,
  inviteeId: string,
): Promise<void> {
  if (subgroupId.startsWith('demo-sg-')) {
    demoInviteToSubgroup(subgroupId, inviteeId);
    return;
  }
  const { error } = await supabase.rpc('invite_to_subgroup', {
    p_subgroup: subgroupId,
    p_invitee: inviteeId,
  });
  orThrow(error);
}

export async function acceptSubgroupInvite(inviteId: string): Promise<void> {
  const { error } = await supabase.rpc('accept_subgroup_invite', {
    p_invite: inviteId,
  });
  orThrow(error);
}

export async function declineSubgroupInvite(inviteId: string): Promise<void> {
  const { error } = await supabase.rpc('decline_subgroup_invite', {
    p_invite: inviteId,
  });
  orThrow(error);
}

export async function fetchMyInvites(userId: string): Promise<PendingInvite[]> {
  const { data, error } = await supabase
    .from('subgroup_invites')
    .select('id, group_id, subgroup_id, inviter_id, invitee_id, status, created_at')
    .eq('invitee_id', userId)
    .eq('status', 'pending');
  orThrow(error);

  const invites = ((data ?? []) as SubgroupInviteRow[]).map(mapSubgroupInvite);
  if (invites.length === 0) return [];

  const subgroupIds = [...new Set(invites.map((i) => i.subgroupId))];
  const inviterIds = [...new Set(invites.map((i) => i.inviterId))];

  const [sgRes, profRes] = await Promise.all([
    supabase.from('subgroups').select('id, name').in('id', subgroupIds),
    supabase.from('profiles').select('id, nickname').in('id', inviterIds),
  ]);
  orThrow(sgRes.error);
  orThrow(profRes.error);

  const nameBySubgroup = new Map(
    ((sgRes.data ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]),
  );
  const nameByInviter = new Map(
    ((profRes.data ?? []) as { id: string; nickname: string }[]).map((p) => [p.id, p.nickname]),
  );

  return invites.map((i) => ({
    ...i,
    subgroupName: nameBySubgroup.get(i.subgroupId) ?? '',
    inviterName: nameByInviter.get(i.inviterId) ?? '',
  }));
}

export async function fetchSentInvites(
  subgroupId: string,
): Promise<{ id: string; inviteeName: string }[]> {
  const { data, error } = await supabase
    .from('subgroup_invites')
    .select('id, invitee_id')
    .eq('subgroup_id', subgroupId)
    .eq('status', 'pending');
  orThrow(error);

  const rows = (data ?? []) as { id: string; invitee_id: string }[];
  if (rows.length === 0) return [];

  const { data: profiles, error: profError } = await supabase
    .from('profiles')
    .select('id, nickname')
    .in(
      'id',
      rows.map((r) => r.invitee_id),
    );
  orThrow(profError);
  const nameById = new Map(
    ((profiles ?? []) as { id: string; nickname: string }[]).map((p) => [p.id, p.nickname]),
  );
  return rows.map((r) => ({ id: r.id, inviteeName: nameById.get(r.invitee_id) ?? '' }));
}
