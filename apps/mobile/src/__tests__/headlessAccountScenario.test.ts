const { World } = require('../../test/headless/world.cjs');
const { LEADER, PEER, GROUP_ID, DESTINATION } = require('../../test/headless/backend.cjs');

describe.each(['ios', 'android'])('headless account operations on %s', platform => {
  jest.setTimeout(90000);

  async function screen(world: any, name = 'Onboarding', id = 'account') {
    const device = await world.device({ id, userId: LEADER, platform, screen: { name } });
    await world.waitFor(device, (value: any) => value.presentation?.preferences.ready && !value.presentation.session.initializing, 'real providers hydrated');
    return device;
  }

  const control = (value: any, id: string) => value.presentation.hosts.find((host: any) => host.testId === id && host.value !== undefined);

  it('cancels a profile draft, writes only changed profile fields and saves one custom command', async () => {
    const world = new World();
    try {
      const device = await screen(world, 'ProfileOverlay');
      await world.waitFor(device, (value: any) => value.presentation.session.user?.name === 'Leader', 'profile enrichment before editing');
      await device.perform('preferences.setLanguage', { args: ['en'] });
      await device.perform('profile.name', { value: 'Discard me' });
      await device.perform('profile.cancel');
      expect(world.backend.profiles.get(LEADER).nickname).toBe('Leader');
      await device.host.mount({ name: 'ProfileOverlay', props: { visible: false } });
      await device.host.mount({ name: 'ProfileOverlay', props: { visible: true } });
      expect(control(await device.observe(), 'profile-name').value).toBe('Leader');
      await device.perform('profile.name', { value: '  Renamed  ' });
      await device.perform('profile.avatar', { value: '🐑' });
      await device.perform('profile.save');
      await world.settle();
      expect(world.backend.profiles.get(LEADER)).toMatchObject({ nickname: 'Renamed', avatar: '🐑' });
      expect((await device.observe()).presentation.session.user.name).toBe('Renamed');
      await device.host.mount({ name: 'CustomQuickCommandSheet', props: { slot: 1 } });
      await device.perform('command.save');
      expect((await device.observe()).external.alerts).toBe(1);
      await device.perform('command.label', { value: '  Meet  ' });
      await device.perform('command.message', { value: '  At the entrance  ' });
      await device.perform('command.save');
      await world.settle();
      expect((await device.observe()).presentation.session.customQuickCommands[1]).toEqual({ label: 'Meet', message: 'At the entrance' });
      world.backend.profiles.delete(LEADER);
      await device.perform('profile.nickname', { args: ['  Recreated profile  '] });
      expect(world.backend.profiles.get(LEADER).nickname).toBe('Recreated profile');
      expect((await device.observe()).presentation.session.user.name).toBe('Recreated profile');
      await expect(device.perform('profile.nickname', { args: ['   '] })).rejects.toThrow();
    } finally { await world.close(); }
  });

  it('blocks profile cancel during a pending write and retains the draft for a failed-save retry', async () => {
    const world = new World();
    try {
      const device = await screen(world, 'ProfileOverlay');
      await world.waitFor(device, (value: any) => value.presentation.session.user?.name === 'Leader', 'profile before pending write');
      await device.perform('profile.name', { value: 'Retained draft' });
      world.hold('profiles');
      await device.perform('profile.save');
      await world.waitFor(device, (value: any) => value.pending.length > 0, 'held profile write');
      await device.perform('profile.cancel');
      expect((await device.observe()).presentation.receipts.filter((receipt: any) => receipt.method === 'onClose')).toEqual([]);
      device.online = false;
      await world.release('profiles');
      expect(control(await device.observe(), 'profile-name').value).toBe('Retained draft');
      expect((await device.observe()).presentation.session.user.name).toBe('Leader');
      device.online = true;
      await device.perform('profile.save');
      await world.settle();
      expect((await device.observe()).presentation.session.user.name).toBe('Retained draft');
      expect((await device.observe()).presentation.receipts.filter((receipt: any) => receipt.method === 'onClose')).toHaveLength(1);
      const writes = world.backend.trace.filter((call: any) => call.name === 'profiles' && call.steps.some((step: any) => step[0] === 'update')).length;
      await device.host.mount({ name: 'ProfileOverlay', props: { visible: false } });
      await device.host.mount({ name: 'ProfileOverlay', props: { visible: true } });
      await device.perform('profile.save');
      expect(world.backend.trace.filter((call: any) => call.name === 'profiles' && call.steps.some((step: any) => step[0] === 'update'))).toHaveLength(writes);
      expect((await device.observe()).presentation.receipts.filter((receipt: any) => receipt.method === 'onClose')).toHaveLength(2);
    } finally { await world.close(); }
  });

  it('upgrades an anonymous account without changing its UID, memberships or unconfirmed expiry', async () => {
    const world = new World();
    try {
      world.backend.configureAuth({ accounts: [{ id: LEADER, is_anonymous: true }], emailConfirmation: false });
      world.backend.profiles.get(LEADER).anonymous_expires_at = '2026-10-25T00:00:00Z';
      const device = await screen(world, 'AccountSheetContent');
      await world.waitFor(device, (value: any) => value.presentation.session.isAnonymous && value.presentation.session.user?.anonymousExpiresAt, 'anonymous account enrichment');
      expect(await device.perform('account.upgrade')).toEqual({ invoked: false, reason: 'disabled' });
      await device.perform('account.email', { value: '  upgraded@headless.test  ' });
      await device.perform('account.password', { value: 'NewPassword123!' });
      await device.perform('account.upgrade');
      await world.settle();
      const pending = (await device.observe()).presentation.session;
      expect(pending.user.id).toBe(LEADER);
      expect(pending.isAnonymous).toBe(true);
      expect(pending.user.anonymousExpiresAt).toBe('2026-10-25T00:00:00Z');
      expect(world.backend.memberships.filter((member: any) => member.user_id === LEADER)).toHaveLength(1);
      expect(world.backend.profiles.get(LEADER).anonymous_expires_at).toBe('2026-10-25T00:00:00Z');
      expect(control(await device.observe(), 'account-email').value).toBe('');
      world.backend.configureAuth({ emailConfirmation: true });
      await device.perform('account.email', { value: 'upgraded@headless.test' });
      await device.perform('account.password', { value: 'Confirmed123!' });
      await device.perform('account.upgrade');
      const upgraded = await world.waitFor(device, (value: any) => !value.presentation.session.isAnonymous, 'registered identity confirmed');
      expect(upgraded.presentation.session.user).toMatchObject({ id: LEADER, provider: 'email', email: 'upgraded@headless.test' });
      expect(upgraded.presentation.session.user.anonymousExpiresAt).toBeUndefined();
      expect(world.backend.profiles.get(LEADER).anonymous_expires_at).toBeNull();
    } finally { await world.close(); }
  });

  it('keeps the current team entitlement when an older same-account team lookup arrives late', async () => {
    const world = new World();
    try {
      const device = await screen(world, 'RoleSelect');
      const original = (await device.perform('group.getMyJoinedGroups', { args: [{ includeProfiles: false }] }))[0];
      const replacement = await device.perform('group.createGroup', { args: ['Free replacement team'] });
      world.backend.teamPremium = new Map([[GROUP_ID, { status: 'active' }]]);
      world.hold('get_trip_entitlement', { phase: 'delivery' });
      await device.perform('session.membership', { args: [{ group: original.group, role: 'leader' }] });
      await device.perform('session.membership', { args: [{ group: replacement, role: 'leader' }] });
      await world.waitFor(device, () => world.held.filter((item: any) => item.operation.name === 'get_trip_entitlement').length === 2, 'both team lookups held');
      const newer = world.held.find((item: any) => item.operation.args.p_group_id === replacement.id);
      world.held = world.held.filter((item: any) => item !== newer);
      world.respond(newer);
      await world.waitFor(device, (value: any) => value.presentation.session.tripEntitlement?.isPremium === false, 'replacement team entitlement');
      await world.release('get_trip_entitlement');
      const settled = (await device.observe()).presentation.session;
      expect(settled.membership.group.id).toBe(replacement.id);
      expect(settled.tripEntitlement.isPremium).toBe(false);
      expect(settled.premiumProjection.teamPremiumActive).toBe(false);
    } finally { await world.close(); }
  });

  it.each(['google', 'apple'])('links %s to the same anonymous UID and adds a password with confirmation guards', async provider => {
    const world = new World();
    try {
      world.backend.configureAuth({ accounts: [{ id: LEADER, is_anonymous: true, email: 'linked@headless.test' }],
        idTokens: [{ token: 'fixture-social-token', userId: LEADER, provider }],
        codes: [{ code: 'fixture-link-code', userId: LEADER, type: 'link', provider }] });
      const device = await screen(world, 'AccountSheetContent');
      await world.waitFor(device, (value: any) => value.presentation.session.isAnonymous, 'anonymous provider link controls');
      await device.perform(`account.${provider}`);
      await world.settle();
      expect((await device.observe()).presentation.session.isAnonymous).toBe(true);
      await device.input({ kind: 'auth.configureNative', value: {
        google: { result: { type: 'success', data: { idToken: 'fixture-social-token' } } },
        apple: { available: true, result: { identityToken: 'fixture-social-token', email: 'linked@headless.test' } },
        browser: { code: 'fixture-link-code' },
      } });
      await device.perform(`account.${provider}`);
      const linked = await world.waitFor(device, (value: any) => !value.presentation.session.isAnonymous, 'linked registered identity');
      expect(linked.presentation.session.user).toMatchObject({ id: LEADER, provider });
      expect(world.backend.memberships.filter((member: any) => member.user_id === LEADER)).toHaveLength(1);
      expect(await device.perform('account.add-password')).toEqual({ invoked: false, reason: 'disabled' });
      await device.perform('account.password', { value: 'AddedPassword123!' });
      await device.perform('account.confirm', { value: 'mismatch' });
      expect(await device.perform('account.add-password')).toEqual({ invoked: false, reason: 'disabled' });
      await device.perform('account.confirm', { value: 'AddedPassword123!' });
      await device.perform('account.add-password');
      await world.settle();
      expect(world.backend.authAccounts.get(LEADER).password).toBe('AddedPassword123!');
      expect((await device.observe()).presentation.session.user.id).toBe(LEADER);
      expect(control(await device.observe(), 'account-password').value).toBe('');
      expect(control(await device.observe(), 'account-confirm-password').value).toBe('');
      const updates = world.backend.trace.filter((call: any) => call.name === 'updateUser');
      expect(updates.at(-1).args[0]).toEqual({ password: 'AddedPassword123!' });
    } finally { await world.close(); }
  });

  it('submits trimmed feedback and closes once after the real success delay', async () => {
    const world = new World();
    try {
      const device = await screen(world, 'FeedbackSheet');
      expect(await device.perform('feedback.submit')).toEqual({ invoked: false, reason: 'disabled' });
      await device.perform('feedback.category', { value: 'ui' });
      await device.perform('feedback.description', { value: '  The map text is difficult to read  ' });
      world.hold('submit_feedback');
      await device.perform('feedback.submit');
      expect(await device.perform('feedback.submit')).toEqual({ invoked: false, reason: 'disabled' });
      expect((await device.observe()).presentation.receipts.filter((receipt: any) => receipt.method === 'onClose')).toHaveLength(0);
      await world.release('submit_feedback');
      await world.advance(999);
      expect((await device.observe()).presentation.receipts.filter((receipt: any) => receipt.method === 'onClose')).toHaveLength(0);
      await world.advance(1);
      expect((await device.observe()).presentation.receipts.filter((receipt: any) => receipt.method === 'onClose')).toHaveLength(1);
      const call = world.backend.trace.find((entry: any) => entry.name === 'submit_feedback');
      expect(call.args).toMatchObject({ p_context_tag: 'ui', p_description: 'The map text is difficult to read' });
    } finally { await world.close(); }
  });

  it('retains failed feedback for retry and cancels deferred close after manual close or unmount', async () => {
    const world = new World();
    try {
      const device = await screen(world, 'FeedbackSheet');
      await device.perform('feedback.description', { value: 'Retry this note' });
      device.online = false;
      await device.perform('feedback.submit');
      await world.settle();
      expect(control(await device.observe(), 'feedback-description').value).toBe('Retry this note');
      expect((await device.observe()).presentation.receipts.filter((receipt: any) => receipt.method === 'onClose')).toEqual([]);
      device.online = true;
      await device.perform('feedback.submit');
      await world.settle();
      await device.perform('feedback.close');
      await world.advance(1000);
      expect((await device.observe()).presentation.receipts.filter((receipt: any) => receipt.method === 'onClose')).toHaveLength(1);
      expect(control(await device.observe(), 'feedback-description').value).toBe('');
      await device.perform('feedback.description', { value: 'Unmount before deferred close' });
      await device.perform('feedback.submit');
      await world.settle();
      await device.host.mount({ name: 'RoleSelect' });
      await world.advance(1000);
      expect((await device.observe()).presentation.receipts.filter((receipt: any) => receipt.method === 'onClose')).toHaveLength(1);
    } finally { await world.close(); }
  });

  it('runs group lifecycle services with exact scope and retains unrelated memberships', async () => {
    const world = new World();
    try {
      const leader = await world.device({ id: 'leader', userId: LEADER, platform });
      const peer = await world.device({ id: 'peer', userId: PEER, platform });
      const created = await leader.perform('group.createGroup', { args: ['  Second team  '] });
      expect(created.name).toBe('Second team');
      expect(world.backend.memberships.find((member: any) => member.group_id === created.id && member.user_id === LEADER).role).toBe('leader');
      await expect(peer.perform('group.joinGroup', { args: ['BAD999'] })).rejects.toThrow('invalid_invite_code');
      expect((await peer.perform('group.joinGroup', { args: [created.inviteCode.toLowerCase()] })).id).toBe(created.id);
      const beforeLite = world.backend.trace.length;
      const joined = await leader.perform('group.getMyJoinedGroups', { args: [{ expectedActorId: LEADER, includeProfiles: false }] });
      expect(joined.map((group: any) => group.group.id).sort()).toEqual([GROUP_ID, created.id].sort());
      expect(world.backend.trace.slice(beforeLite).filter((call: any) => call.name === 'profiles')).toEqual([]);
      await leader.perform('group.updateGroupAvatar', { args: [created.id, '🦊', '#E8543F'] });
      expect(world.backend.groups.get(created.id)).toMatchObject({ avatar: '🦊', avatar_color: '#E8543F' });
      const safeAvatar = await leader.perform('group.updateGroupAvatar', { args: [created.id, 'invalid', 'invalid'] });
      expect(safeAvatar.avatar).not.toBe('invalid');
      expect(safeAvatar.avatarColor).toMatch(/^#[A-Fa-f0-9]{6}$/);
      expect(world.backend.groups.get(created.id)).toMatchObject({ avatar: safeAvatar.avatar, avatar_color: safeAvatar.avatarColor });
      await leader.perform('group.setJourneyStatus', { args: [GROUP_ID, 'going'] });
      await leader.perform('group.setJourneyTarget', { args: [GROUP_ID, DESTINATION] });
      await leader.perform('group.setStragglerConfig', { args: [GROUP_ID, false, 750] });
      expect(world.backend.groups.get(GROUP_ID)).toMatchObject({ journey_status: 'going', active_destination_id: DESTINATION,
        straggler_alerts: false, straggler_threshold_m: 750 });
      await leader.perform('group.setJourneyTarget', { args: [GROUP_ID, null] });
      await leader.perform('group.setStragglerConfig', { args: [GROUP_ID, true, 500] });
      await leader.perform('group.reportStraggler', { args: [GROUP_ID, PEER] });
      expect(world.backend.tables.group_alerts.at(-1)).toMatchObject({ member_id: PEER, distance_m: null, sender_id: LEADER });
      await expect(peer.perform('group.reportStraggler', { args: [GROUP_ID, LEADER, 600] })).rejects.toThrow('leader_required');
      await peer.perform('group.leaveGroups', { args: [[created.id]] });
      expect(world.backend.memberships.filter((member: any) => member.user_id === PEER).map((member: any) => member.group_id)).toEqual([GROUP_ID]);
      const rotated = await leader.perform('group.kickGroupMember', { args: [GROUP_ID, PEER] });
      expect(rotated).toHaveLength(6);
      expect(world.backend.groups.get(GROUP_ID).invite_code).toBe(rotated);
      expect(world.backend.memberships.some((member: any) => member.group_id === GROUP_ID && member.user_id === PEER)).toBe(false);
      await expect(leader.perform('group.kickGroupMember', { args: ['00000000-0000-4000-8000-000000000001', PEER] })).rejects.toThrow('kick_not_supported_in_demo');
    } finally { await world.close(); }
  });

  it('routes home actions, expands teams, confirms one leave and clears the remaining list', async () => {
    const world = new World();
    try {
      const device = await screen(world, 'RoleSelect');
      await world.waitFor(device, (value: any) => value.presentation.hosts.some((host: any) => host.text === '1'), 'home joined-team badge');
      await device.perform('home.create');
      expect((await device.observe()).presentation.route).toMatchObject({ route: 'Auth', params: { role: 'leader' } });
      await device.host.mount({ name: 'RoleSelect' });
      await device.perform('home.join');
      expect((await device.observe()).presentation.route).toMatchObject({ route: 'Auth', params: { role: 'follower' } });
      await device.perform('team.back');
      expect((await device.observe()).presentation.route).toMatchObject({ route: 'Auth', params: { role: 'leader' } });
      await device.host.mount({ name: 'RoleSelect' });
      await device.perform('home.teams');
      await world.waitFor(device, (value: any) => value.presentation.hosts.some((host: any) => host.testId === `team-card-${GROUP_ID}`), 'joined team full profile projection');
      await device.perform('teams.back');
      await device.host.mount({ name: 'RoleSelect' });
      await device.perform('home.teams');
      device.online = false;
      await device.host.mount({ name: 'RoleSelect' });
      await device.host.mount({ name: 'MyTeams' });
      await world.waitFor(device, (value: any) => value.presentation.hosts.some((host: any) => host.testId === 'group-load-retry'), 'team refresh failure');
      expect((await device.observe()).presentation.hosts.some((host: any) => host.testId === `team-card-${GROUP_ID}`)).toBe(true);
      device.online = true;
      await device.perform('teams.retry');
      await world.waitFor(device, (value: any) => !value.presentation.hosts.some((host: any) => host.testId === 'group-load-retry'), 'team retry recovery');
      await device.perform('teams.expand', { groupId: GROUP_ID });
      expect((await device.observe()).presentation.hosts.some((host: any) => host.testId === 'team-enter')).toBe(true);
      await device.perform('teams.expand', { groupId: GROUP_ID });
      expect((await device.observe()).presentation.hosts.some((host: any) => host.testId === 'team-enter')).toBe(false);
      await device.perform('teams.expand', { groupId: GROUP_ID });
      await device.perform('teams.leave');
      await device.input({ kind: 'alert', index: 0 });
      expect(world.backend.memberships.some((member: any) => member.user_id === LEADER && member.group_id === GROUP_ID)).toBe(true);
      const second = await device.perform('group.createGroup', { args: ['Second team'] });
      await device.host.mount({ name: 'RoleSelect' });
      await device.perform('home.teams');
      await world.waitFor(device, (value: any) => value.presentation.hosts.some((host: any) => host.testId === `team-card-${second.id}`), 'newly created team after cache invalidation');
      await device.perform('teams.expand', { groupId: GROUP_ID });
      await device.perform('teams.leave');
      await device.input({ kind: 'alert', index: 1 });
      await world.waitFor(device, (value: any) => !value.presentation.hosts.some((host: any) => host.testId === `team-card-${GROUP_ID}`), 'verified team removed from list');
      expect(world.backend.memberships.filter((member: any) => member.user_id === LEADER).map((member: any) => member.group_id)).toEqual([second.id]);
      await device.perform('teams.clear');
      await device.input({ kind: 'alert', index: 1 });
      await world.settle();
      expect(world.backend.memberships.some((member: any) => member.user_id === LEADER)).toBe(false);
      await device.host.mount({ name: 'MyTeams' });
      await world.waitFor(device, (value: any) => value.presentation.hosts.some((host: any) => host.testId === 'teams-empty-create'), 'empty team actions');
      await device.perform('teams.create');
      expect((await device.observe()).presentation.route).toMatchObject({ route: 'Auth', params: { role: 'leader' } });
      await device.host.mount({ name: 'MyTeams' });
      await device.perform('teams.join');
      expect((await device.observe()).presentation.route).toMatchObject({ route: 'Auth', params: { role: 'follower' } });
    } finally { await world.close(); }
  });

  it('retries a failed nickname fallback and permits only one team entry across different cards', async () => {
    const world = new World();
    try {
      world.backend.profiles.get(LEADER).nickname = '';
      const device = await screen(world, 'RoleSelect');
      const second = await device.perform('group.createGroup', { args: ['Second team'] });
      await device.perform('home.teams');
      await world.waitFor(device, (value: any) => value.presentation.hosts.some((host: any) => host.testId === `team-card-${second.id}`), 'both team cards loaded');
      device.online = false;
      await device.perform('teams.expand', { groupId: GROUP_ID });
      await device.perform('teams.enter');
      await world.settle();
      expect((await device.observe()).presentation.session.membership).toBeNull();
      expect((await device.observe()).presentation.route.route).toBe('MyTeams');
      device.online = true;
      world.hold('profiles');
      await device.perform('teams.expand', { groupId: GROUP_ID });
      await device.perform('teams.enter');
      await world.waitFor(device, (value: any) => value.pending.length > 0, 'nickname write before membership adoption');
      await device.perform('teams.expand', { groupId: second.id });
      await device.perform('teams.enter');
      expect(world.held.filter((item: any) => item.operation.name === 'profiles')).toHaveLength(1);
      expect((await device.observe()).presentation.session.membership).toBeNull();
      await world.release('profiles');
      const entered = await world.waitFor(device, (value: any) => value.presentation.route.route === 'Map' && value.presentation.session.membership?.group.id === GROUP_ID, 'first team adopted after nickname write');
      expect(entered.presentation.session.user.name).toBe('leader');
      expect(world.backend.profiles.get(LEADER).nickname).toBe('leader');
      expect(entered.presentation.route.params.groupId).toBe(GROUP_ID);
    } finally { await world.close(); }
  });

  it('sends, enriches, declines and accepts subgroup invitations through real services', async () => {
    const world = new World();
    try {
      const leader = await world.device({ id: 'leader', userId: LEADER, platform });
      const peer = await world.device({ id: 'peer', userId: PEER, platform });
      expect(await peer.perform('subgroup.fetchMyInvites', { args: [PEER] })).toEqual([]);
      const subgroup = await leader.perform('group.selfSplit', { args: [GROUP_ID, '  Lunch  '] });
      expect(subgroup.name).toBe('Lunch');
      await leader.perform('subgroup.inviteToSubgroup', { args: [subgroup.id, PEER] });
      const first = await peer.perform('subgroup.fetchMyInvites', { args: [PEER] });
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({ subgroupName: 'Lunch', inviterName: 'Leader', inviteeId: PEER });
      expect(await leader.perform('subgroup.fetchSentInvites', { args: [subgroup.id] })).toEqual([{ id: first[0].id, inviteeName: 'Peer' }]);
      await peer.perform('subgroup.declineSubgroupInvite', { args: [first[0].id] });
      expect(await peer.perform('subgroup.fetchMyInvites', { args: [PEER] })).toEqual([]);
      expect(world.backend.memberships.find((member: any) => member.user_id === PEER).subgroup_id).toBeNull();
      await leader.perform('subgroup.inviteToSubgroup', { args: [subgroup.id, PEER] });
      const second = await peer.perform('subgroup.fetchMyInvites', { args: [PEER] });
      await peer.perform('subgroup.acceptSubgroupInvite', { args: [second[0].id] });
      expect(world.backend.memberships.find((member: any) => member.user_id === PEER).subgroup_id).toBe(subgroup.id);
      expect(await peer.perform('subgroup.fetchMyInvites', { args: [PEER] })).toEqual([]);
      await peer.perform('group.selfMerge', { args: [GROUP_ID] });
      expect(world.backend.memberships.find((member: any) => member.user_id === PEER).subgroup_id).toBeNull();
    } finally { await world.close(); }
  });

  it('debounces real subgroup subscriptions, suppresses initial and duplicate alerts and retains invites offline', async () => {
    const world = new World();
    try {
      const leader = await world.device({ id: 'leader', userId: LEADER, platform });
      const subgroup = await leader.perform('group.selfSplit', { args: [GROUP_ID, 'Lunch'] });
      await leader.perform('subgroup.inviteToSubgroup', { args: [subgroup.id, PEER] });
      const peer = await world.device({ id: 'peer', userId: PEER, platform, screen: { name: 'RoleSelect' } });
      await world.waitFor(peer, (value: any) => value.presentation.invites?.length === 1, 'initial pending invite');
      expect((await peer.observe()).native.scheduled).toEqual([]);
      const first = (await peer.observe()).presentation.invites[0];
      await peer.perform('invites.decline', { args: [first.id] });
      await world.waitFor(peer, (value: any) => value.presentation.invites.length === 0, 'decline refresh');
      await leader.perform('subgroup.inviteToSubgroup', { args: [subgroup.id, PEER] });
      await world.settle();
      await world.advance(299);
      expect((await peer.observe()).presentation.invites).toEqual([]);
      await world.advance(1);
      const invited = await world.waitFor(peer, (value: any) => value.presentation.invites.length === 1, 'new invite after debounce');
      expect(invited.native.scheduled).toHaveLength(1);
      world.backend.publish('subgroup_invites', world.backend.tables.subgroup_invites.at(-1));
      await world.settle();
      await world.advance(300);
      expect((await peer.observe()).native.scheduled).toHaveLength(1);
      peer.online = false;
      await peer.input({ kind: 'appState', value: 'background' });
      await peer.input({ kind: 'appState', value: 'active' });
      await world.settle();
      expect((await peer.observe()).presentation.invites).toHaveLength(1);
      peer.online = true;
      await peer.perform('invites.accept', { args: [invited.presentation.invites[0].id] });
      await world.waitFor(peer, (value: any) => value.presentation.invites.length === 0, 'accept refresh');
      expect(world.backend.memberships.find((member: any) => member.user_id === PEER).subgroup_id).toBe(subgroup.id);
    } finally { await world.close(); }
  });

  it('enqueues trip and solo changes through real durable core storage', async () => {
    const world = new World();
    try {
      const device = await world.device({ id: 'core', userId: LEADER, platform });
      await device.perform('group.observe', { groupId: GROUP_ID });
      await world.waitFor(device, (value: any) => value.group.dataSource === 'remote', 'group projection before edits');
      device.online = false;
      await device.perform('group.updateGroupTripDetails', { args: [GROUP_ID, 3, '2026-11-01'] });
      await device.perform('group.setSolo', { args: [GROUP_ID, true] });
      const pending = await device.observe();
      expect(pending.durable.operations.map((operation: any) => operation.operationType)).toEqual(['set_trip_details', 'set_solo']);
      expect(pending.durable.snapshot.group).toMatchObject({ tripDays: 3, departureDate: '2026-11-01' });
      expect(pending.durable.snapshot.members.find((member: any) => member.userId === LEADER).solo).toBe(true);
      device.online = true;
      await world.advance(30000);
      await world.waitFor(device, (value: any) => value.durable.operations.length === 0, 'accepted trip and solo operations');
      expect(world.backend.groups.get(GROUP_ID)).toMatchObject({ trip_days: 3, departure_date: '2026-11-01' });
      expect(world.backend.memberships.find((member: any) => member.user_id === LEADER).solo).toBe(true);
    } finally { await world.close(); }
  });

  it('persists every preference through real provider setters and rehydrates the same device', async () => {
    const world = new World();
    try {
      const device = await screen(world, 'RoleSelect');
      const cases: [string, string | number | boolean, string, string | number | boolean][] = [
        ['setTravelMode', 'drive', 'travelMode', 'drive'],
        ['setTravelMode', 'invalid', 'travelMode', 'walk'],
        ['setLanguage', 'en', 'language', 'en'],
        ['setThemeName', 'forest', 'themeName', 'forest'],
        ['setTextScale', 1.2, 'textScale', 1.2],
        ['setHighAccuracy', true, 'highAccuracy', true],
        ['setSharingEnabled', false, 'sharingEnabled', false],
        ['setObliqueLocate', false, 'obliqueLocate', false],
        ['setLiveActivityEnabled', false, 'liveActivityEnabled', false],
        ['setMeetRedMin', 10, 'meetRedMin', 10],
        ['setGatherCardDefaultExpanded', false, 'gatherCardDefaultExpanded', false],
        ['setGatherCardTitleMarquee', false, 'gatherCardTitleMarquee', false],
        ['setGatherCardMarqueeSpeed', 100, 'gatherCardMarqueeSpeed', 80],
        ['setGatherCardMarqueeSpeed', 19, 'gatherCardMarqueeSpeed', 20],
        ['setGatherCardMarqueeSpeed', 40.6, 'gatherCardMarqueeSpeed', 41],
        ['setArrivalRadiusM', 75, 'arrivalRadiusM', 50],
        ['setArrivalRadiusM', 480, 'arrivalRadiusM', 500],
        ['setPassiveCompanionMode', true, 'passiveCompanionMode', true],
      ];
      for (const [setter, input, field, expected] of cases) {
        await device.perform(`preferences.${setter}`, { args: [input] });
        expect((await device.observe()).presentation.preferences[field]).toEqual(expected);
      }
      await device.perform('preferences.setDayColor', { args: [1, '#123456'] });
      await device.perform('preferences.setDayColor', { args: [2, '#abcdef'] });
      expect((await device.observe()).presentation.preferences.dayColors).toEqual({ 1: '#123456', 2: '#abcdef' });
      const before = (await device.observe()).presentation.preferences;
      await device.restart();
      const restored = await world.waitFor(device, (value: any) => value.presentation.preferences.ready, 'persisted preferences');
      for (const field of ['travelMode', 'language', 'themeName', 'textScale', 'highAccuracy', 'sharingEnabled', 'obliqueLocate',
        'liveActivityEnabled', 'meetRedMin', 'dayColors', 'gatherCardDefaultExpanded', 'gatherCardTitleMarquee', 'gatherCardMarqueeSpeed',
        'arrivalRadiusM', 'passiveCompanionMode']) expect(restored.presentation.preferences[field]).toEqual(before[field]);
    } finally { await world.close(); }
  });

  it('ignores malformed persisted preferences and migrates legacy sharing only when the new key is absent', async () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const world = new World();
    try {
      const device = await screen(world, 'RoleSelect');
      const file = path.join(world.directory, device.spec.id, 'async.json');
      const values = JSON.parse(fs.readFileSync(file, 'utf8'));
      Object.assign(values, { 'pref.language': 'bad', 'pref.theme': 'bad', 'pref.textScale': '2', 'pref.travelMode': 'spaceship',
        'pref.meetRedMin': '7', 'pref.dayColors': '{bad', 'pref.gatherCardMarqueeSpeed': 'NaN', 'pref.arrivalRadiusM': 'NaN',
        'pref.locationSharing': 'false' });
      delete values['pref.sharingEnabled'];
      fs.writeFileSync(file, JSON.stringify(values));
      await device.restart();
      const restored = await world.waitFor(device, (value: any) => value.presentation.preferences.ready, 'invalid preferences resolved to defaults');
      expect(restored.presentation.preferences).toMatchObject({ language: 'zh', themeName: 'night', textScale: 1, travelMode: 'walk',
        meetRedMin: 5, dayColors: {}, gatherCardMarqueeSpeed: 40, arrivalRadiusM: 50, sharingEnabled: false });
      const migrated = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(migrated['pref.sharingEnabled']).toBe('false');
      expect(migrated['pref.locationSharing']).toBeUndefined();
      migrated['pref.sharingEnabled'] = 'true';
      migrated['pref.locationSharing'] = 'false';
      fs.writeFileSync(file, JSON.stringify(migrated));
      await device.restart();
      const current = await world.waitFor(device, (value: any) => value.presentation.preferences.ready, 'current sharing setting wins');
      expect(current.presentation.preferences.sharingEnabled).toBe(true);
    } finally { await world.close(); }
  });

  it('writes sanitized diagnostics to real SQLite and uploads only while consent is active', async () => {
    const world = new World();
    try {
      const device = await screen(world, 'RoleSelect');
      await device.perform('diagnostics.write', { args: [{ event: 'headless_private', source: 'token=secret', latitude: 25, password: 'secret' }] });
      expect(await device.perform('diagnostics.list')).toEqual([]);
      await device.perform('preferences.setDiagnosticUploadEnabled', { args: [true] });
      await device.perform('diagnostics.write', { args: [{ event: 'headless_record', count: 3, success: false, password: 'secret', latitude: 25 }] });
      const records = await device.perform('diagnostics.list');
      expect(records).toHaveLength(1);
      expect(records[0].payload).toEqual({ count: 3, success: false });
      expect(await device.perform('diagnostics.summary')).toMatchObject({ total: 1, pending: 1, byEvent: { headless_record: 1 } });
      const exported = JSON.parse(await device.perform('diagnostics.exportJson'));
      expect(exported).toMatchObject({ schemaVersion: 1, records });
      expect(JSON.stringify(exported)).not.toContain('secret');
      expect(await device.perform('diagnostics.flush')).toEqual({ sent: 1, remaining: 0 });
      expect((await device.perform('diagnostics.list'))[0].uploadedAt).not.toBeNull();
      await device.perform('diagnostics.write', { args: [{ event: 'pending_before_revoke', count: 1 }] });
      await device.perform('preferences.setDiagnosticUploadEnabled', { args: [false] });
      expect(await device.perform('diagnostics.flush')).toEqual({ sent: 0, remaining: 0 });
      expect(await device.perform('diagnostics.summary')).toMatchObject({ total: 1, pending: 0 });
      expect(world.backend.trace.filter((call: any) => call.name === 'ingest_diagnostic_batch')).toHaveLength(1);
      expect(await device.perform('diagnostics.uploadMetricPayload', { args: [{ id: 'denied', kind: 'metric', json: '{}', receivedAt: world.now }] })).toBe(false);
      await device.perform('preferences.setDiagnosticUploadEnabled', { args: [true] });
      await expect(device.perform('diagnostics.uploadMetricPayload', { args: [{ id: 'invalid', kind: 'metric', json: '[]', receivedAt: world.now }] })).rejects.toThrow('JSON object');
      expect(await device.perform('diagnostics.uploadMetricPayload', { args: [{ id: 'metric-ok', kind: 'metric', json: '{"duration":7}', receivedAt: world.now }] })).toBe(true);
      const payloads = [{ id: 'batch-ok', kind: 'metric', json: '{"duration":8}', receivedAt: world.now },
        { id: 'batch-invalid', kind: 'metric', json: '[]', receivedAt: world.now },
        { id: 'batch-after-invalid', kind: 'metric', json: '{}', receivedAt: world.now }];
      expect(await device.perform('diagnostics.uploadMetricPayloadBatch', { payloads, current: false })).toEqual([]);
      expect(await device.perform('diagnostics.uploadMetricPayloadBatch', { payloads })).toEqual(['batch-ok']);
      expect(world.backend.tables.metric_payloads.map((row: any) => row.id)).toEqual(['metric-ok', 'batch-ok']);
    } finally { await world.close(); }
  });

  it('shares one OTA apply flight, reports actual failures and consumes each changed update notice once', async () => {
    const world = new World();
    try {
      const device = await screen(world, 'RoleSelect');
      await device.input({ kind: 'updates.configure', value: { check: { isAvailable: true }, fetch: { isNew: true } } });
      await device.input({ kind: 'updates.hold', method: 'checkForUpdateAsync' });
      const first = device.perform('ota.applyOtaUpdate', { args: [{ manual: true }] });
      const second = device.perform('ota.applyOtaUpdate', { args: [{ manual: true }] });
      await world.waitFor(device, (value: any) => value.updates.pending.some((pending: any) => pending.method === 'checkForUpdateAsync' && pending.count === 1), 'one held OTA flight');
      await device.input({ kind: 'updates.release', method: 'checkForUpdateAsync' });
      expect(await first).toEqual({ status: 'reloading', reloading: true });
      expect(await second).toEqual({ status: 'reloading', reloading: true });
      expect((await device.observe()).updates.receipts.map((receipt: any) => receipt.method)).toEqual(['checkForUpdateAsync', 'fetchUpdateAsync', 'reloadAsync']);
      await device.input({ kind: 'updates.configure', value: { fetchError: 'download failed' } });
      expect(await device.perform('ota.applyOtaUpdate', { args: [{ manual: true }] })).toEqual({ status: 'fetch_failed', reloading: false });
      await device.input({ kind: 'updates.configure', value: { fetchError: null, reloadError: 'reload failed' } });
      expect(await device.perform('ota.applyOtaUpdate', { args: [{ manual: true, skipCheck: true }] })).toEqual({ status: 'reload_failed', reloading: false });
      await device.input({ kind: 'updates.configure', value: { reloadError: null, check: { isAvailable: false } } });
      expect(await device.perform('ota.applyOtaUpdate', { args: [{ manual: true }] })).toEqual({ status: 'no_update', reloading: false });
      expect(await device.perform('ota.consumeOtaAppliedNotice')).toBe(false);
      await device.input({ kind: 'updates.configure', value: { isEmbeddedLaunch: false, updateId: 'update-one' } });
      expect(await device.perform('ota.consumeOtaAppliedNotice')).toBe(true);
      expect(await device.perform('ota.consumeOtaAppliedNotice')).toBe(false);
      await device.input({ kind: 'updates.configure', value: { updateId: 'update-two' } });
      expect(await device.perform('ota.consumeOtaAppliedNotice')).toBe(true);
      await device.perform('ota.bootstrap.start');
      await world.settle();
      const beforeForeground = (await device.observe()).updates.receipts.length;
      await device.input({ kind: 'appState', value: 'background' });
      await device.input({ kind: 'appState', value: 'active' });
      await world.settle();
      expect((await device.observe()).updates.receipts.length).toBe(beforeForeground + 1);
      await device.perform('ota.bootstrap.stop');
      await device.input({ kind: 'updates.configure', value: { isEnabled: false } });
      expect(await device.perform('ota.applyOtaUpdate')).toEqual({ status: 'disabled', reloading: false });
    } finally { await world.close(); }
  });

  it('checks OTA when settings opens and applies through the real support-page button', async () => {
    const world = new World();
    try {
      const device = await world.device({ id: 'settings', userId: LEADER, platform, screen: { name: 'SettingsOverlay' },
        updatesFixtures: { check: { isAvailable: true }, fetch: { isNew: true }, isUpdateAvailable: true } });
      await world.waitFor(device, (value: any) => value.updates.receipts.some((receipt: any) => receipt.method === 'checkForUpdateAsync'), 'visible Settings OTA check');
      await device.perform('settings.support');
      await device.perform('settings.ota');
      await world.settle();
      expect((await device.observe()).updates.receipts.map((receipt: any) => receipt.method)).toEqual(['checkForUpdateAsync', 'checkForUpdateAsync', 'fetchUpdateAsync', 'reloadAsync']);
    } finally { await world.close(); }
  });

  it('navigates real settings children, commits language theme and text size and resets the page on reopen', async () => {
    const world = new World();
    try {
      const device = await screen(world, 'SettingsOverlay');
      await device.perform('preferences.setLanguage', { args: ['en'] });
      await device.perform('settings.language');
      await device.host.call({ kind: 'press', testId: 'settings-language-zh' });
      expect((await device.observe()).presentation.preferences.language).toBe('zh');
      await device.host.call({ kind: 'press', testId: 'settings-language-en' });
      await device.perform('settings.back');
      await device.perform('settings.theme');
      await device.host.call({ kind: 'press', testId: 'settings-theme-day' });
      expect((await device.observe()).presentation.preferences.themeName).toBe('day');
      await device.perform('settings.back');
      await device.perform('settings.textSize');
      await device.host.call({ kind: 'toggle', testId: 'settings-text-scale-slider', value: 4 });
      expect((await device.observe()).presentation.preferences.textScale).toBe(1.2);
      await device.perform('settings.back');
      for (const page of ['account', 'notifications', 'mapJourney', 'support']) {
        await device.perform(`settings.${page}`);
        expect((await device.observe()).presentation.hosts.filter((host: any) => host.testId === 'settings-child-back' && host.acceptsInput)).toHaveLength(1);
        await device.perform('settings.back');
      }
      await device.perform('settings.diagnostic', { value: true });
      await world.settle();
      expect((await device.observe()).presentation.preferences.diagnosticUploadEnabled).toBe(true);
      await device.perform('settings.reset');
      expect((await device.observe()).presentation.receipts.filter((receipt: any) => receipt.method === 'onConfirmResetPrefs')).toHaveLength(1);
      await device.perform('settings.language');
      await device.host.mount({ name: 'SettingsOverlay', props: { visible: false } });
      await device.host.mount({ name: 'SettingsOverlay', props: { visible: true } });
      expect((await device.observe()).presentation.hosts.some((host: any) => host.testId === 'settings-child-back' && host.acceptsInput)).toBe(false);
    } finally { await world.close(); }
  });

  it('recovers a resolved render fault, offers retry for a later episode and stops retrying a persistent fault', async () => {
    const world = new World();
    try {
      const device = await world.device({ id: 'boundary', userId: LEADER, platform, screen: { name: 'ErrorBoundary', props: { crash: true } } });
      await world.waitFor(device, (value: any) => value.presentation.hosts.some((host: any) => host.testId === 'app-error-retry'), 'caught external render fault');
      await device.host.mount({ name: 'ErrorBoundary', props: { crash: false } });
      await device.perform('error.retry');
      expect((await device.observe()).presentation.hosts.some((host: any) => host.testId === 'boundary-content')).toBe(true);
      await device.host.mount({ name: 'ErrorBoundary', props: { crash: true } });
      expect((await device.observe()).presentation.hosts.some((host: any) => host.testId === 'app-error-retry')).toBe(true);
      await device.perform('error.retry');
      expect((await device.observe()).presentation.hosts.some((host: any) => host.testId === 'app-error-retry')).toBe(false);
      expect((await device.observe()).presentation.session.user.id).toBe(LEADER);
    } finally { await world.close(); }
  });

  it('blocks a loading group retry and invokes the real recovery control only after loading stops', async () => {
    const world = new World();
    try {
      const device = await world.device({ id: 'retry', userId: LEADER, platform, screen: { name: 'GroupLoadError', props: { loading: true } } });
      await world.waitFor(device, (value: any) => value.presentation.hosts.some((host: any) => host.testId === 'group-load-retry'), 'group error control');
      expect(await device.perform('teams.retry')).toEqual({ invoked: false, reason: 'disabled' });
      await device.host.mount({ name: 'GroupLoadError', props: { loading: false } });
      await device.perform('teams.retry');
      expect((await device.observe()).presentation.receipts.filter((receipt: any) => receipt.method === 'retry')).toHaveLength(1);
    } finally { await world.close(); }
  });

  it.each([
    ['leader', 'Shepherd', { purpose: 'abroad', days: 2, departureDate: null }],
    ['follower', 'Flock', { quiz: { F1: 'A', F2: 'B', F3: 'A' }, mascot: 'cat', prefs: ['food'] }],
    ['browser', "I'm just browsing for now", { why: 'findPeople', companions: 'family', wanted: 'liveLocation' }],
  ])('finishes the actual %s onboarding branch with accumulated answers', async (role, label, branchAnswers) => {
    const world = new World();
    try {
      const device = await screen(world);
      await device.perform('preferences.setLanguage', { args: ['en'] });
      await device.perform('onboarding.continue');
      await device.perform('onboarding.continue');
      await world.settle();
      await device.host.call({ kind: 'press', testId: 'onboarding-theme-forest' });
      expect((await device.observe()).presentation.preferences.themeName).toBe('forest');
      await device.perform('onboarding.continue');
      expect(await device.perform('onboarding.continue')).toEqual({ invoked: false, reason: 'disabled' });
      await device.perform('onboarding.option', { label });
      await device.perform('onboarding.continue');
      if (role === 'leader') {
        expect(await device.perform('onboarding.continue')).toEqual({ invoked: false, reason: 'disabled' });
        await device.perform('onboarding.option', { label: 'Abroad trip' });
        await device.perform('onboarding.continue');
        expect(await device.perform('onboarding.days.decrease')).toEqual({ invoked: false, reason: 'disabled' });
        await device.perform('onboarding.days.increase');
        await device.perform('onboarding.continue');
        expect(await device.perform('onboarding.continue')).toEqual({ invoked: false, reason: 'disabled' });
        await device.host.call({ kind: 'press', testId: 'onboarding-departure-now' });
        await device.perform('onboarding.continue');
      } else if (role === 'follower') {
        for (const answer of ['A', 'B', 'A']) {
          expect(await device.perform('onboarding.continue')).toEqual({ invoked: false, reason: 'disabled' });
          await device.host.call({ kind: 'press', testId: `onboarding-quiz-${answer}` });
          await device.perform('onboarding.continue');
        }
        await device.perform('onboarding.back');
        await device.host.call({ kind: 'press', testId: 'onboarding-quiz-A' });
        await device.perform('onboarding.continue');
        await device.perform('onboarding.continue');
        await device.perform('onboarding.option', { label: 'Food' });
        await device.perform('onboarding.option', { label: 'Food' });
        expect(await device.perform('onboarding.continue')).toEqual({ invoked: false, reason: 'disabled' });
        await device.perform('onboarding.option', { label: 'Food' });
        await device.perform('onboarding.continue');
      } else {
        for (const option of ['Find people', 'Family', 'Live location']) {
          expect(await device.perform('onboarding.continue')).toEqual({ invoked: false, reason: 'disabled' });
          await device.perform('onboarding.option', { label: option });
          await device.perform('onboarding.continue');
        }
      }
      await device.perform('onboarding.continue');
      await world.settle();
      expect(await device.perform('onboarding.readOnboardingState')).toMatchObject({ completed: true, answers: { role, theme: 'forest', ...branchAnswers } });
      expect(await device.perform('onboarding.readOnboardingReplayIntent')).toBe(false);
      expect((await device.observe()).presentation.receipts.filter((receipt: any) => receipt.method === 'onDone')).toHaveLength(1);
    } finally { await world.close(); }
  });

  it('preserves partial onboarding answers on skip and defers replay until the home boundary', async () => {
    const world = new World();
    try {
      const device = await screen(world);
      await device.perform('onboarding.continue');
      await device.perform('onboarding.back');
      await device.perform('onboarding.skip');
      await world.settle();
      expect(await device.perform('onboarding.readOnboardingState')).toMatchObject({ completed: true, answers: {} });
      device.online = false;
      await device.perform('onboarding.syncOnboardingIfNeeded');
      expect((await device.perform('onboarding.readOnboardingState')).synced).toBeUndefined();
      device.online = true;
      await device.perform('onboarding.syncOnboardingIfNeeded');
      expect((await device.perform('onboarding.readOnboardingState')).synced).toBe(true);
      expect(world.backend.profiles.get(LEADER).onboarding).toEqual({});
      const writes = world.backend.trace.filter((call: any) => call.name === 'profiles' && call.steps.some((step: any) => step[0] === 'update' && 'onboarding' in step[1])).length;
      await device.perform('onboarding.syncOnboardingIfNeeded');
      expect(world.backend.trace.filter((call: any) => call.name === 'profiles' && call.steps.some((step: any) => step[0] === 'update' && 'onboarding' in step[1]))).toHaveLength(writes);
      await device.perform('onboarding.markOnboardingReplayForHome');
      expect(await device.perform('onboarding.readOnboardingState')).toBeNull();
      expect(await device.perform('onboarding.readOnboardingReplayIntent')).toBe(true);
      for (const atHomeBoundary of [false, true]) {
        expect(await device.perform('onboarding.shouldPresentFullOnboarding', { args: [{ storageCompleted: false, replayIntent: true, atHomeBoundary }] })).toBe(atHomeBoundary);
      }
      expect(await device.perform('onboarding.isOnboardingCompleteForTourGate', { args: [{ storageCompleted: true, replayIntent: true }] })).toBe(false);
    } finally { await world.close(); }
  });

  it('continues after permission denial, clamps trip days and accepts only a confirmed custom departure date', async () => {
    const world = new World();
    try {
      const device = await screen(world);
      await device.perform('preferences.setLanguage', { args: ['en'] });
      await device.input({ kind: 'notificationsConfigure', patch: { permission: 'denied' } });
      await device.input({ kind: 'permission', status: 'denied' });
      await device.perform('onboarding.continue');
      await device.perform('onboarding.continue');
      await world.settle();
      await device.perform('onboarding.continue');
      await device.perform('onboarding.option', { label: 'Shepherd' });
      await device.perform('onboarding.continue');
      await device.perform('onboarding.option', { label: 'Abroad trip' });
      await device.perform('onboarding.continue');
      for (let day = 1; day < 14; day++) await device.perform('onboarding.days.increase');
      expect(await device.perform('onboarding.days.increase')).toEqual({ invoked: false, reason: 'disabled' });
      await device.perform('onboarding.continue');
      await device.host.call({ kind: 'press', testId: 'onboarding-departure-custom' });
      if (platform === 'ios') await device.host.call({ kind: 'press', testId: 'onboarding-date-cancel' });
      else await device.input({ kind: 'datePicker', type: 'dismissed' });
      expect(await device.perform('onboarding.continue')).toEqual({ invoked: false, reason: 'disabled' });
      await device.host.call({ kind: 'press', testId: 'onboarding-departure-custom' });
      await device.input({ kind: 'datePicker', type: 'set', timestamp: Date.parse('2026-11-15T00:00:00Z') });
      if (platform === 'ios') await device.perform('onboarding.continue', { within: 'onboarding-date-modal' });
      await device.perform('onboarding.continue');
      await device.perform('onboarding.continue');
      await world.settle();
      expect(await device.perform('onboarding.readOnboardingState')).toMatchObject({ completed: true,
        answers: { role: 'leader', purpose: 'abroad', days: 14, departureDate: '2026-11-15T00:00:00.000Z' } });
    } finally { await world.close(); }
  });
});
export {};
