import {
  deriveCardNavFlags,
  deriveScopedArrivalCounts,
  LEADER_COMPLETED_NOTICE,
  mergeAvatarProfiles,
  projectHistoryForViewer,
  resolveCompletePrompt,
  resolveNavCommand,
  shouldAutoCompleteStop,
} from '../utils/gatherCommand';

describe('deriveCardNavFlags (shared vs local — MapScreen wiring inputs)', () => {
  it('member local plan is localRouteThis, not flock navigating', () => {
    // journeyActive would be true for localTargetId, but sharedTargetId is null.
    const flags = deriveCardNavFlags({
      destId: 'stop-a',
      isLeader: false,
      sharedTargetId: null,
      localTargetId: 'stop-a',
    });
    expect(flags).toEqual({ flockNavigatingThis: false, localRouteThis: true });
    expect(
      resolveNavCommand({
        isLeader: false,
        personallyArrived: false,
        ...flags,
      }),
    ).toMatchObject({ kind: 'member_close_plan', label: '結束' });
  });

  it('shared session wins over member local plan on the same stop', () => {
    const flags = deriveCardNavFlags({
      destId: 'stop-a',
      isLeader: false,
      sharedTargetId: 'stop-a',
      localTargetId: 'stop-a',
    });
    expect(flags).toEqual({ flockNavigatingThis: true, localRouteThis: false });
    expect(
      resolveNavCommand({
        isLeader: false,
        personallyArrived: false,
        ...flags,
      }),
    ).toMatchObject({ kind: 'member_navigating', label: '前往中', disabled: true });
  });

  it('member path-plan when neither shared nor local is set', () => {
    const flags = deriveCardNavFlags({
      destId: 'stop-a',
      isLeader: false,
      sharedTargetId: null,
      localTargetId: null,
    });
    expect(flags).toEqual({ flockNavigatingThis: false, localRouteThis: false });
    expect(
      resolveNavCommand({
        isLeader: false,
        personallyArrived: false,
        ...flags,
      }).label,
    ).toBe('路徑');
  });

  it('leader flock uses shared or pending busy target only', () => {
    expect(
      deriveCardNavFlags({
        destId: 'stop-a',
        isLeader: true,
        sharedTargetId: 'stop-a',
        localTargetId: null,
      }).flockNavigatingThis,
    ).toBe(true);
    expect(
      deriveCardNavFlags({
        destId: 'stop-a',
        isLeader: true,
        sharedTargetId: null,
        localTargetId: null,
        pendingLeaderTargetId: 'stop-a',
        journeyBusy: true,
      }).flockNavigatingThis,
    ).toBe(true);
    // Local target alone must not mark flock nav for anyone.
    expect(
      deriveCardNavFlags({
        destId: 'stop-a',
        isLeader: true,
        sharedTargetId: null,
        localTargetId: 'stop-a',
      }).flockNavigatingThis,
    ).toBe(false);
  });
});

describe('resolveNavCommand', () => {
  it('gives leaders start/end only (never path-plan labels)', () => {
    expect(
      resolveNavCommand({
        isLeader: true,
        personallyArrived: false,
        flockNavigatingThis: false,
        localRouteThis: false,
      }),
    ).toMatchObject({ kind: 'leader_start', label: '開始', action: 'start_nav' });

    expect(
      resolveNavCommand({
        isLeader: true,
        personallyArrived: false,
        flockNavigatingThis: true,
        localRouteThis: false,
      }),
    ).toMatchObject({ kind: 'leader_stop', label: '結束', action: 'end_point' });
  });

  it('keeps leader Start pressable while the latest-intent queue owns gates', () => {
    expect(
      resolveNavCommand({
        isLeader: true,
        personallyArrived: false,
        flockNavigatingThis: false,
        localRouteThis: false,
        isNextTeamPending: false,
      }),
    ).toMatchObject({ kind: 'leader_start', label: '開始', disabled: false, action: 'start_nav' });
  });

  it('after personal arrival without flock nav, offers Complete (not Start)', () => {
    // 「先不要完成」 must leave mark_complete available — never restore Start.
    expect(
      resolveNavCommand({
        isLeader: true,
        personallyArrived: true,
        flockNavigatingThis: false,
        localRouteThis: false,
        teamStartBlocked: true,
      }),
    ).toMatchObject({
      kind: 'leader_mark_complete',
      label: '完成',
      disabled: false,
      action: 'mark_complete',
    });
  });

  it('shows End only for the active team destination', () => {
    expect(
      resolveNavCommand({
        isLeader: true,
        personallyArrived: true,
        flockNavigatingThis: true,
        localRouteThis: false,
      }),
    ).toMatchObject({
      kind: 'leader_stop',
      label: '結束',
      action: 'end_point',
      disabled: false,
    });
  });


  it('gives members path plan / close plan, never leader start label', () => {
    const plan = resolveNavCommand({
      isLeader: false,
      personallyArrived: false,
      flockNavigatingThis: false,
      localRouteThis: false,
    });
    expect(plan).toMatchObject({ kind: 'member_plan', label: '路徑', disabled: false });
    expect(plan.label).not.toBe('開始');

    expect(
      resolveNavCommand({
        isLeader: false,
        personallyArrived: false,
        flockNavigatingThis: false,
        localRouteThis: true,
      }),
    ).toMatchObject({ kind: 'member_close_plan', label: '結束' });
  });

  it('disables member control as travelling display while leader navigates', () => {
    expect(
      resolveNavCommand({
        isLeader: false,
        personallyArrived: false,
        flockNavigatingThis: true,
        localRouteThis: true,
      }),
    ).toMatchObject({
      kind: 'member_navigating',
      label: '前往中',
      disabled: true,
      action: 'none',
    });
  });

  it('shows waiting copy once a member has arrived', () => {
    expect(
      resolveNavCommand({
        isLeader: false,
        personallyArrived: true,
        flockNavigatingThis: true,
        localRouteThis: false,
      }),
    ).toMatchObject({
      kind: 'member_waiting_complete',
      label: '等待隊長完成',
      disabled: true,
      action: 'none',
    });
  });
});

describe('resolveCompletePrompt', () => {
  it('auto-completes for leader when everyone arrived (no confirm UI)', () => {
    const r = resolveCompletePrompt({
      isLeader: true,
      missingMemberNames: [],
      allArrived: true,
      stopAlreadyComplete: false,
      arrivedCount: 3,
      totalCount: 3,
    });
    expect(r.kind).toBe('auto_complete');
    expect(r.arrivedCount).toBe(3);
    expect(r.totalCount).toBe(3);
    expect(r.message).toBe('');
    // Old all-arrived confirm copy must not reappear.
    expect(r.message).not.toContain('是否要完成？');
    expect(r.confirmLabel).toBe('');
    expect(r.deferLabel).toBeNull();
    expect(r.cancelLabel).toBeNull();
  });

  it('does not auto-complete when stop is already closed', () => {
    const r = resolveCompletePrompt({
      isLeader: true,
      missingMemberNames: [],
      allArrived: true,
      stopAlreadyComplete: true,
      arrivedCount: 2,
      totalCount: 2,
    });
    expect(r.kind).toBe('none');
  });

  it('never auto-completes empty roster (MapScreen totalCount=0 shape)', () => {
    // MapScreen: allArrived = missing.length === 0 && totalCount > 0 → false when empty.
    const r = resolveCompletePrompt({
      isLeader: true,
      missingMemberNames: [],
      allArrived: false,
      stopAlreadyComplete: false,
      arrivedCount: 0,
      totalCount: 0,
    });
    expect(r.kind).toBe('none');
    // Even if a caller incorrectly sets allArrived true with total 0.
    expect(
      resolveCompletePrompt({
        isLeader: true,
        missingMemberNames: [],
        allArrived: true,
        stopAlreadyComplete: false,
        arrivedCount: 0,
        totalCount: 0,
      }).kind,
    ).toBe('none');
  });

  it('confirms with arrived x/x counts when members are missing', () => {
    const r = resolveCompletePrompt({
      isLeader: true,
      missingMemberNames: ['小明', '小華'],
      allArrived: false,
      stopAlreadyComplete: false,
      arrivedCount: 1,
      totalCount: 3,
    });
    expect(r.kind).toBe('leader_missing_members');
    expect(r.arrivedCount).toBe(1);
    expect(r.totalCount).toBe(3);
    // zh product defaults (MapScreen i18ns via keys + counts).
    expect(r.message).toBe('已抵達成員（1/3），是否要完成此集合點？');
    expect(r.title).toBe('完成集合點');
    expect(r.confirmLabel).toBe('完成');
    expect(r.cancelLabel).toBe('取消');
    expect(r.deferLabel).toBe('取消');
    // Superseded legacy copy.
    expect(r.message).not.toContain('先不要完成');
    expect(r.message).not.toContain('小明');
  });

  it('asks members only when the leader already completed the stop', () => {
    expect(
      resolveCompletePrompt({
        isLeader: false,
        missingMemberNames: [],
        allArrived: false,
        stopAlreadyComplete: false,
      }).kind,
    ).toBe('none');

    const r = resolveCompletePrompt({
      isLeader: false,
      missingMemberNames: [],
      allArrived: false,
      stopAlreadyComplete: true,
    });
    expect(r.kind).toBe('member_leader_already_done');
    expect(r.confirmLabel).toBe('確認');
  });
});

describe('deriveScopedArrivalCounts', () => {
  const members = [
    { userId: 'a', name: 'Alice', subgroupId: null as string | null },
    { userId: 'b', name: 'Bob', subgroupId: null as string | null },
    { userId: 'c', name: 'Cara', subgroupId: 'sg1' },
  ];

  it('scopes main-group stops to main-group members only', () => {
    const r = deriveScopedArrivalCounts({
      members,
      destinationSubgroupId: null,
      arrivedUserIds: ['a'],
    });
    expect(r.totalCount).toBe(2);
    expect(r.arrivedCount).toBe(1);
    expect(r.missingMemberNames).toEqual(['Bob']);
    expect(r.allArrived).toBe(false);
  });

  it('scopes subgroup stops and ignores main-group peers', () => {
    const r = deriveScopedArrivalCounts({
      members,
      destinationSubgroupId: 'sg1',
      arrivedUserIds: ['c'],
    });
    expect(r.totalCount).toBe(1);
    expect(r.arrivedCount).toBe(1);
    expect(r.allArrived).toBe(true);
    expect(r.missingMemberNames).toEqual([]);
  });

  it('includeUserId covers post-write self before workflow reloads', () => {
    const r = deriveScopedArrivalCounts({
      members,
      destinationSubgroupId: null,
      arrivedUserIds: ['b'],
      includeUserId: 'a',
    });
    expect(r.arrivedCount).toBe(2);
    expect(r.allArrived).toBe(true);
  });

  it('empty scoped roster is not all-arrived', () => {
    const r = deriveScopedArrivalCounts({
      members: [],
      destinationSubgroupId: null,
      arrivedUserIds: [],
    });
    expect(r.totalCount).toBe(0);
    expect(r.allArrived).toBe(false);
  });
});

describe('shouldAutoCompleteStop', () => {
  it.each([
    {
      name: 'leader all arrived',
      input: { isLeader: true, allArrived: true, stopAlreadyComplete: false, totalCount: 2 },
      expected: true,
    },
    {
      name: 'missing members',
      input: { isLeader: true, allArrived: false, stopAlreadyComplete: false, totalCount: 2 },
      expected: false,
    },
    {
      name: 'already closed',
      input: { isLeader: true, allArrived: true, stopAlreadyComplete: true, totalCount: 2 },
      expected: false,
    },
    {
      name: 'empty roster',
      input: { isLeader: true, allArrived: true, stopAlreadyComplete: false, totalCount: 0 },
      expected: false,
    },
    {
      name: 'member never auto',
      input: { isLeader: false, allArrived: true, stopAlreadyComplete: false, totalCount: 2 },
      expected: false,
    },
  ])('$name → $expected', ({ input, expected }) => {
    expect(shouldAutoCompleteStop(input)).toBe(expected);
  });
});

describe('history projection + avatar merge', () => {
  it('lets leaders see all rows; members only their own', () => {
    const rows = [
      { id: '1', userId: 'a' },
      { id: '2', userId: 'b' },
    ];
    expect(projectHistoryForViewer(rows, { viewerId: 'a', isGroupLeader: true })).toHaveLength(2);
    expect(projectHistoryForViewer(rows, { viewerId: 'a', isGroupLeader: false })).toEqual([
      { id: '1', userId: 'a' },
    ]);
  });

  it('merges cached avatars under live empty slots', () => {
    expect(
      mergeAvatarProfiles(
        [{}, { avatar: '🦊' }],
        [{ avatar: '🐑', avatarColor: '#111' }, { avatar: 'old' }],
      ),
    ).toEqual([
      { avatar: '🐑', avatarColor: '#111' },
      { avatar: '🦊', avatarColor: undefined },
    ]);
  });

  it('exports leader completed notice copy', () => {
    expect(LEADER_COMPLETED_NOTICE).toContain('隊長已完成');
  });
});
