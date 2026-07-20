export type NavigationTerminalAction = 'cancel' | 'complete';

const inFlight = new Map<string, Promise<unknown>>();
const reconciled = new Set<string>();

function key(action: NavigationTerminalAction, sessionId: string, version: number): string {
  return `${action}:${sessionId}:${version}`;
}

export function runNavigationTerminalMutation<T>(
  action: NavigationTerminalAction,
  sessionId: string,
  version: number,
  work: () => Promise<T>,
  reconcile: () => Promise<void> = async () => undefined,
): Promise<T | undefined> {
  const mutationKey = key(action, sessionId, version);
  if (reconciled.has(mutationKey)) return Promise.resolve(undefined);
  const existing = inFlight.get(mutationKey) as Promise<T | undefined> | undefined;
  if (existing) return existing;

  const run = work()
    .catch(async (cause: { code?: string }) => {
      if (cause?.code !== '40001') throw cause;
      await reconcile();
      reconciled.add(mutationKey);
      return undefined;
    })
    .finally(() => {
      inFlight.delete(mutationKey);
    });
  inFlight.set(mutationKey, run);
  return run;
}

export function clearNavigationTerminalMutationStateForTests(): void {
  inFlight.clear();
  reconciled.clear();
}
