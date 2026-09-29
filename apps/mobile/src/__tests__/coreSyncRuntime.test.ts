const mockFlush = jest.fn();
const mockAppRemove = jest.fn();
const mockOutboxRemove = jest.fn();
const mockConnectivityRemove = jest.fn();
let mockAppListener: (value: string) => void;
let mockOutboxListener: () => void;
let mockConnectivityListener: (value: boolean | null) => void;
jest.mock('react-native', () => ({ AppState: {
  currentState: 'active',
  addEventListener: (_: string, listener: typeof mockAppListener) => {
    mockAppListener = listener;
    return { remove: mockAppRemove };
  },
} }));
jest.mock('../state/coreDataSync', () => ({
  flushCoreOperationOutbox: () => mockFlush(),
  subscribeCoreOutboxChanges: (listener: () => void) => {
    mockOutboxListener = listener;
    return mockOutboxRemove;
  },
}));
jest.mock('../store/connectivity', () => ({
  subscribeConnectivity: (listener: typeof mockConnectivityListener) => {
    mockConnectivityListener = listener;
    return mockConnectivityRemove;
  },
}));
import { startCoreSyncRuntime } from '../state/coreSyncRuntime';
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockFlush.mockResolvedValue({ sent: 0, duplicates: 0, remaining: 0 });
});
afterEach(() => jest.useRealTimers());
it('wires foreground, outbox and online events and removes all listeners on account cleanup', async () => {
  const stop = startCoreSyncRuntime();
  await jest.advanceTimersByTimeAsync(500);
  expect(mockFlush).toHaveBeenCalledTimes(1);
  mockAppListener('background');
  mockOutboxListener();
  mockConnectivityListener(true);
  await jest.advanceTimersByTimeAsync(60_000);
  expect(mockFlush).toHaveBeenCalledTimes(1);
  mockAppListener('active');
  await jest.advanceTimersByTimeAsync(500);
  expect(mockFlush).toHaveBeenCalledTimes(2);
  mockConnectivityListener(false);
  mockConnectivityListener(null);
  await jest.advanceTimersByTimeAsync(500);
  expect(mockFlush).toHaveBeenCalledTimes(2);
  mockConnectivityListener(true);
  await jest.advanceTimersByTimeAsync(500);
  expect(mockFlush).toHaveBeenCalledTimes(3);
  mockOutboxListener();
  stop();
  await jest.advanceTimersByTimeAsync(60_000);
  expect(mockFlush).toHaveBeenCalledTimes(3);
  expect(mockAppRemove).toHaveBeenCalledTimes(1);
  expect(mockOutboxRemove).toHaveBeenCalledTimes(1);
  expect(mockConnectivityRemove).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
