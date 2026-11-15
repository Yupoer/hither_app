import type { SharedValue } from 'react-native-reanimated';

export type D6DragOwner = 'idle' | 'pane' | 'reorder';

export function d6ActivationKind(event: unknown): 'touch' | 'accessibility' {
  if (!event || typeof event !== 'object' || !('nativeEvent' in event)) return 'accessibility';
  const native = event.nativeEvent;
  return native && typeof native === 'object' && 'changedTouches' in native
    && Array.isArray(native.changedTouches) && native.changedTouches.length > 0 ? 'touch' : 'accessibility';
}

export function cancelledD6Touch(cancelled: boolean, event: unknown): boolean {
  return cancelled && d6ActivationKind(event) === 'touch';
}

export function claimD6Drag(owner: Pick<SharedValue<D6DragOwner>, 'get' | 'set'>, next: Exclude<D6DragOwner, 'idle'>) {
  'worklet';
  if (owner.get() !== 'idle') return false;
  owner.set(next);
  return true;
}

export function releaseD6Drag(owner: Pick<SharedValue<D6DragOwner>, 'get' | 'set'>, current: Exclude<D6DragOwner, 'idle'>) {
  'worklet';
  if (owner.get() === current) owner.set('idle');
}
