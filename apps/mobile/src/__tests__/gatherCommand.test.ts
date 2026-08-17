import {
  applyLocalClosedAt,
  arrivalControlJustSplit,
  deriveCardNavFlags,
  deriveScopedArrivalCounts,
  LEADER_COMPLETED_NOTICE,
  mergeAvatarProfiles,
  planCompleteGatheringApply,
  projectHistoryForViewer,
  resolveCompletePrompt,
  resolveNavCommand,
  shouldAutoCompleteStop,
} from '../utils/gatherCommand';

describe('deriveCardNavFlags (shared MapScreen wiring inputs)', () => {
  it('does not treat a member card as shared navigation before start', () => {
    const flags = deriveCardNavFlags({
      destId: 'stop-a',
      isLeader: false,
      sharedTargetId: null,
    });
    expect(flags).toEqual({ flockNavigatingThis: false });
    expect(
      resolveNavCommand({
        isLeader: false,
        personallyArrived: false,
        ...flags,
      }),
    ).toMatchObject({
      kind: 'member_request_start',
      label: '向隊長發送要求開始',
      action: 'request_start',
    });
  });

  it('marks the active shared destination as navigating', () => {
    const flags = deriveCardNavFlags({
      destId: 'stop-a',
      isLeader: false,
      sharedTargetId: 'stop-a',
    });
    expect(flags).toEqual({ flockNavigatingThis: true });
    expect(
      resolveNavCommand({
        isLeader: false,
        personallyArrived: false,
        ...flags,
      }),
    ).toMatchObject({ kind: 'member_navigating', label: '前往中', disabled: true });
  });

  it('member requests the leader to start before shared navigation begins', () => {
    const flags = deriveCardNavFlags({
      destId: 'stop-a',
      isLeader: false,
      sharedTargetId: null,
    });
    expect(flags).toEqual({ flockNavigatingThis: false });
    expect(
      resolveNavCommand({
        isLeader: false,
        personallyArrived: false,
        ...flags,
      }),
    ).toMatchObject({
      kind: 'member_request_start',
      label: '向隊長發送要求開始',
      action: 'request_start',
    });
  });

  it('leader flock uses shared or pending busy target only', () => {
    expect(
      deriveCardNavFlags({
        destId: 'stop-a',
        isLeader: true,
        sharedTargetId: 'stop-a',
      }).flockNavigatingThis,
    ).toBe(true);
    expect(
      deriveCardNavFlags({
        destId: 'stop-a',
        isLeader: true,
        sharedTargetId: null,
        pendingLeaderTargetId: 'stop-a',
        journeyBusy: true,
      }).flockNavigatingThis,
    ).toBe(true);
    expect(
      deriveCardNavFlags({
        destId: 'stop-a',
        isLeader: true,
        sharedTargetId: null,
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
      }),
    ).toMatchObject({ kind: 'leader_start', label: '開始', action: 'start_nav' });

    expect(
      resolveNavCommand({
        isLeader: true,
        personallyArrived: false,
        flockNavigatingThis: true,
      }),
    ).toMatchObject({ kind: 'leader_stop', label: '結束', action: 'end_point' });
  });

  it('keeps leader Start pressable while the latest-intent queue owns gates', () => {
    expect(
      resolveNavCommand({
        isLeader: true,
        personallyArrived: false,
        flockNavigatingThis: false,
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
      }),
    ).toMatchObject({
      kind: 'leader_stop',
      label: '結束',
      action: 'end_point',
      disabled: false,
    });
  });


  it('gives members a start request before shared navigation', () => {
    const plan = resolveNavCommand({
      isLeader: false,
      personallyArrived: false,
      flockNavigatingThis: false,
    });
    expect(plan).toMatchObject({
      kind: 'member_request_start',
      label: '向隊長發送要求開始',
      disabled: false,
      action: 'request_start',
    });
    expect(plan.label).not.toBe('開始');

  });

  it('disables member control as travelling display while leader navigates', () => {
    expect(
      resolveNavCommand({
        isLeader: false,
        personallyArrived: false,
        flockNavigatingThis: true,
      }),
    ).toMatchObject({
      kind: 'member_navigating',
      label: '前往中',
      disabled: true,
      action: 'none',
    });
  });

  it('keeps the member control at 前往中 after personal arrival during the trip', () => {
    expect(
      resolveNavCommand({
        isLeader: false,
        personallyArrived: true,
        flockNavigatingThis: true,
      }),
    ).toMatchObject({
      kind: 'member_navigating',
      label: '前往中',
      disabled: true,
      action: 'none',
    });
  });

  it('shows waiting copy after shared navigation has ended', () => {
    expect(
      resolveNavCommand({
        isLeader: false,
        personallyArrived: true,
        flockNavigatingThis: false,
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
    expect(r.kind).toBe('already_complete');
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

describe('planCompleteGatheringApply (#195)', () => {
  it('always applies local closedAt, card exit, and history even when RPC is debounced', () => {
    expect(
      planCompleteGatheringApply({
        alreadyClosed: false,
        rpcInFlight: false,
        remoteAutoCompleted: false,
      }),
    ).toMatchObject({
      callRpc: true,
      applyLocalClosedAt: true,
      startCardExit: true,
      refreshHistory: true,
      reason: 'rpc',
    });
    expect(
      planCompleteGatheringApply({
        alreadyClosed: true,
        rpcInFlight: false,
        remoteAutoCompleted: true,
      }),
    ).toMatchObject({
      callRpc: false,
      applyLocalClosedAt: true,
      startCardExit: true,
      refreshHistory: true,
      reason: 'already_closed',
    });
    expect(
      planCompleteGatheringApply({
        alreadyClosed: false,
        rpcInFlight: false,
        remoteAutoCompleted: true,
      }),
    ).toMatchObject({
      callRpc: false,
      applyLocalClosedAt: true,
      startCardExit: true,
      refreshHistory: true,
      reason: 'rpc_debounced',
    });
  });

  it('stamps closedAt locally so a second 完成 is not a dead tap', () => {
    const next = applyLocalClosedAt(
      [{ id: 'd1', closedAt: null as string | null }, { id: 'd2' }],
      'd1',
      '2026-08-17T00:00:00.000Z',
    );
    expect(next[0].closedAt).toBe('2026-08-17T00:00:00.000Z');
    expect(next[1].closedAt).toBeUndefined();
  });
});

describe('arrivalControlJustSplit (#195 B1/B2)', () => {
  it('animates only the first Start→Arrived split, not expand remounts', () => {
    const seen = new Set<string>();
    expect(arrivalControlJustSplit('d1', true, seen)).toBe(true);
    expect(arrivalControlJustSplit('d1', true, seen)).toBe(false);
    expect(arrivalControlJustSplit('d1', false, seen)).toBe(false);
    expect(arrivalControlJustSplit('d1', true, seen)).toBe(true);
  });
});
