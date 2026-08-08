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
});
