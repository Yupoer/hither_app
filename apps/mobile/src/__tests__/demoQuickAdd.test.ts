import {
  demoAddDestination, demoAddDestinationsBatch, demoDeleteDestination,
  demoUpdateDestinationEmoji, demoReorderDestinations, demoSetJourneyTarget, getDemoState,
} from '../api/demo';

it('keeps quick adds first through demo editing without switching the active target', () => {
  for (const item of getDemoState().destinations) demoDeleteDestination(item.id);
  const coordinates = { latitude: 25, longitude: 121 };
  demoAddDestinationsBatch([
    { title: 'Old', day: 1, coordinates }, { title: 'Tomorrow', day: 2, coordinates },
    { title: 'Sub old', day: 1, subgroupId: 'sub', coordinates },
  ]);
  const old = getDemoState().destinations.find(item => item.title === 'Old')!;
  demoSetJourneyTarget(old.id);
  const first = demoAddDestination({ title: 'First', day: 1, coordinates, placement: 'firstStop' });
  const second = demoAddDestination({ title: 'Second', day: 1, coordinates, placement: 'firstStop' });
  const sub = demoAddDestination({ title: 'Sub first', day: 1, subgroupId: 'sub', coordinates, placement: 'firstStop' });
  const state = getDemoState();
  expect(state.destinations.filter(item => item.day === 1 && !item.subgroupId).sort((a,b) => a.order-b.order).map(item => item.id)).toEqual([second,first,old.id]);
  expect(state.destinations.find(item => item.id === sub)!.order).toBeLessThan(state.destinations.find(item => item.title === 'Sub old')!.order);
  expect(state.group.activeDestinationId).toBe(old.id);
  demoUpdateDestinationEmoji(second, '⭐', '#ffcc00');
  expect(getDemoState().destinations.find(item => item.id === second)).toMatchObject({ emoji: '⭐', markerColor: '#ffcc00' });
  demoReorderDestinations([first,second,...state.destinations.filter(item => item.id !== first && item.id !== second).map(item => item.id)]);
  expect(getDemoState().destinations.slice(0,2).map(item => item.id)).toEqual([first,second]);
  demoDeleteDestination(second);
  expect(getDemoState().destinations.some(item => item.id === second)).toBe(false);
  expect(getDemoState().group.activeDestinationId).toBe(old.id);
});
