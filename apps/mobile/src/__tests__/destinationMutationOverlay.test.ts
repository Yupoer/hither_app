import type { Destination } from '../types';
import {
  applyDestinationMutationOverlay,
  enqueueDestinationMutation,
  reconcileDestinationMutations,
  removeDestinationMutation,
  type PendingDestinationMutation,
} from '../utils/destinationMutationOverlay';

const destination = (overrides: Partial<Destination> = {}): Destination => ({
  id: 'dest-1',
  title: 'Stop',
  order: 0,
  day: 1,
  coordinates: { latitude: 25, longitude: 121 },
  emoji: '🍜',
  markerColor: '#E85D4A',
  ...overrides,
});

const mutation = (
  mutationId: string,
  previous: { emoji: string | null; markerColor: string | null },
  optimistic: { emoji: string | null; markerColor: string | null },
): PendingDestinationMutation => ({
  mutationId,
  destinationId: 'dest-1',
  previous,
  optimistic,
});

describe('destination mutation overlay', () => {
  it('patches marker/list projection immediately', () => {
    const pending = enqueueDestinationMutation([], mutation(
      'm1',
      { emoji: '🍜', markerColor: '#E85D4A' },
      { emoji: '🏨', markerColor: '#596DDE' },
    ));
    expect(applyDestinationMutationOverlay([destination()], pending)[0]).toMatchObject({
      emoji: '🏨',
      markerColor: '#596DDE',
    });
  });

  it('rolls back only the failed mutation and preserves a newer mutation', () => {
    const first = mutation('m1', { emoji: '🍜', markerColor: '#E85D4A' }, { emoji: '🏨', markerColor: '#596DDE' });
    const second = mutation('m2', { emoji: '🏨', markerColor: '#596DDE' }, { emoji: '📸', markerColor: '#687CE5' });
    const pending = [first, second];
    const afterOldFailure = removeDestinationMutation(pending, 'm1');
    expect(applyDestinationMutationOverlay([destination()], afterOldFailure)[0]).toMatchObject({
      emoji: '📸',
      markerColor: '#687CE5',
    });
    expect(removeDestinationMutation(pending, 'm2')).toEqual([first]);
  });

  it('reconciles a server/realtime row without clearing another destination', () => {
    const pending = [
      mutation('m1', { emoji: '🍜', markerColor: '#E85D4A' }, { emoji: '🏨', markerColor: '#596DDE' }),
      { ...mutation('m2', { emoji: '🍜', markerColor: '#E85D4A' }, { emoji: '📸', markerColor: '#687CE5' }), destinationId: 'dest-2' },
    ];
    expect(reconcileDestinationMutations(pending, [destination({ emoji: '🏨', markerColor: '#596DDE' })])).toEqual([pending[1]]);
  });
});
