import {
  demoAcceptSubgroupInvite,
  demoDeclineSubgroupInvite,
  demoFetchMyInvites,
  demoInviteToSubgroup,
  demoSelfSplit,
  getDemoState,
} from '../api/demo';

/**
 * The demo flock simulates a second device: inviting a mate raises a pending
 * "wants to join" request that the tester approves, instead of a silent
 * auto-join. These guard that request -> approve actually moves the member in,
 * and that decline drops the request without moving anyone.
 */
describe('demo subgroup invites (request -> approve)', () => {
  function mateNotInTeam(subgroupId: string) {
    return getDemoState().members.find(
      (m) => m.userId.startsWith('demo-user-') && m.subgroupId !== subgroupId,
    )!;
  }

  it('invite raises a pending request, approve moves the mate into the team', () => {
    const sg = demoSelfSplit('我的小隊');
    const mate = mateNotInTeam(sg.id);

    demoInviteToSubgroup(sg.id, mate.userId);
    const pending = demoFetchMyInvites('demo-me');
    const req = pending.find((p) => p.inviterId === mate.userId && p.subgroupId === sg.id);
    expect(req).toBeTruthy();
    expect(req!.kind).toBe('request');

    demoAcceptSubgroupInvite(req!.id);
    const moved = getDemoState().members.find((m) => m.userId === mate.userId);
    expect(moved!.subgroupId).toBe(sg.id);
    // request cleared after approval
    expect(demoFetchMyInvites('demo-me').some((p) => p.id === req!.id)).toBe(false);
  });

  it('decline drops the request and moves no one', () => {
    const sg = demoSelfSplit('小隊二');
    const mate = mateNotInTeam(sg.id);

    demoInviteToSubgroup(sg.id, mate.userId);
    const req = demoFetchMyInvites('demo-me').find(
      (p) => p.inviterId === mate.userId && p.subgroupId === sg.id,
    )!;

    demoDeclineSubgroupInvite(req.id);
    expect(demoFetchMyInvites('demo-me').some((p) => p.id === req.id)).toBe(false);
    const still = getDemoState().members.find((m) => m.userId === mate.userId);
    expect(still!.subgroupId).not.toBe(sg.id);
  });
});
