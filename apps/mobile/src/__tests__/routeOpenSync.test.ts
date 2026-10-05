/**
 * @jest-environment node
 */
import {
  reconcileRouteOnOpen,
  bumpRouteOpenSyncGeneration,
  shouldApplyRouteOpenSyncResult,
} from '../utils/routeOpenSync';

describe('route open-sync generation guard (#151)', () => {
  it('close/reopen bumps generation so older in-flight results are ignored', () => {
    let generation = 0;
    // First open starts at gen 0
    const firstOpenGen = generation;
    expect(shouldApplyRouteOpenSyncResult(firstOpenGen, generation)).toBe(true);

    // Close invalidates
    generation = bumpRouteOpenSyncGeneration(generation);
    expect(shouldApplyRouteOpenSyncResult(firstOpenGen, generation)).toBe(false);

    // Second open uses new gen; late first-open failure must not apply
    const secondOpenGen = generation;
    expect(shouldApplyRouteOpenSyncResult(firstOpenGen, generation)).toBe(false);
    expect(shouldApplyRouteOpenSyncResult(secondOpenGen, generation)).toBe(true);

    // Success then close again
    generation = bumpRouteOpenSyncGeneration(generation);
    expect(shouldApplyRouteOpenSyncResult(secondOpenGen, generation)).toBe(false);
  });
});

describe('silent route-open reconciliation', () => {
  it('starts remote work after local completion without waiting for it or applying a retired generation', async () => {
    let releaseLocal!: () => void;
    let releaseRemote!: () => void;
    const refreshLocal = jest.fn(() => new Promise<void>(resolve => { releaseLocal = resolve; }));
    const refreshRemote = jest.fn(() => new Promise<void>(resolve => { releaseRemote = resolve; }));
    let generation = 0;
    let phase = 'started';
    const startedGeneration = generation;
    const opened = reconcileRouteOnOpen(refreshLocal, refreshRemote).finally(() => {
      if (shouldApplyRouteOpenSyncResult(startedGeneration, generation)) phase = 'done';
    });
    expect(refreshRemote).not.toHaveBeenCalled();
    generation = bumpRouteOpenSyncGeneration(generation);
    phase = 'idle';
    releaseLocal();
    await opened; // Remote delivery is still in flight; the editor stays usable.
    expect(refreshRemote).toHaveBeenCalledTimes(1);
    expect(phase).toBe('idle'); // Old completion cannot mark a newly opened editor done.
    releaseRemote();
    await Promise.resolve();
  });

  it('swallows advisory local and remote reconciliation failures', async () => {
    const refreshRemote = jest.fn(async () => { throw new Error('offline'); });
    await expect(reconcileRouteOnOpen(async () => { throw new Error('local-read-failed'); }, refreshRemote)).resolves.toBeUndefined();
    expect(refreshRemote).toHaveBeenCalledTimes(1);
  });
});
