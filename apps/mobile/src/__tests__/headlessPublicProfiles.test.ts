const { World } = require('../../test/headless/world.cjs');
const { LEADER, PEER, GROUP_ID } = require('../../test/headless/backend.cjs');

describe.each(['ios', 'android'])('headless public profile contract on %s', platform => {
  jest.setTimeout(90000);

  it('converges teammate identity on safe profile events and ignores private-only writes', async () => {
    const world = new World();
    try {
      Object.assign(world.backend.profiles.get(LEADER), { preferences: { secret: 'private-owner' }, onboarding: { secret: true }, pro: true });
      const leader = await world.device({ id: 'leader', userId: LEADER, platform, screen: { name: 'ProfileOverlay' } });
      const peer = await world.device({ id: 'peer', userId: PEER, platform });
      await world.waitFor(leader, (value: any) => value.presentation?.session.user?.name === 'Leader', 'own profile hydration');
      await peer.perform('group.observe', { groupId: GROUP_ID });
      await world.waitFor(peer, (value: any) => value.group.state?.members.find((member: any) => member.userId === LEADER)?.name === 'Leader', 'teammate identity hydration');
      const reads = () => world.backend.trace.filter((call: any) => call.deviceId === 'peer' && call.name === 'get_group_public_recovery_snapshot').length;
      const before = reads();
      const recoveryReads = world.backend.trace.filter((call: any) => call.deviceId === 'peer' && call.name === 'get_group_public_recovery_snapshot');
      expect(recoveryReads.length).toBeGreaterThan(0);
      for (const call of recoveryReads) {
        expect(call.result.data.profiles).toHaveLength(2);
        for (const profile of call.result.data.profiles) expect(Object.keys(profile).sort()).toEqual(['avatar', 'avatar_color', 'id', 'nickname']);
      }
      expect(world.backend.trace.filter((call: any) => call.name === 'get_group_recovery_snapshot')).toEqual([]);
      await leader.perform('preferences.setLanguage', { args: ['en'] });
      await world.advance(300);
      expect(reads()).toBe(before);
      expect(world.realtimeTrace.filter((item: any) => item.event.table === 'public_profiles')).toEqual([]);
      await leader.perform('profile.nickname', { args: ['Updated public name'] });
      await world.settle();
      await world.advance(300);
      const updated = await world.waitFor(peer, (value: any) => value.group.state?.members.find((member: any) => member.userId === LEADER)?.name === 'Updated public name', 'safe event reload');
      expect(updated.group.state.members.find((member: any) => member.userId === LEADER).name).toBe('Updated public name');
      expect(reads()).toBe(before + 1);
      const publicEvents = world.realtimeTrace.filter((item: any) => item.deviceId === 'peer' && item.event.table === 'public_profiles');
      expect(publicEvents).toHaveLength(1);
      expect(Object.keys(publicEvents[0].event.new).sort()).toEqual(['avatar', 'avatar_color', 'id', 'nickname']);
      expect(publicEvents[0].event.old).toEqual({});
      expect(world.backend.profiles.get(LEADER).onboarding).toEqual({ secret: true });
      expect(world.backend.trace.filter((call: any) => call.deviceId === 'peer' && call.kind === 'table' && call.name === 'profiles')).toEqual([]);
    } finally { await world.close(); }
  });

  it('propagates public recovery schema, permission, and network errors without legacy fallback', async () => {
    const world = new World();
    try {
      const peer = await world.device({ id: 'peer', userId: PEER, platform });
      await peer.perform('group.observe', { groupId: GROUP_ID });
      await world.waitFor(peer, (value: any) => value.group.state?.group.id === GROUP_ID, 'initial public recovery');
      for (const error of [
        { code: 'PGRST202', message: 'public recovery missing' },
        { code: '42501', message: 'public recovery denied' },
        { code: 'NETWORK_ERROR', message: 'Network request failed' },
      ]) {
        world.backend.failNext({ kind: 'rpc', name: 'get_group_public_recovery_snapshot', userId: PEER }, error);
        await peer.perform('group.refresh');
        const failed = await peer.observe();
        expect(failed.group.error).toEqual(expect.any(String));
        expect(failed.group.error.length).toBeGreaterThan(0);
        const recoveryCalls = world.backend.trace.filter((call: any) => call.deviceId === 'peer' && call.name === 'get_group_public_recovery_snapshot');
        expect(recoveryCalls[recoveryCalls.length - 1].result.error).toEqual(error);
      }
      expect(world.backend.trace.filter((call: any) => call.name === 'get_group_recovery_snapshot')).toEqual([]);
      expect(world.backend.trace.filter((call: any) => call.kind === 'table' && call.name === 'profiles')).toEqual([]);
    } finally { await world.close(); }
  });

  it('enriches invitation names from the public table and propagates denied reads without legacy fallback', async () => {
    const world = new World();
    try {
      const leader = await world.device({ id: 'leader', userId: LEADER, platform });
      const peer = await world.device({ id: 'peer', userId: PEER, platform });
      const subgroup = await leader.perform('group.selfSplit', { args: [GROUP_ID, 'Lunch'] });
      await leader.perform('subgroup.inviteToSubgroup', { args: [subgroup.id, PEER] });
      expect((await peer.perform('subgroup.fetchMyInvites', { args: [PEER] }))[0]).toMatchObject({ inviterName: 'Leader', subgroupName: 'Lunch' });
      expect(await leader.perform('subgroup.fetchSentInvites', { args: [subgroup.id] })).toEqual([expect.objectContaining({ inviteeName: 'Peer' })]);
      world.backend.failNext({ kind: 'table', name: 'public_profiles', mode: 'select', userId: PEER }, { code: '42501', message: 'identity denied' });
      await expect(peer.perform('subgroup.fetchMyInvites', { args: [PEER] })).rejects.toThrow('identity denied');
      world.backend.failNext({ kind: 'table', name: 'public_profiles', mode: 'select', userId: LEADER }, { code: '42501', message: 'identity denied' });
      await expect(leader.perform('subgroup.fetchSentInvites', { args: [subgroup.id] })).rejects.toThrow('identity denied');
      expect(world.backend.trace.filter((call: any) => call.kind === 'table' && call.name === 'profiles')).toEqual([]);
      expect(world.backend.trace.filter((call: any) => call.name === 'public_profiles')).toHaveLength(4);
    } finally { await world.close(); }
  });
});
