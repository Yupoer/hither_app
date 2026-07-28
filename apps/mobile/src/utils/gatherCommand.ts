/**
 * Pure decision helpers for gathering-card command-row labels and
 * complete-stop prompts. MapScreen wires I/O; Jest drives these without
 * mounting the full map.
 *
 * OTA-01 team semantics: only Start + End are pressable on the flock
 * control; 「前往中」 is display-only. Personal path-plan remains member-only
 * and never rewrites team phase (see teamGatheringState).
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
   * OTA-01: this card is the next pending point while global phase is staying.
   * When false, leader Start is not pressable. Omit to keep legacy always-start.
   */
  isNextTeamPending?: boolean;
  /**
   * OTA-01: team cannot Start (active session, en_route elsewhere, or not next).
   * Prefer this over teamEnRouteElsewhere alone.
   */
  teamStartBlocked?: boolean;
  /** @deprecated Prefer teamStartBlocked. */
  teamEnRouteElsewhere?: boolean;
}

export interface NavCommandResult {
  kind: NavCommandKind;
  /** Display label (zh) used by UI and contracts. */
  label: string;
  disabled: boolean;
  /**
   * Whether pressing starts shared nav, ends (pauses) flock travel,
   * runs a member-only path plan, or completes after personal arrival.
   * Leader End = pause navigation only (point stays on itinerary).
   * Completing a stop is a separate prompt/RPC (complete_gathering_stop).
   * Member path-plan still uses close_plan.
   */
  action: 'start_nav' | 'start_plan' | 'close_plan' | 'mark_complete' | 'end_point' | 'none';
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
    isNextTeamPending,
    teamStartBlocked,
    teamEnRouteElsewhere,
  } = input;

  if (isLeader) {
    // Active flock travel always offers End first (pause team navigation).
    if (flockNavigatingThis) {
      return {
        kind: 'leader_stop',
        label: '結束',
        disabled: false,
        action: 'end_point',
      };
    }
    // After personal arrival + 「取消」on complete confirm, keep Complete available.
    // Must not fall back to Start for the same arrived stop.
    if (personallyArrived) {
      return {
        kind: 'leader_mark_complete',
        label: '完成',
        disabled: false,
        action: 'mark_complete',
      };
    }
    return {
      kind: 'leader_start',
      label: '開始',
      disabled: false,
      action: 'start_nav',
    };
  }

  // Member: arrived → wait for leader to complete the stop (personal check-in only).
  if (personallyArrived) {
    return {
      kind: 'member_waiting_complete',
      label: '等待隊長完成',
      disabled: true,
      action: 'none',
    };
  }
  if (flockNavigatingThis) {
    return {
      kind: 'member_navigating',
      // OTA-01: display-only team travelling state (not a second Start).
      label: '前往中',
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

/**
 * Members whose subgroup scope matches the destination.
 * Main-group stops (`subgroupId` null/undefined) only count main-group members.
 */
export function membersInDestinationScope<T extends { subgroupId?: string | null }>(
  members: readonly T[],
  destinationSubgroupId: string | null | undefined,
): T[] {
  return members.filter((m) => m.subgroupId === destinationSubgroupId);
}

/**
 * Derive arrived/missing counts for complete-stop decisions from scoped members.
 * Pure seam for tests (subgroup vs main, empty roster, include-self after local write).
 */
export function deriveScopedArrivalCounts(input: {
  members: readonly { userId: string; name?: string | null; subgroupId?: string | null }[];
  destinationSubgroupId: string | null | undefined;
  arrivedUserIds: ReadonlySet<string> | readonly string[];
  /** Force-include a user id (e.g. self after successful local arrival write). */
  includeUserId?: string | null;
  travelerFallback?: string;
}): {
  scopedMembers: { userId: string; name?: string | null; subgroupId?: string | null }[];
  arrivedCount: number;
  totalCount: number;
  missingMemberNames: string[];
  allArrived: boolean;
} {
  const arrived = input.arrivedUserIds instanceof Set
    ? new Set(input.arrivedUserIds)
    : new Set(input.arrivedUserIds);
  if (input.includeUserId) arrived.add(input.includeUserId);

  const scopedMembers = membersInDestinationScope(
    input.members,
    input.destinationSubgroupId,
  );
  const fallback = input.travelerFallback ?? 'Traveler';
  const missingMemberNames = scopedMembers
    .filter((m) => !arrived.has(m.userId))
    .map((m) => m.name?.trim() || fallback);
  const totalCount = scopedMembers.length;
  const arrivedCount = scopedMembers.filter((m) => arrived.has(m.userId)).length;
  return {
    scopedMembers,
    arrivedCount,
    totalCount,
    missingMemberNames,
    allArrived: totalCount > 0 && missingMemberNames.length === 0,
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
  /** Members who have arrived (include self when just marked). */
  arrivedCount?: number;
  /** Scoped member total for x/x copy. */
  totalCount?: number;
}

/**
 * - auto_complete: leader, everyone arrived → run complete-stop, no confirm UI
 * - leader_missing_members: manual confirm with arrived (x/x) copy
 * - member_leader_already_done: member notice when leader already closed
 * - none: no prompt
 */
export type CompletePromptKind =
  | 'auto_complete'
  | 'leader_missing_members'
  | 'member_leader_already_done'
  | 'none';

export interface CompletePromptResult {
  kind: CompletePromptKind;
  /** Arrived count for missing-members i18n / contracts (null when N/A). */
  arrivedCount: number | null;
  /** Total member count for missing-members i18n / contracts (null when N/A). */
  totalCount: number | null;
  /**
   * zh product-copy defaults for pure-string contracts. MapScreen should prefer
   * i18n keys (`gathering.completeMissing*`) built from arrivedCount/totalCount.
   */
  title: string;
  message: string;
  confirmLabel: string;
  /**
   * Dismiss / cancel (left). Destructive complete is confirmLabel.
   * null when no secondary action.
   */
  cancelLabel: string | null;
  /**
   * @deprecated Alias of cancelLabel — kept so older call sites that read
   * deferLabel still compile until fully migrated.
   */
  deferLabel: string | null;
}

const EMPTY_PROMPT: Omit<CompletePromptResult, 'kind'> = {
  arrivedCount: null,
  totalCount: null,
  title: '',
  message: '',
  confirmLabel: '',
  cancelLabel: null,
  deferLabel: null,
};

/**
 * Whether leader should auto-complete without a confirm dialog.
 * Pure seam for table-driven tests (all arrived + total > 0 + not already closed).
 */
export function shouldAutoCompleteStop(input: {
  isLeader: boolean;
  allArrived: boolean;
  stopAlreadyComplete: boolean;
  totalCount: number;
}): boolean {
  return (
    input.isLeader
    && !input.stopAlreadyComplete
    && input.totalCount > 0
    && input.allArrived
  );
}

/**
 * After the viewer marks arrived (and nav stopped), decide which complete-stop
 * prompt to show — or auto-complete with no UI.
 *
 * Spec 2026-07-28: auto only when arrivedCount === totalCount and totalCount > 0.
 * Empty roster (totalCount === 0) → none (never fabricate total=1).
 * Display strings: zh defaults for contracts; UI must i18n via counts.
 */
export function resolveCompletePrompt(input: CompletePromptInput): CompletePromptResult {
  if (input.isLeader) {
    // Already closed — never re-prompt or double-fire complete.
    if (input.stopAlreadyComplete) {
      return { kind: 'none', ...EMPTY_PROMPT };
    }

    const missing = input.missingMemberNames;
    const totalCount =
      typeof input.totalCount === 'number' && input.totalCount >= 0
        ? input.totalCount
        : typeof input.arrivedCount === 'number'
          ? input.arrivedCount + missing.length
          : missing.length;
    const arrivedCount =
      typeof input.arrivedCount === 'number'
        ? input.arrivedCount
        : Math.max(0, totalCount - missing.length);

    // Spec: totalCount > 0 required. Empty roster / unloaded members → none.
    if (totalCount <= 0) {
      return { kind: 'none', ...EMPTY_PROMPT };
    }

    // Prefer explicit allArrived; only infer from empty missing when roster non-empty.
    const allArrived =
      input.allArrived || (missing.length === 0 && totalCount > 0);

    if (
      shouldAutoCompleteStop({
        isLeader: true,
        allArrived,
        stopAlreadyComplete: false,
        totalCount,
      })
    ) {
      return {
        kind: 'auto_complete',
        ...EMPTY_PROMPT,
        arrivedCount,
        totalCount,
      };
    }

    // Someone still missing — manual confirm with x/x (zh defaults; UI i18ns).
    const arrived = Math.min(arrivedCount, totalCount);
    return {
      kind: 'leader_missing_members',
      arrivedCount: arrived,
      totalCount,
      title: '完成集合點',
      message: `已抵達成員（${arrived}/${totalCount}），是否要完成此集合點？`,
      confirmLabel: '完成',
      cancelLabel: '取消',
      deferLabel: '取消',
    };
  }

  if (input.stopAlreadyComplete) {
    return {
      kind: 'member_leader_already_done',
      arrivedCount: null,
      totalCount: null,
      title: '完成此集合點？',
      message: '隊長已完成此集合點。確認後卡片會移至歷史行程。',
      confirmLabel: '確認',
      cancelLabel: null,
      deferLabel: null,
    };
  }

  return { kind: 'none', ...EMPTY_PROMPT };
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
