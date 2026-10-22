import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MapJourneyBaselineResource, MapJourneyDepartedResource, MapJourneyStickyResource,
  useMapJourneyProgressPublication, type MapJourneyBaselineInput, type MapJourneyStickyInput } from '../screens/MapScreen/MapJourneyProgressResources';
import { mapJourneyResourceInput } from './fixtures/mapJourneyResourceInput';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function stickyInput(input: MapJourneyBaselineInput, progress: number): MapJourneyStickyInput {
  return { journeyActive: input.journeyActive, navTarget: input.navTarget, groupId: input.groupId,
    navigationSessionState: input.navigationSessionState, state: input.state, presentationStickyRef: input.presentationStickyRef,
    personalProgress: { progress, distanceMeters: 700, etaSeconds: 500 }, setProgressMaxSticky: input.setProgressMaxSticky,
    lastValidPresentation: { distanceM: null, etaSeconds: null, progress: null, travelMode: input.travelMode },
    travelMode: input.travelMode, setLastValidPresentation: input.setLastValidPresentation };
}

describe('Map journey committed progress resources', () => {
  let tree: ReactTestRenderer | undefined;
  afterEach(() => { act(() => tree?.unmount()); tree = undefined; });

  it('publishes the baseline before sticky progress even when its keyed resource mounts later', () => {
    const input = mapJourneyResourceInput();
    function Owner({ baseline, progress }: { baseline: MapJourneyBaselineInput; progress: number }) {
      const publish = useMapJourneyProgressPublication();
      return React.createElement(React.Fragment, null,
        React.createElement(MapJourneyStickyResource, { input: stickyInput(baseline, progress), baselineInput: baseline, publishBaseline: publish }),
        React.createElement(MapJourneyBaselineResource, { input: baseline, publishBaseline: publish }));
    }
    act(() => { tree = create(React.createElement(Owner, { baseline: input, progress: 0.3 })); });
    expect(input.initialJourneyRef.current?.distanceM).toBe(1_000);
    expect(input.presentationStickyRef.current.key).toBe('group:destination:session');
    expect(input.presentationStickyRef.current.progressMax).toBe(0.3);
    expect(input.setProgressMaxSticky).toHaveBeenLastCalledWith(0.3);
    const next = { ...input, navigationSessionState: { session: { id: 'new-session' } } };
    act(() => tree?.update(React.createElement(Owner, { baseline: next, progress: 0.1 })));
    expect(input.presentationStickyRef.current.key).toBe('group:destination:new-session');
    expect(input.presentationStickyRef.current.progressMax).toBe(0.1);
  });

  it('reevaluates new coordinate references and route generations while keeping the locked anchor', () => {
    const input = mapJourneyResourceInput();
    function Owner({ baseline }: { baseline: MapJourneyBaselineInput }) {
      const publish = useMapJourneyProgressPublication();
      return React.createElement(MapJourneyBaselineResource, { input: baseline, publishBaseline: publish });
    }
    act(() => { tree = create(React.createElement(Owner, { baseline: input })); });
    const anchor = input.initialJourneyRef.current;
    act(() => tree?.update(React.createElement(Owner, { baseline: { ...input } })));
    expect(input.setLastRouteDistanceM).toHaveBeenCalledTimes(1);
    const next = { ...input, deviceCoords: input.deviceCoords ? { ...input.deviceCoords } : null };
    act(() => tree?.update(React.createElement(Owner, { baseline: next })));
    expect(input.setLastRouteDistanceM).toHaveBeenCalledTimes(2);
    expect(input.initialJourneyRef.current).toBe(anchor);
    act(() => tree?.update(React.createElement(Owner, { baseline: { ...next, selfRoute: { distanceMeters: 1_000 } } })));
    expect(input.setLastRouteDistanceM).toHaveBeenCalledTimes(2);
    act(() => tree?.update(React.createElement(Owner, { baseline: { ...next, selfRouteGeneration: 2 } })));
    expect(input.setLastRouteDistanceM).toHaveBeenCalledTimes(3);
    expect(input.initialJourneyRef.current).toBe(anchor);
  });

  it('arbitrates baseline before departure and preserves sticky departure through unrelated updates', () => {
    const input = mapJourneyResourceInput();
    function Owner({ baseline }: { baseline: MapJourneyBaselineInput }) {
      const publish = useMapJourneyProgressPublication();
      return React.createElement(React.Fragment, null,
        React.createElement(MapJourneyDepartedResource, { input: { gatedProgress: { departed: true },
          departedStartRef: baseline.departedStartRef, progressDepartedStart: false, setProgressDepartedStart: baseline.setProgressDepartedStart },
        baselineInput: baseline, publishBaseline: publish }),
        React.createElement(MapJourneyBaselineResource, { input: baseline, publishBaseline: publish }));
    }
    act(() => { tree = create(React.createElement(Owner, { baseline: input })); });
    expect(input.departedStartRef.current).toBe(true);
    expect(input.setProgressDepartedStart).toHaveBeenLastCalledWith(true);
    act(() => tree?.update(React.createElement(Owner, { baseline: { ...input } })));
    expect(input.departedStartRef.current).toBe(true);
    expect(input.setProgressDepartedStart).toHaveBeenCalledTimes(2);
  });
});
