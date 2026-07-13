import {
  demoAddDestination,
  demoSetJourneyTarget,
  getDemoState,
} from '../api/demo';

describe('demo journey target', () => {
  it('persists and clears the same authoritative target fields as Supabase', () => {
    demoAddDestination({
      title: 'Demo target',
      coordinates: { latitude: 25.0478, longitude: 121.517 },
    });
    const destinationId = getDemoState().destinations.at(-1)!.id;

    demoSetJourneyTarget(destinationId);
    expect(getDemoState().group).toEqual(
      expect.objectContaining({
        journeyStatus: 'going',
        activeDestinationId: destinationId,
      }),
    );

    demoSetJourneyTarget(null);
    expect(getDemoState().group).toEqual(
      expect.objectContaining({
        journeyStatus: 'paused',
        activeDestinationId: undefined,
      }),
    );
  });
});
