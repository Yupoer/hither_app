import {
  ADD_PLACE_TOUR_STEPS,
  addPlaceTourStorageKey,
  isAddPlaceTourCompletedFromSources,
  shouldStartAddPlaceTour,
} from '../featureTour/addPlaceTour';

describe('Add Place tour (#162)', () => {
  it('has star then center steps with real target test ids and registry targets', () => {
    expect(ADD_PLACE_TOUR_STEPS.map((s) => s.id)).toEqual(['star', 'center']);
    expect(ADD_PLACE_TOUR_STEPS[0].targetTestId).toBe('add-place-favorite-star');
    expect(ADD_PLACE_TOUR_STEPS[1].targetTestId).toBe('add-place-center-btn');
    expect(ADD_PLACE_TOUR_STEPS[0].target).toBe('addPlaceFavoriteStar');
    expect(ADD_PLACE_TOUR_STEPS[1].target).toBe('addPlaceCenter');
  });

  it('does not share group tour completion flag', () => {
    expect(
      isAddPlaceTourCompletedFromSources({
        localCompleted: false,
        accountPreferences: { groupFeatureTourCompleted: true },
      }),
    ).toBe(false);
    expect(
      isAddPlaceTourCompletedFromSources({
        localCompleted: false,
        accountPreferences: { addPlaceTourCompleted: true },
      }),
    ).toBe(true);
  });

  it('starts only when pending place + targets ready and not completed', () => {
    expect(
      shouldStartAddPlaceTour({
        pendingPlaceVisible: true,
        targetsReady: true,
        localCompleted: false,
        accountPreferences: null,
      }),
    ).toBe(true);
    expect(
      shouldStartAddPlaceTour({
        pendingPlaceVisible: true,
        targetsReady: false,
        localCompleted: false,
        accountPreferences: null,
      }),
    ).toBe(false);
    expect(
      shouldStartAddPlaceTour({
        pendingPlaceVisible: true,
        targetsReady: true,
        localCompleted: true,
        accountPreferences: null,
      }),
    ).toBe(false);
  });

  it('scopes local completion key by account', () => {
    expect(addPlaceTourStorageKey('user-a')).toBe('hither.addPlaceTour.v1:user-a');
    expect(addPlaceTourStorageKey('user-b')).toBe('hither.addPlaceTour.v1:user-b');
    expect(addPlaceTourStorageKey('user-a')).not.toBe(addPlaceTourStorageKey('user-b'));
    expect(addPlaceTourStorageKey(null)).toBe('hither.addPlaceTour.v1');
  });
});
