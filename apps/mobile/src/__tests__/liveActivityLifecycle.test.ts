import { LiveActivityLifecycleReconciler } from '../utils/liveActivityLifecycle';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('LiveActivityLifecycleReconciler (#146)', () => {
  it('ignores stale end-all when a newer start is in flight', async () => {
    const endAllCalls: number[] = [];
    const starts: string[] = [];
    const ends: string[] = [];

    const firstEndAll = deferred<void>();
    let endAllCount = 0;

    const api = {
      endGroupActivity: jest.fn(async (id: string) => {
        ends.push(id);
      }),
      endAllGroupActivities: jest.fn(async () => {
        endAllCount += 1;
        endAllCalls.push(endAllCount);
        if (endAllCount === 1) {
          await firstEndAll.promise;
        }
      }),
      startGroupActivity: jest.fn(async () => {
        const id = `act-${starts.length + 1}`;
        starts.push(id);
        return { activityId: id, pushToken: `tok-${id}` };
      }),
      deleteSession: jest.fn(async () => undefined),
      deleteAllSessions: jest.fn(async () => undefined),
    };

    const reconciler = new LiveActivityLifecycleReconciler(api);

    // Start A — blocks inside first endAll.
    const p1 = reconciler.request({ kind: 'start', destinationId: 'dest-a' });
    // Stop while start A is mid-flight.
    const p2 = reconciler.request({
      kind: 'stop',
      clearSessions: true,
    });
    // Start B — final intent.
    const p3 = reconciler.request({ kind: 'start', destinationId: 'dest-b' });

    // Unblock first endAll; generation is already past start-A.
    firstEndAll.resolve();
    await Promise.all([p1, p2, p3]);

    expect(reconciler.currentDestinationId).toBe('dest-b');
    expect(reconciler.currentHandle).toBe('act-1');
    // Only the latest start should have produced a live handle.
    expect(starts.length).toBe(1);
    // After start B, no later endAll should wipe without a newer stop.
    expect(api.deleteAllSessions).not.toHaveBeenCalled();
  });

  it('does not let a late stop clear a newer activity', async () => {
    const endAll = deferred<void>();
    let endAllN = 0;
    const ended: string[] = [];

    const api = {
      endGroupActivity: jest.fn(async (id: string) => {
        ended.push(id);
      }),
      endAllGroupActivities: jest.fn(async () => {
        endAllN += 1;
        if (endAllN === 1) await endAll.promise;
      }),
      startGroupActivity: jest.fn(async () => ({
        activityId: `id-${endAllN}`,
        pushToken: 't',
      })),
      deleteSession: jest.fn(async () => undefined),
      deleteAllSessions: jest.fn(async () => undefined),
    };

    const reconciler = new LiveActivityLifecycleReconciler(api);

    const stopP = reconciler.request({ kind: 'stop', clearSessions: true });
    const startP = reconciler.request({ kind: 'start', destinationId: 'd1' });

    endAll.resolve();
    await Promise.all([stopP, startP]);

    expect(reconciler.currentHandle).toBeTruthy();
    expect(reconciler.currentDestinationId).toBe('d1');
    // Late stop must not clear sessions after the newer start won.
    expect(api.deleteAllSessions).not.toHaveBeenCalled();
  });

  it('self-heals when start fails so a later start can proceed', async () => {
    let attempt = 0;
    const api = {
      endGroupActivity: jest.fn(async () => undefined),
      endAllGroupActivities: jest.fn(async () => undefined),
      startGroupActivity: jest.fn(async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('native mismatch');
        return { activityId: 'recovered', pushToken: 't' };
      }),
      deleteSession: jest.fn(async () => undefined),
      deleteAllSessions: jest.fn(async () => undefined),
    };

    const reconciler = new LiveActivityLifecycleReconciler(api);
    await reconciler.request({ kind: 'start', destinationId: 'd1' });
    expect(reconciler.currentHandle).toBeNull();

    await reconciler.request({ kind: 'start', destinationId: 'd1' });
    expect(reconciler.currentHandle).toBe('recovered');
  });

  it('fast off→on converges to a single activity for the latest destination', async () => {
    let n = 0;
    const api = {
      endGroupActivity: jest.fn(async () => undefined),
      endAllGroupActivities: jest.fn(async () => undefined),
      startGroupActivity: jest.fn(async () => {
        n += 1;
        return { activityId: `a${n}`, pushToken: `p${n}` };
      }),
      deleteSession: jest.fn(async () => undefined),
      deleteAllSessions: jest.fn(async () => undefined),
    };

    const reconciler = new LiveActivityLifecycleReconciler(api);
    await Promise.all([
      reconciler.request({ kind: 'start', destinationId: 'a' }),
      reconciler.request({ kind: 'stop', clearSessions: false }),
      reconciler.request({ kind: 'start', destinationId: 'b' }),
      reconciler.request({ kind: 'stop', clearSessions: false }),
      reconciler.request({ kind: 'start', destinationId: 'c' }),
    ]);

    expect(reconciler.currentDestinationId).toBe('c');
    expect(reconciler.currentHandle).toBeTruthy();
  });

  it('adopts push-token rotation for the active handle (#146 Sol)', async () => {
    const api = {
      endGroupActivity: jest.fn(async () => undefined),
      endAllGroupActivities: jest.fn(async () => undefined),
      startGroupActivity: jest.fn(async () => ({
        activityId: 'act-1',
        pushToken: 'tok-initial',
      })),
      deleteSession: jest.fn(async () => undefined),
      deleteAllSessions: jest.fn(async () => undefined),
    };
    const reconciler = new LiveActivityLifecycleReconciler(api);
    await reconciler.request({ kind: 'start', destinationId: 'd1' });
    expect(reconciler.currentPushToken).toBe('tok-initial');

    expect(reconciler.adoptPushToken('act-1', 'tok-rotated')).toBe(true);
    expect(reconciler.currentPushToken).toBe('tok-rotated');
    expect(reconciler.currentHandle).toBe('act-1');

    // Foreign activity must not clobber the live token.
    expect(reconciler.adoptPushToken('act-other', 'tok-evil')).toBe(false);
    expect(reconciler.currentPushToken).toBe('tok-rotated');
  });

  it('adopts observed existing activity when handle is missing', () => {
    const api = {
      endGroupActivity: jest.fn(async () => undefined),
      endAllGroupActivities: jest.fn(async () => undefined),
      startGroupActivity: jest.fn(async () => null),
      deleteSession: jest.fn(async () => undefined),
      deleteAllSessions: jest.fn(async () => undefined),
    };
    const reconciler = new LiveActivityLifecycleReconciler(api);
    expect(
      reconciler.adoptObservedActivity({
        activityId: 'recovered',
        pushToken: 'tok-obs',
        destinationId: 'd1',
      }),
    ).toBe(true);
    expect(reconciler.currentHandle).toBe('recovered');
    expect(reconciler.currentPushToken).toBe('tok-obs');
    expect(reconciler.currentDestinationId).toBe('d1');
  });

  it('adopts an observed PTS handle and ends orphan siblings instead of dual start (#194 A1)', async () => {
    const ended: string[] = [];
    const api = {
      endGroupActivity: jest.fn(async (id: string) => {
        ended.push(id);
      }),
      endAllGroupActivities: jest.fn(async () => undefined),
      startGroupActivity: jest.fn(async () => ({
        activityId: 'local-new',
        pushToken: 'tok-local',
      })),
      deleteSession: jest.fn(async () => undefined),
      deleteAllSessions: jest.fn(async () => undefined),
      listGroupActivities: jest.fn(async () => [
        { activityId: 'pts-primary', pushToken: 'tok-pts', destinationId: 'd1', navigationSessionId: 'nav-1' },
        { activityId: 'pts-orphan', pushToken: 'tok-orphan', destinationId: 'd1', navigationSessionId: 'nav-1' },
      ]),
    };
    const reconciler = new LiveActivityLifecycleReconciler(api);
    await reconciler.request({ kind: 'start', destinationId: 'd1', navigationSessionId: 'nav-1' });
    expect(reconciler.currentHandle).toBe('pts-primary');
    expect(reconciler.currentPushToken).toBe('tok-pts');
    expect(api.startGroupActivity).not.toHaveBeenCalled();
    expect(ended).toEqual(['pts-orphan']);
  });

  it('does not start when not entitled (start returns null, no teaser) (#194 A5)', async () => {
    const api = {
      endGroupActivity: jest.fn(async () => undefined),
      endAllGroupActivities: jest.fn(async () => undefined),
      startGroupActivity: jest.fn(async () => null),
      deleteSession: jest.fn(async () => undefined),
      deleteAllSessions: jest.fn(async () => undefined),
      listGroupActivities: jest.fn(async () => []),
    };
    const reconciler = new LiveActivityLifecycleReconciler(api);
    await reconciler.request({ kind: 'start', destinationId: 'd1' });
    expect(reconciler.currentHandle).toBeNull();
    expect(api.startGroupActivity).toHaveBeenCalledTimes(1);
  });

  it('starts locally when no PTS handle exists and ends on dispose', async () => {
    const api = {
      endGroupActivity: jest.fn(async () => undefined),
      endAllGroupActivities: jest.fn(async () => undefined),
      startGroupActivity: jest.fn(async () => ({
        activityId: 'local-1',
        pushToken: 'tok-1',
      })),
      deleteSession: jest.fn(async () => undefined),
      deleteAllSessions: jest.fn(async () => undefined),
      listGroupActivities: jest.fn(async () => []),
    };
    const reconciler = new LiveActivityLifecycleReconciler(api);
    await reconciler.request({ kind: 'start', destinationId: 'd1' });
    expect(reconciler.currentHandle).toBe('local-1');
    expect(reconciler.isCurrent(reconciler['generation'])).toBe(true);

    await reconciler.request({ kind: 'start', destinationId: 'd2' });
    expect(api.endGroupActivity).toHaveBeenCalledWith('local-1');
    expect(reconciler.currentDestinationId).toBe('d2');

    await reconciler.request({ kind: 'stop', clearSessions: true });
    expect(api.deleteAllSessions).toHaveBeenCalled();
    expect(reconciler.currentHandle).toBeNull();

    await reconciler.dispose();
    expect(api.endAllGroupActivities).toHaveBeenCalled();
  });

  it('skips start when permission is denied', async () => {
    const api = {
      endGroupActivity: jest.fn(async () => undefined),
      endAllGroupActivities: jest.fn(async () => undefined),
      startGroupActivity: jest.fn(async () => ({ activityId: 'x' })),
      deleteSession: jest.fn(async () => undefined),
      deleteAllSessions: jest.fn(async () => undefined),
      listGroupActivities: jest.fn(async () => []),
      ensureStartPermission: jest.fn(async () => false),
    };
    const reconciler = new LiveActivityLifecycleReconciler(api);
    await reconciler.request({ kind: 'start', destinationId: 'd1' });
    expect(api.startGroupActivity).not.toHaveBeenCalled();
    expect(reconciler.currentHandle).toBeNull();
  });
});

describe('Live Activity session and destination ownership', () => {
  const makeApi = (existing: { activityId: string; navigationSessionId?: string; destinationId?: string }[] = []) => ({
    endGroupActivity: jest.fn(async (_id: string) => undefined),
    endAllGroupActivities: jest.fn(async () => undefined),
    startGroupActivity: jest.fn(async (_intent: unknown) => ({ activityId: 'new-current' })),
    listGroupActivities: jest.fn(async () => existing),
    deleteSession: jest.fn(async (_id: string) => undefined),
    deleteAllSessions: jest.fn(async () => undefined),
  });
  it('replaces the owner for A to B at the same destination without an intermediate stop', async () => {
    const api = makeApi();
    api.startGroupActivity.mockResolvedValueOnce({ activityId: 'session-A' }).mockResolvedValueOnce({ activityId: 'session-B' });
    const owner = new LiveActivityLifecycleReconciler(api);
    await owner.request({ kind: 'start', destinationId: 'same-stop', navigationSessionId: 'A' });
    await owner.request({ kind: 'start', destinationId: 'same-stop', navigationSessionId: 'B' });
    expect(api.endGroupActivity).toHaveBeenCalledWith('session-A');
    expect(api.deleteSession).toHaveBeenCalledWith('session-A');
    expect(api.startGroupActivity).toHaveBeenLastCalledWith({ kind: 'start', destinationId: 'same-stop', navigationSessionId: 'B' });
    expect(api.endGroupActivity.mock.invocationCallOrder[0]).toBeLessThan(api.startGroupActivity.mock.invocationCallOrder[1]);
    expect(owner.currentHandle).toBe('session-B');
    expect(owner.currentNavigationSessionId).toBe('B');
  });
  it('a failed old native start cannot clear a newer observed PTS owner', async () => {
    const pending = deferred<{ activityId: string }>();
    const api = makeApi();
    api.startGroupActivity.mockReturnValueOnce(pending.promise);
    const owner = new LiveActivityLifecycleReconciler(api);
    const old = owner.request({ kind: 'start', destinationId: 'same-stop', navigationSessionId: 'A' });
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
    expect(api.startGroupActivity).toHaveBeenCalledTimes(1);
    const next = owner.request({ kind: 'start', destinationId: 'same-stop', navigationSessionId: 'B' });
    expect(owner.adoptObservedActivity({ activityId: 'pts-B', destinationId: 'same-stop', navigationSessionId: 'B' })).toBe(true);
    pending.reject(new Error('late A failure'));
    await Promise.all([old, next]);
    expect(owner.currentHandle).toBe('pts-B');
    expect(api.startGroupActivity).toHaveBeenCalledTimes(1);
  });

  it.each([
    { activityId: 'foreign-session', navigationSessionId: 'old', destinationId: 'same-stop' },
    { activityId: 'foreign-stop', navigationSessionId: 'current', destinationId: 'other-stop' },
    { activityId: 'unknown', destinationId: 'same-stop' },
    { activityId: 'missing-stop', navigationSessionId: 'current' },
  ])('never cold-adopts a mismatching or missing scope: %j', async row => {
    const api = makeApi([row]);
    const owner = new LiveActivityLifecycleReconciler(api);
    await owner.request({ kind: 'start', destinationId: 'same-stop', navigationSessionId: 'current' });
    expect(api.endGroupActivity).toHaveBeenCalledWith(row.activityId);
    expect(api.deleteSession).toHaveBeenCalledWith(row.activityId);
    expect(owner.currentHandle).toBe('new-current');
    expect(api.startGroupActivity).toHaveBeenCalledTimes(1);
  });
  it('adopts a valid PTS scope among foreign siblings without a second local start', async () => {
    const api = makeApi([{ activityId: 'foreign', destinationId: 'other', navigationSessionId: 'current' },
      { activityId: 'valid-pts', destinationId: 'same-stop', navigationSessionId: 'current' }]);
    const owner = new LiveActivityLifecycleReconciler(api);
    await owner.request({ kind: 'start', destinationId: 'same-stop', navigationSessionId: 'current' });
    expect(owner.currentHandle).toBe('valid-pts');
    expect(api.startGroupActivity).not.toHaveBeenCalled();
    expect(api.endAllGroupActivities).not.toHaveBeenCalled();
    expect(api.endGroupActivity).toHaveBeenCalledWith('foreign');
    expect(owner.adoptObservedActivity({ activityId: 'valid-pts', destinationId: 'same-stop', navigationSessionId: 'old' })).toBe(false);
  });
});
