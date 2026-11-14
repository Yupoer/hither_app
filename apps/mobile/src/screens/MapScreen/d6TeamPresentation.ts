import type { Subgroup } from '../../types';
import type { PresenceMacroKind } from '../../utils/presenceMacros';

const D6_SUBGROUP_COLORS = ['#4FD1C5', '#B794F4', '#F687B3'];

export const D6_MEMBER_STATUS_COLORS = {
  follow: '#34C759',
  solo: '#FFD60A',
  stealth: '#8E8E93',
};

export type D6MemberStatus = keyof typeof D6_MEMBER_STATUS_COLORS;

export function getD6MemberStatus(kind: PresenceMacroKind, sharingEnabled: boolean): D6MemberStatus {
  if (!sharingEnabled) return 'stealth';
  return kind === 'solo' ? 'solo' : 'follow';
}

export function getD6SubgroupPresentation<T extends Pick<Subgroup, 'id' | 'createdAt'>>(subgroups: readonly T[]) {
  const ordered = subgroups.map(subgroup => {
    const timestamp = Date.parse(subgroup.createdAt ?? '');
    return { subgroup, createdAt: Number.isFinite(timestamp) ? timestamp : 0 };
  }).sort((left, right) =>
    left.createdAt - right.createdAt || left.subgroup.id.localeCompare(right.subgroup.id)
  );

  return ordered.map(({ subgroup }, index) => ({
    subgroup,
    color: D6_SUBGROUP_COLORS[index % D6_SUBGROUP_COLORS.length],
  }));
}
