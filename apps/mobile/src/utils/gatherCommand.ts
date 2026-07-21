/**
 * Pure decision helpers for gathering-card command-row labels and
 * complete-stop prompts. MapScreen wires I/O; Jest drives these without
 * mounting the full map.
 */

export type NavCommandKind =
  | 'leader_start'
  | 'leader_stop'
  | 'leader_mark_complete'
  | 'member_plan'
  | 'member_close_plan'
  | 'member_navigating'
  | 'member_waiting_complete'
  | 'hidden';

export interface NavCommandInput {
  isLeader: boolean;
  /** Viewer already marked arrived at this stop. */
  personallyArrived: boolean;
  /** Shared flock navigation targets this stop (leader session active). */
  flockNavigatingThis: boolean;
  /** Local member route plan is drawn for this stop. */
  localRouteThis: boolean;
  /**
   * Leader deferred completing the stop after arrival — still shows
   * 「完成此行程」 so they can finish later without undoing arrival.
   */
  pendingComplete: boolean;
}

export interface NavCommandResult {
  kind: NavCommandKind;
  /** Display label (zh) used by UI and contracts. */
  label: string;
  disabled: boolean;
  /** Whether pressing starts/stops shared nav, local plan, or complete. */
  action: 'start_nav' | 'stop_nav' | 'start_plan' | 'close_plan' | 'mark_complete' | 'none';
}

/**
 * Derive per-card flock vs local-route flags from shared session + local plan.
 * MapScreen must use this so local 路徑規劃 is not misclassified as 導航中
 * (journeyActive is true for local plans too).
 */
export function deriveCardNavFlags(input: {
  destId: string;
  isLeader: boolean;
  /** Active shared navigation destination (session / legacy journey). */
  sharedTargetId: string | null | undefined;
  /** Member-only local path-plan destination. */
  localTargetId: string | null | undefined;
  /** Leader optimistic target while startSession is in flight. */
  pendingLeaderTargetId?: string | null;
  journeyBusy?: boolean;
}): { flockNavigatingThis: boolean; localRouteThis: boolean } {
  const {
    destId,
    isLeader,
    sharedTargetId = null,
    localTargetId = null,
    pendingLeaderTargetId = null,
    journeyBusy = false,
  } = input;
  const flockNavigatingThis =
    sharedTargetId === destId
    || (isLeader && journeyBusy && pendingLeaderTargetId === destId);
  // Local plan only when this stop is the member's plan AND not the shared target.
  const localRouteThis =
    !isLeader
    && localTargetId === destId
    && sharedTargetId !== destId;
  return { flockNavigatingThis, localRouteThis };
}

/**
 * Resolve the primary navigation/path control for one gather card.
 */
export function resolveNavCommand(input: NavCommandInput): NavCommandResult {
  const {
    isLeader,
    personallyArrived,
    flockNavigatingThis,
    localRouteThis,
    pendingComplete,
  } = input;

  if (isLeader) {
    // Arrive ≠ complete: once the leader has arrived, offer complete (not hide).
    if (personallyArrived) {
      return {
        kind: 'leader_mark_complete',
        // Short label for the command-row chip; a11y can use a longer phrase.
        label: '完成',
        disabled: false,
        action: 'mark_complete',
      };
    }
    if (flockNavigatingThis) {
      return {
        kind: 'leader_stop',
        label: '結束',
        disabled: false,
        action: 'stop_nav',
      };
    }
    return {
      kind: 'leader_start',
      label: '導航',
      disabled: false,
      action: 'start_nav',
    };
  }

  // Member: arrived → wait for leader to complete the stop (personal check-in only).
  if (personallyArrived) {
    return {
      kind: 'member_waiting_complete',
      label: '正在等待隊長完成此行程',
      disabled: true,
      action: 'none',
    };
  }
  if (flockNavigatingThis) {
    return {
      kind: 'member_navigating',
      label: '導航中',
      disabled: true,
      action: 'none',
    };
  }
  if (localRouteThis) {
    return {
      kind: 'member_close_plan',
      // Match leader stop + iOS chip: short "結束" (not "關閉").
      label: '結束',
      disabled: false,
      action: 'close_plan',
    };
  }
  return {
    kind: 'member_plan',
    label: '路徑',
    disabled: false,
    action: 'start_plan',
  };
}

export interface CompletePromptInput {
  isLeader: boolean;
  /** Member names who have not arrived at this stop (display order). */
  missingMemberNames: string[];
  /** True when every current member already has an arrival row. */
  allArrived: boolean;
  /** Destination already closed / completed by leader. */
  stopAlreadyComplete: boolean;
}

export type CompletePromptKind =
  | 'leader_all_arrived'
  | 'leader_missing_members'
  | 'member_leader_already_done'
  | 'none';

export interface CompletePromptResult {
  kind: CompletePromptKind;
  title: string;
  message: string;
  confirmLabel: string;
  /** Secondary "not yet" — only for leader. */
  deferLabel: string | null;
}

/**
 * After the viewer marks arrived (and nav stopped), decide which complete-stop
 * prompt to show. Pure strings so tests can lock copy without i18n.
 */
export function resolveCompletePrompt(input: CompletePromptInput): CompletePromptResult {
  if (input.isLeader) {
    if (input.allArrived || input.missingMemberNames.length === 0) {
      return {
        kind: 'leader_all_arrived',
        title: '已完成',
        message: '已抵達此集合點，是否要完成？所有隊員都已抵達。',
        confirmLabel: '已完成此集合點',
        deferLabel: '先不要完成',
      };
    }
    const names = input.missingMemberNames.join('、');
    return {
      kind: 'leader_missing_members',
      title: '已完成',
      message: `已抵達此集合點，是否要完成？現在還有 ${names} 還沒抵達。`,
      confirmLabel: '完成集合點',
      deferLabel: '先不要完成',
    };
  }

  if (input.stopAlreadyComplete) {
    return {
      kind: 'member_leader_already_done',
      title: '完成此集合點？',
      message: '隊長已完成此集合點。確認後卡片會移至歷史行程。',
      confirmLabel: '確認',
      deferLabel: null,
    };
  }

  return {
    kind: 'none',
    title: '',
    message: '',
    confirmLabel: '',
    deferLabel: null,
  };
}

/** Non-arrived member notice when leader force-completes the stop. */
export const LEADER_COMPLETED_NOTICE =
  '隊長已完成此卡片，將前往下一個集合點';

/**
 * Project visited-waypoint rows for the current viewer.
 * Server RLS is authoritative; this is defense-in-depth for offline/demo.
 */
export function projectHistoryForViewer<T extends { userId?: string }>(
  rows: T[],
  options: {
    viewerId: string | undefined | null;
    /** True when the viewer is currently leader of the row's group. */
    isGroupLeader: boolean;
  },
): T[] {
  if (!options.viewerId) return [];
  if (options.isGroupLeader) return rows;
  return rows.filter((row) => row.userId === options.viewerId);
}

/**
 * Merge cached avatar profiles into a list that may have empty profiles
 * (e.g. RoleSelect lite fetch). Live non-empty profiles win.
 */
export function mergeAvatarProfiles(
  live: { avatar?: string; avatarColor?: string }[],
  cached: { avatar?: string; avatarColor?: string }[] | undefined | null,
): { avatar?: string; avatarColor?: string }[] {
  if (!cached || cached.length === 0) return live;
  if (live.length === 0) return cached.slice();
  const max = Math.max(live.length, cached.length);
  const out: { avatar?: string; avatarColor?: string }[] = [];
  for (let i = 0; i < max; i++) {
    const l = live[i];
    const c = cached[i];
    if (!l) {
      if (c) out.push({ ...c });
      continue;
    }
    out.push({
      avatar: l.avatar || c?.avatar,
      avatarColor: l.avatarColor || c?.avatarColor,
    });
  }
  return out;
}
