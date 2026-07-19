import {
  clearNavigationTerminalMutationStateForTests,
  runNavigationTerminalMutation,
} from '../state/navigationTerminalMutation';

describe('navigationTerminalMutation', () => {
  beforeEach(clearNavigationTerminalMutationStateForTests);

  it('coalesces the same action/session/version across consumers', async () => {
    let resolve!: () => void;
    const work = jest.fn(() => new Promise<void>((done) => { resolve = done; }));
    const first = runNavigationTerminalMutation('cancel', 's1', 1, work);
    const second = runNavigationTerminalMutation('cancel', 's1', 1, work);
    expect(work).toHaveBeenCalledTimes(1);
    resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
  });

  it('suppresses a key after the server state was reconciled', async () => {
    const work = jest.fn().mockRejectedValue({ code: '40001' });
    const reconcile = jest.fn().mockResolvedValue(undefined);
    await expect(
      runNavigationTerminalMutation('cancel', 's1', 1, work, reconcile),
    ).resolves.toBeUndefined();
    await expect(
      runNavigationTerminalMutation('cancel', 's1', 1, work, reconcile),
    ).resolves.toBeUndefined();
    expect(work).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it('does not suppress a different version or action', async () => {
    const work = jest.fn().mockResolvedValue(undefined);
    await runNavigationTerminalMutation('cancel', 's1', 1, work);
    await runNavigationTerminalMutation('cancel', 's1', 2, work);
    await runNavigationTerminalMutation('complete', 's1', 2, work);
    expect(work).toHaveBeenCalledTimes(3);
  });
});
