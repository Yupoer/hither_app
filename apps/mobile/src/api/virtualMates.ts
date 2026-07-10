import type { Coordinates, MemberLocation } from '../types';

/**
 * Dev-only virtual teammates for REAL groups, so a solo developer sees a
 * flock on the map. Client-side display data only — these ids don't exist in
 * auth.users, so they must never reach a Supabase write (the split picker
 * skips them via {@link isVirtualMember}).
 *
 * ponytail: always on under __DEV__, fixed offsets around the first located
 * member, no movement simulation — add a settings toggle / random walk when
 * actually needed.
 */
const VIRTUAL_PREFIX = 'virtual-';

export function isVirtualMember(userId: string): boolean {
  return userId.startsWith(VIRTUAL_PREFIX);
}

const MATES = [
  { userId: `${VIRTUAL_PREFIX}1`, name: '小羊', avatar: '🐑', dLat: 0.0021, dLng: 0.0014 },
  { userId: `${VIRTUAL_PREFIX}2`, name: '阿福', avatar: '🦊', dLat: -0.0017, dLng: 0.0026 },
  { userId: `${VIRTUAL_PREFIX}3`, name: '奇奇', avatar: '🐰', dLat: 0.0009, dLng: -0.0022 },
] as const;

// Spawn anchor per group: the first real coordinate seen in that group this
// app session, so the fake flock appears around wherever the tester is.
const anchors = new Map<string, Coordinates>();

// Which subgroup each virtual mate has been "invited" into (mock invite flow —
// virtual mates always accept). userId → subgroupId. Session-lived.
const virtualSubgroups = new Map<string, string>();

/** Mock-accept an invite: pull a virtual mate into the given subgroup. */
export function assignVirtualToSubgroup(userId: string, subgroupId: string): void {
  virtualSubgroups.set(userId, subgroupId);
}

/** Virtual members around `anchor`; [] until a first real coordinate exists. */
export function virtualMates(
  groupId: string,
  anchor: Coordinates | undefined,
): MemberLocation[] {
  let base = anchors.get(groupId);
  if (!base) {
    if (!anchor) return [];
    base = anchor;
    anchors.set(groupId, base);
  }
  return MATES.map((m) => ({
    userId: m.userId,
    name: m.name,
    role: 'follower' as const,
    avatar: m.avatar,
    subgroupId: virtualSubgroups.get(m.userId),
    coordinates: {
      latitude: base.latitude + m.dLat,
      longitude: base.longitude + m.dLng,
    },
  }));
}
