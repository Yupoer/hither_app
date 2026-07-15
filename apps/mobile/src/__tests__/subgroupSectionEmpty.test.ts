/**
 * Empty-team filter contract used by SubgroupSection / MapScreen:
 * after leave, subgroups with zero members must not be rendered.
 */
describe('occupied subgroup filter', () => {
  function occupiedSubgroups(
    subgroups: { id: string; name: string }[],
    flock: { subgroupId?: string }[],
  ) {
    return subgroups.filter((sg) => flock.some((f) => f.subgroupId === sg.id));
  }

  it('drops a leftover empty team so "0 人" cannot render', () => {
    const subgroups = [
      { id: 'sg-empty', name: '我的小隊' },
      { id: 'sg-live', name: '還在的小隊' },
    ];
    const flock = [
      { subgroupId: undefined },
      { subgroupId: 'sg-live' },
    ];
    expect(occupiedSubgroups(subgroups, flock).map((s) => s.id)).toEqual(['sg-live']);
  });

  it('returns nothing when every team is empty after leave', () => {
    const subgroups = [{ id: 'sg-gone', name: '已離開' }];
    const flock = [{ subgroupId: undefined }, { subgroupId: undefined }];
    expect(occupiedSubgroups(subgroups, flock)).toEqual([]);
  });
});
