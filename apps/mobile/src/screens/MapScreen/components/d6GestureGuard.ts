import { measure, runOnJS, type AnimatedRef, type MeasuredDimensions } from 'react-native-reanimated';

type GestureFailureListener = (source: string, reason: string) => void;
const failureListeners = new Set<GestureFailureListener>();

export function subscribeGestureFailures(listener: GestureFailureListener) {
  failureListeners.add(listener);
  return () => { failureListeners.delete(listener); };
}

function reportGestureFailure(source: string, reason: string) {
  if (__DEV__) console.warn(`[gesture:${source}] ${reason}`);
  failureListeners.forEach(listener => listener(source, reason));
}

/**
 * An exception thrown by a gesture worklet escapes the UI runtime and aborts the
 * app, so pane and reorder callbacks recover locally and report the message.
 */
function describeError(error: unknown) {
  'worklet';
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export function guardGesture<A extends unknown[]>(source: string, callback: (...args: A) => void, recover: () => void) {
  return (...args: A) => {
    'worklet';
    try {
      callback(...args);
    } catch (error) {
      runOnJS(reportGestureFailure)(source, describeError(error));
      try {
        recover();
      } catch (recoveryError) {
        runOnJS(reportGestureFailure)(`${source}:recover`, describeError(recoveryError));
      }
    }
  };
}

/** `measure` throws instead of returning null when a ref has not attached on the UI runtime yet. */
export function measureAttached<T extends object>(ref: AnimatedRef<T>): MeasuredDimensions | null {
  'worklet';
  const attached: unknown = ref();
  return attached !== null && typeof attached === 'object' ? measure(ref) : null;
}
