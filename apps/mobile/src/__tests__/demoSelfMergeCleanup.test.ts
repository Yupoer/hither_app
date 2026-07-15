import {
  demoAcceptSubgroupInvite,
  demoAddDestination,
  demoFetchMyInvites,
  demoInviteToSubgroup,
  demoSelfMerge,
  demoSelfSplit,
  getDemoState,
} from '../api/demo';

/**
 * Leaving a 小隊 as the last member must wipe the empty team card and its
 * itinerary — otherwise the members sheet keeps a "0 人" block and orphan stops.
 */
describe('demoSelfMerge empty-team cleanup', () => {
  it('removes the empty subgroup after the last member leaves', () => {
    // Ensure me is on main before splitting (prior tests may have left me elsewhere).
    if (getDemoState().members[0].subgroupId) demoSelfMerge();
    const sg = demoSelfSplit('清理測試小隊');
    expect(getDemoState().subgroups.some((s) => s.id === sg.id)).toBe(true);
    expect(getDemoState().members[0].subgroupId).toBe(sg.id);

    demoSelfMerge();

    const state = getDemoState();
    expect(state.members[0].subgroupId).toBeUndefined();
    expect(state.subgroups.some((s) => s.id === sg.id)).toBe(false);
  });

  it('drops subgroup-scoped destinations when the empty team is deleted', () => {
    if (getDemoState().members[0].subgroupId) demoSelfMerge();
    const sg = demoSelfSplit('有地點的小隊');
    demoAddDestination({
      title: '小隊集合點',
      coordinates: { latitude: 25.04, longitude: 121.52 },
      subgroupId: sg.id,
    });
    demoAddDestination({
      title: '主隊集合點',
      coordinates: { latitude: 25.05, longitude: 121.53 },
    });

    expect(
      getDemoState().destinations.some(
        (d) => d.title === '小隊集合點' && d.subgroupId === sg.id,
      ),
    ).toBe(true);

    demoSelfMerge();

    const state = getDemoState();
    expect(state.subgroups.some((s) => s.id === sg.id)).toBe(false);
    expect(state.destinations.some((d) => d.subgroupId === sg.id)).toBe(false);
    expect(state.destinations.some((d) => d.title === '主隊集合點')).toBe(true);
  });

  it('keeps the subgroup when another member is still in it', () => {
    if (getDemoState().members[0].subgroupId) demoSelfMerge();
    // Pull mate back to main if a prior multi-member test parked them.
    const mateId = 'demo-user-2';
    const sg = demoSelfSplit('還有隊友');
    demoInviteToSubgroup(sg.id, mateId);
    const req = demoFetchMyInvites('demo-me').find((p) => p.subgroupId === sg.id)!;
    demoAcceptSubgroupInvite(req.id);
    expect(getDemoState().members.find((m) => m.userId === mateId)!.subgroupId).toBe(sg.id);

    demoSelfMerge();

    const state = getDemoState();
    expect(state.members[0].subgroupId).toBeUndefined();
    expect(state.subgroups.some((s) => s.id === sg.id)).toBe(true);
    expect(state.members.find((m) => m.userId === mateId)!.subgroupId).toBe(sg.id);
  });
});
