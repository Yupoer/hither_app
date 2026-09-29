import { AppState } from 'react-native';
import { createCoreSyncScheduler } from './coreSyncScheduler';
import { flushCoreOperationOutbox, subscribeCoreOutboxChanges } from './coreDataSync';
import { subscribeConnectivity } from '../store/connectivity';

/** Called only for a hydrated signed-in actor; logout/unmount removes all work. */
export function startCoreSyncRuntime(): () => void {
  const scheduler = createCoreSyncScheduler(flushCoreOperationOutbox, AppState.currentState === 'active');
  const app = AppState.addEventListener('change', value => scheduler.setForeground(value === 'active'));
  const outbox = subscribeCoreOutboxChanges(scheduler.wake);
  const connectivity = subscribeConnectivity(online => { if (online === true) scheduler.wake(); });
  scheduler.wake();
  return () => { scheduler.stop(); app.remove(); outbox(); connectivity(); };
}
