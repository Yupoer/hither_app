/**
 * Generation-aware Live Activity start/stop reconciler (#146).
 *
 * Serializes native start/end work and ignores stale async completions so an
 * older close cannot end-all a newer journey's activity.
 */

export type LiveActivityLifecycleApi = {
  endGroupActivity: (activityId: string) => Promise<void>;
  endAllGroupActivities: () => Promise<void>;
  startGroupActivity: () => Promise<{ activityId: string; pushToken?: string } | null>;
  deleteSession: (activityId: string) => Promise<void>;
  deleteAllSessions: () => Promise<void>;
  /** Optional Android permission gate; return false to abort start. */
  ensureStartPermission?: () => Promise<boolean>;
};

export type LiveActivityStartIntent = {
  kind: 'start';
  destinationId: string;
};

export type LiveActivityStopIntent = {
  kind: 'stop';
  /** When true, also wipe DB sessions (user disabled / journey fully off). */
  clearSessions: boolean;
};

export type LiveActivityIntent = LiveActivityStartIntent | LiveActivityStopIntent;

export class LiveActivityLifecycleReconciler {
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();
  private handle: string | null = null;
  private destinationId: string | null = null;
  private pushToken: string | undefined;

  constructor(private readonly api: LiveActivityLifecycleApi) {}

  get currentHandle(): string | null {
    return this.handle;
  }

  get currentDestinationId(): string | null {
    return this.destinationId;
  }

  get currentPushToken(): string | undefined {
    return this.pushToken;
  }

  /** Bump generation so any in-flight work becomes stale after this call. */
  private nextGeneration(): number {
    this.generation += 1;
    return this.generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  /**
   * Enqueue intent. Concurrent requests serialize; only the latest generation
   * may mutate handle / call end-all after awaits.
   */
  request(intent: LiveActivityIntent): Promise<void> {
    const generation = this.nextGeneration();
    const run = this.queue
      .catch(() => undefined)
      .then(() => this.execute(generation, intent));
    this.queue = run.catch(() => undefined);
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

    // Already running for this destination — self-heal only if handle missing.
    if (
      this.handle
      && this.destinationId === intent.destinationId
    ) {
      return;
    }

    if (this.api.ensureStartPermission) {
      const ok = await this.api.ensureStartPermission();
      if (!this.isCurrent(generation)) return;
      if (!ok) return;
    }

    // Tear down previous destination / stale handle before start.
    const previousId = this.handle;
    this.handle = null;
    this.pushToken = undefined;
    this.destinationId = intent.destinationId;

    if (previousId) {
      await this.api.endGroupActivity(previousId).catch(() => undefined);
      await this.api.deleteSession(previousId).catch(() => undefined);
      if (!this.isCurrent(generation)) return;
    }

    await this.api.endAllGroupActivities().catch(() => undefined);
    if (!this.isCurrent(generation)) return;

    let result: { activityId: string; pushToken?: string } | null = null;
    try {
      result = await this.api.startGroupActivity();
    } catch {
      // Stale destination/handle refs must not block a later start.
      this.handle = null;
      this.destinationId = null;
      this.pushToken = undefined;
      return;
    }
    if (!this.isCurrent(generation)) {
      // Newer intent owns lifecycle — do not end-all (would kill the new one).
      if (result?.activityId) {
        await this.api.endGroupActivity(result.activityId).catch(() => undefined);
        await this.api.deleteSession(result.activityId).catch(() => undefined);
      }
      return;
    }
    if (!result) {
      // Allow retry on next request even if destination matches.
      this.handle = null;
      this.destinationId = null;
      return;
    }
    this.handle = result.activityId;
    this.pushToken = result.pushToken;
    this.destinationId = intent.destinationId;
  }

  private async stop(generation: number, clearSessions: boolean): Promise<void> {
    const activityId = this.handle;
    this.handle = null;
    this.destinationId = null;
    this.pushToken = undefined;

    if (activityId) {
      await this.api.endGroupActivity(activityId).catch(() => undefined);
      await this.api.deleteSession(activityId).catch(() => undefined);
      if (!this.isCurrent(generation)) return;
    }

    await this.api.endAllGroupActivities().catch(() => undefined);
    if (!this.isCurrent(generation)) return;

    if (clearSessions) {
      await this.api.deleteAllSessions().catch(() => undefined);
    }
  }

  /** Unmount / hard clear without generation gating for the final flush. */
  async dispose(): Promise<void> {
    const generation = this.nextGeneration();
    await this.stop(generation, false);
  }
}
