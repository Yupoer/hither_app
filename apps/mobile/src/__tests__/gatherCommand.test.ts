import {
  LEADER_COMPLETED_NOTICE,
  mergeAvatarProfiles,
  projectHistoryForViewer,
  resolveCompletePrompt,
  resolveNavCommand,
} from '../utils/gatherCommand';

describe('resolveNavCommand', () => {
  it('gives leaders start/stop nav only (never path-plan labels)', () => {
    expect(
      resolveNavCommand({
        isLeader: true,
        personallyArrived: false,
        flockNavigatingThis: false,
        localRouteThis: false,
        pendingComplete: false,
      }),
    ).toMatchObject({ kind: 'leader_start', label: '導航', action: 'start_nav' });

    expect(
      resolveNavCommand({
        isLeader: true,
        personallyArrived: false,
        flockNavigatingThis: true,
        localRouteThis: false,
        pendingComplete: false,
      }),
    ).toMatchObject({ kind: 'leader_stop', label: '結束導航', action: 'stop_nav' });
  });

  it('shows 標註完成 after leader defers complete while still arrived', () => {
    expect(
      resolveNavCommand({
        isLeader: true,
        personallyArrived: true,
        flockNavigatingThis: false,
        localRouteThis: false,
        pendingComplete: true,
      }),
    ).toMatchObject({
      kind: 'leader_mark_complete',
      label: '標註完成',
      action: 'mark_complete',
      disabled: false,
    });
  });

  it('gives members path plan / close plan, never 導航', () => {
    const plan = resolveNavCommand({
      isLeader: false,
      personallyArrived: false,
      flockNavigatingThis: false,
      localRouteThis: false,
      pendingComplete: false,
    });
    expect(plan).toMatchObject({ kind: 'member_plan', label: '路徑規劃', disabled: false });
    expect(plan.label).not.toBe('導航');

    expect(
      resolveNavCommand({
        isLeader: false,
        personallyArrived: false,
        flockNavigatingThis: false,
        localRouteThis: true,
        pendingComplete: false,
      }),
    ).toMatchObject({ kind: 'member_close_plan', label: '關閉路線圖' });
  });

  it('disables member control as 導航中 while leader navigates', () => {
    expect(
      resolveNavCommand({
        isLeader: false,
        personallyArrived: false,
        flockNavigatingThis: true,
        localRouteThis: true,
        pendingComplete: false,
      }),
    ).toMatchObject({
      kind: 'member_navigating',
      label: '導航中',
      disabled: true,
      action: 'none',
    });
  });

  it('hides nav control once the viewer has arrived', () => {
    expect(
      resolveNavCommand({
        isLeader: false,
        personallyArrived: true,
        flockNavigatingThis: true,
        localRouteThis: false,
        pendingComplete: false,
      }).kind,
    ).toBe('hidden');
  });
});

describe('resolveCompletePrompt', () => {
  it('prompts leader when everyone arrived', () => {
    const r = resolveCompletePrompt({
      isLeader: true,
      missingMemberNames: [],
      allArrived: true,
      stopAlreadyComplete: false,
    });
    expect(r.kind).toBe('leader_all_arrived');
    expect(r.message).toContain('所有隊員都已抵達');
    expect(r.confirmLabel).toBe('已完成此集合點');
    expect(r.deferLabel).toBe('先不要完成');
  });

  it('names missing members for the leader', () => {
    const r = resolveCompletePrompt({
      isLeader: true,
      missingMemberNames: ['小明', '小華'],
      allArrived: false,
      stopAlreadyComplete: false,
    });
    expect(r.kind).toBe('leader_missing_members');
    expect(r.message).toContain('小明');
    expect(r.message).toContain('小華');
    expect(r.deferLabel).toBe('先不要完成');
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

  it('keeps the leader-completed notice copy stable', () => {
    expect(LEADER_COMPLETED_NOTICE).toContain('隊長已完成此卡片');
  });
});
