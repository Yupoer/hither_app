/**
 * @jest-environment node
 */
import {
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
