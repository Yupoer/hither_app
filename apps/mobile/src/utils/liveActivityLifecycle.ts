/**
 * Generation-aware Live Activity start/stop reconciler (#146).
 *
 * Serializes native start/end work and ignores stale async completions so an
 * older close cannot end-all a newer journey's activity.
 */

export type ObservedLiveActivity = {
  activityId: string;
  pushToken?: string;
  navigationSessionId?: string;
  destinationId?: string;
};

export type LiveActivityLifecycleApi = {
  endGroupActivity: (activityId: string) => Promise<void>;
  endAllGroupActivities: () => Promise<void>;
  startGroupActivity: (intent: LiveActivityStartIntent) => Promise<{ activityId: string; pushToken?: string } | null>;
  deleteSession: (activityId: string) => Promise<void>;
  deleteAllSessions: () => Promise<void>;
  /** Optional Android permission gate; return false to abort start. */
  ensureStartPermission?: () => Promise<boolean>;
  /** Observed / PTS activities already on device. Adopt before local start. */
  listGroupActivities?: () => Promise<ObservedLiveActivity[]>;
};

export type LiveActivityStartIntent = {
  kind: 'start';
  destinationId: string;
  navigationSessionId?: string;
};

export type LiveActivityStopIntent = {
  kind: 'stop';
  /** When true, also wipe DB sessions (user disabled / journey fully off). */
  clearSessions: boolean;
};

export type LiveActivityIntent = LiveActivityStartIntent | LiveActivityStopIntent;

async function settle(task: Promise<unknown>): Promise<void> {
  try {
    await task;
  } catch {
    // Native / session cleanup is best-effort.
  }
}

export class LiveActivityLifecycleReconciler {
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();
  private handle: string | null = null;
  private destinationId: string | null = null;
  private navigationSessionId: string | null = null;
  private desiredIntent: LiveActivityIntent | null = null;
  private pushToken: string | undefined;

  constructor(private readonly api: LiveActivityLifecycleApi) {}

  get currentHandle(): string | null {
    return this.handle;
  }

  get currentDestinationId(): string | null {
    return this.destinationId;
  }

  get currentNavigationSessionId(): string | null {
    return this.navigationSessionId;
  }

  ownsScope(destinationId: string, navigationSessionId?: string): boolean {
    return this.destinationId === destinationId
      && this.navigationSessionId === (navigationSessionId ?? null);
  }

  get currentPushToken(): string | undefined {
    return this.pushToken;
  }

  /**
   * ActivityKit token rotation for the active activity.
   * Updates the bound handle push token without bumping
   * generation or starting a new activity. Ignores tokens for a different
   * live handle so a stale event cannot clobber a newer journey.
   */
  adoptPushToken(activityId: string, pushToken: string | undefined): boolean {
    if (!activityId || !pushToken) return false;
    if (!this.handle || this.handle !== activityId) return false;
    this.pushToken = pushToken;
    return true;
  }

  /**
   * Observe-existing path: bind a recovered native activity to this reconciler
   * when we have no handle yet, or when the id already matches.
   */
  adoptObservedActivity(opts: {
    activityId: string;
    pushToken?: string;
    destinationId?: string | null;
    navigationSessionId?: string | null;
  }): boolean {
    if (!opts.activityId || !opts.destinationId) return false;
    if (this.desiredIntent?.kind === 'stop') return false;
    if (this.desiredIntent?.kind === 'start' && (opts.destinationId !== this.desiredIntent.destinationId
      || (opts.navigationSessionId ?? null) !== (this.desiredIntent.navigationSessionId ?? null))) return false;
    if (this.handle && this.handle !== opts.activityId) return false;
    this.handle = opts.activityId;
    if (opts.pushToken) this.pushToken = opts.pushToken;
    this.destinationId = opts.destinationId;
    this.navigationSessionId = opts.navigationSessionId ?? null;
    return true;
  }

  /** Bump generation so any in-flight work becomes stale after this call. */
  private nextGeneration(): number {
    this.generation += 1;
    return this.generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  private async listExisting(): Promise<ObservedLiveActivity[]> {
    try {
      return (await this.api.listGroupActivities?.()) ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Enqueue intent. Concurrent requests serialize; only the latest generation
   * may mutate handle / call end-all after awaits.
   */
  request(intent: LiveActivityIntent): Promise<void> {
    this.desiredIntent = intent;
    const generation = this.nextGeneration();
    const run = settle(this.queue).then(() => this.execute(generation, intent));
    this.queue = settle(run);
    return run;
  }

  private async execute(
    generation: number,
    intent: LiveActivityIntent,
  ): Promise<void> {
    if (!this.isCurrent(generation)) return;

    if (intent.kind === 'stop') {
      await this.stop(generation, intent.clearSessions);
      return;
    }

    // A new session at the same destination requires a new native owner.
    if (this.handle && this.ownsScope(intent.destinationId, intent.navigationSessionId)) return;

    if (this.api.ensureStartPermission) {
      const ok = await this.api.ensureStartPermission();
      if (!this.isCurrent(generation) || !ok) return;
    }

    const existing = await this.listExisting();
    if (!this.isCurrent(generation)) return;
    const primary = existing.find(row => !!intent.navigationSessionId && row.destinationId === intent.destinationId
      && (row.navigationSessionId ?? null) === (intent.navigationSessionId ?? null))
      ?? (this.handle && this.ownsScope(intent.destinationId, intent.navigationSessionId)
        ? { activityId: this.handle, destinationId: this.destinationId ?? undefined,
            navigationSessionId: this.navigationSessionId ?? undefined, pushToken: this.pushToken }
        : undefined);
    // Unknown scope cannot be assigned the current intent by guesswork. End it
    // alongside known mismatches so an older native snapshot cannot be adopted.
    const orphanIds = new Set(existing.filter(row => row.activityId !== primary?.activityId).map(row => row.activityId));
    if (this.handle && this.handle !== primary?.activityId) orphanIds.add(this.handle);
    // Reserve the matching handle during orphan cleanup so a concurrent token
    // event for a sibling cannot replace the selected owner.
    this.handle = primary?.activityId ?? null;
    this.pushToken = primary?.pushToken;
    this.destinationId = primary?.destinationId ?? null;
    this.navigationSessionId = primary?.navigationSessionId ?? null;
    for (const id of orphanIds) {
      if (!this.isCurrent(generation)) return;
      await settle(this.api.endGroupActivity(id));
      await settle(this.api.deleteSession(id));
    }
    if (!this.isCurrent(generation)) return;
    if (primary) {
      this.adoptObservedActivity(primary);
      return;
    }

    await settle(this.api.endAllGroupActivities());
    if (!this.isCurrent(generation)) return;

    let result: { activityId: string; pushToken?: string } | null = null;
    try {
      result = await this.api.startGroupActivity(intent);
    } catch {
      if (!this.isCurrent(generation)) return;
      // Stale destination/handle refs must not block a later start.
      this.handle = null;
      this.destinationId = null;
      this.navigationSessionId = null;
      this.pushToken = undefined;
      return;
    }
    if (!this.isCurrent(generation)) {
      // Newer intent owns lifecycle — do not end-all (would kill the new one).
      if (result?.activityId) {
        await settle(this.api.endGroupActivity(result.activityId));
        await settle(this.api.deleteSession(result.activityId));
      }
      return;
    }
    if (!result) {
      // Allow retry on next request even if destination matches.
      this.handle = null;
      this.destinationId = null;
      this.navigationSessionId = null;
      return;
    }
    this.handle = result.activityId;
    this.pushToken = result.pushToken;
    this.destinationId = intent.destinationId;
    this.navigationSessionId = intent.navigationSessionId ?? null;
  }

  private async stop(generation: number, clearSessions: boolean): Promise<void> {
    const activityId = this.handle;
    this.handle = null;
    this.destinationId = null;
    this.navigationSessionId = null;
    this.pushToken = undefined;

    if (activityId) {
      await settle(this.api.endGroupActivity(activityId));
      await settle(this.api.deleteSession(activityId));
      if (!this.isCurrent(generation)) return;
    }

    await settle(this.api.endAllGroupActivities());
    if (!this.isCurrent(generation)) return;

    if (clearSessions) {
      await settle(this.api.deleteAllSessions());
    }
  }

  /** Unmount / hard clear without generation gating for the final flush. */
  async dispose(): Promise<void> {
    this.desiredIntent = { kind: 'stop', clearSessions: false };
    const generation = this.nextGeneration();
    await this.stop(generation, false);
  }
}
