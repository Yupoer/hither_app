import {
  createGroup,
  joinGroup,
  getGroupState,
  updateNextDestination,
} from '../api/client';

describe('api client stubs', () => {
  it('createGroup returns a group with the given name and an invite code', async () => {
    const group = await createGroup('週末出遊');
    expect(group.name).toBe('週末出遊');
    expect(group.inviteCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(group.id).toBeTruthy();
  });

  it('joinGroup echoes the (upper-cased) invite code', async () => {
    const group = await joinGroup('abc234');
    expect(group.inviteCode).toBe('ABC234');
  });

  it('getGroupState returns group, members and destinations', async () => {
    const state = await getGroupState('grp_1');
    expect(state.group.id).toBe('grp_1');
    expect(state.members.length).toBeGreaterThan(0);
    expect(state.destinations.length).toBeGreaterThan(0);
    expect(state.members.some((m) => m.role === 'leader')).toBe(true);
  });

  it('updateNextDestination sets nextDestination to the chosen id', async () => {
    const state = await updateNextDestination('grp_1', 'dest_2');
    expect(state.nextDestination?.id).toBe('dest_2');
  });
});
