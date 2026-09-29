import { rollbackItinerary, operationWirePayload } from '../state/itineraryRollback';
import type { Destination } from '../types';
const point = (id: string, title = id, day: number | null = null): Destination => ({ id, title, day, order: 0, coordinates: { latitude: 25, longitude: 121 } });
it('undoes a rejected add without removing an independently accepted destination', () => {
  expect(rollbackItinerary([point('a'), point('b'), point('c')], { before: [point('a')], after: [point('a'), point('b')] }).map(item => item.id)).toEqual(['a','c']);
});
it('undoes only changed fields and preserves a subsequent edit', () => {
  const current = point('a', 'newer name', 2);
  expect(rollbackItinerary([current], { before: [point('a')], after: [point('a', 'a', 2)] })[0]).toEqual(point('a', 'newer name'));
});
it('never sends local rollback history to the server', () => {
  expect(operationWirePayload({ destinationId: 'a', _localRollback: { before: [], after: [] } })).toEqual({ destinationId: 'a' });
});
