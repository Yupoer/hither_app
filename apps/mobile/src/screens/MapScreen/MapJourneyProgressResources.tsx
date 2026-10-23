import React, { useCallback, useRef, useState } from 'react';
import { useMountEffect } from '../../hooks/useMountEffect';
import type { Coordinates, Destination } from '../../types';
import { distanceMeters, type TravelMode } from '../../utils/geo';
import { initialJourneyDistance, shouldAnchorInitial, type DistanceSource } from '../../utils/journeyProgress';
import type { usePersonalProgressSurfaces } from './hooks/usePersonalProgressSurfaces';

export type MapJourneyPresentation = { distanceM: number | null; etaSeconds: number | null; progress: number | null; travelMode: TravelMode };
type JourneyAnchor = { key: string; distanceM: number; source: DistanceSource; startCoords: Coordinates };
type JourneySticky = { key: string | null; progressMax: number | null; distanceM: number | null; etaSeconds: number | null; progress: number | null };
export type MapJourneyBaselineInput = {
  journeyActive: boolean; groupId: string | null; navTarget: Destination | undefined;
  initialJourneyRef: React.RefObject<JourneyAnchor | null>;
  lastRouteDistanceRef: React.RefObject<number | undefined>; departedStartRef: React.RefObject<boolean>;
  presentationStickyRef: React.RefObject<JourneySticky>;
  setInitialDistanceM: React.Dispatch<React.SetStateAction<number | undefined>>;
  setDistanceSource: React.Dispatch<React.SetStateAction<DistanceSource | undefined>>;
  setProgressDepartedStart: React.Dispatch<React.SetStateAction<boolean>>;
  setJourneyStartCoords: React.Dispatch<React.SetStateAction<Coordinates | null>>;
  setLastRouteDistanceM: React.Dispatch<React.SetStateAction<number | undefined>>;
  setProgressMaxSticky: React.Dispatch<React.SetStateAction<number | null>>;
  setLastValidPresentation: React.Dispatch<React.SetStateAction<MapJourneyPresentation>>;
  travelMode: TravelMode; navigationSessionState: { session: { id: string } | null };
  state: { group: { journeyStartedAt?: string } } | null;
  deviceCoords: Coordinates | null; selfRoute: { distanceMeters: number } | null;
  deviceAccuracyM: number | null; selfRouteGeneration: number;
};
export type PublishMapJourneyBaseline = (input: MapJourneyBaselineInput) => void;

function sameMapJourneyBaseline(previous: MapJourneyBaselineInput, input: MapJourneyBaselineInput) {
  return Object.is(previous.deviceAccuracyM, input.deviceAccuracyM)
    && Object.is(previous.deviceCoords, input.deviceCoords)
    && Object.is(previous.groupId, input.groupId)
    && Object.is(previous.journeyActive, input.journeyActive)
    && Object.is(previous.navTarget, input.navTarget)
    && Object.is(previous.selfRoute?.distanceMeters, input.selfRoute?.distanceMeters)
    && Object.is(previous.selfRouteGeneration, input.selfRouteGeneration)
    && Object.is(previous.state?.group.journeyStartedAt, input.state?.group.journeyStartedAt)
    && Object.is(previous.navigationSessionState.session?.id, input.navigationSessionState.session?.id);
}
function commitMapJourneyBaseline(input: MapJourneyBaselineInput, committed: React.RefObject<MapJourneyBaselineInput | null>) {
  if (committed.current && sameMapJourneyBaseline(committed.current, input)) return;
  committed.current = input;
  const { journeyActive, groupId, navTarget, initialJourneyRef, lastRouteDistanceRef, departedStartRef, presentationStickyRef, setInitialDistanceM, setDistanceSource, setProgressDepartedStart, setJourneyStartCoords, setLastRouteDistanceM, setProgressMaxSticky, setLastValidPresentation, travelMode, navigationSessionState, state, deviceCoords, selfRoute, deviceAccuracyM } = input;

    if (!journeyActive || !groupId || !navTarget) {
      initialJourneyRef.current = null;
      lastRouteDistanceRef.current = undefined;
      departedStartRef.current = false;
      presentationStickyRef.current = {
        key: null,
        progressMax: null,
        distanceM: null,
        etaSeconds: null,
        progress: null,
      };
      setInitialDistanceM(undefined);
      setDistanceSource(undefined);
      setProgressDepartedStart(false);
      setJourneyStartCoords(null);
      setLastRouteDistanceM(undefined);
      setProgressMaxSticky(null);
      setLastValidPresentation({ distanceM: null, etaSeconds: null, progress: null, travelMode });
      return;
    }

    const key = `${groupId}:${navTarget.id}:${navigationSessionState.session?.id ?? state?.group.journeyStartedAt ?? ''}`;
    // New destination / journey → reset monotonic progress + last-valid.
    if (presentationStickyRef.current.key !== key) {
      presentationStickyRef.current = {
        key,
        progressMax: null,
        distanceM: null,
        etaSeconds: null,
        progress: null,
      };
      setProgressMaxSticky(null);
      setLastValidPresentation({ distanceM: null, etaSeconds: null, progress: null, travelMode });
    }
    // Never baseline progress from peer/stale pins — only real device GPS.
    if (!deviceCoords) return;

    const routeDistanceM = selfRoute?.distanceMeters;
    if (routeDistanceM != null && Number.isFinite(routeDistanceM)) {
      lastRouteDistanceRef.current = routeDistanceM;
      setLastRouteDistanceM(routeDistanceM);
    }
    const deviceStraightM = distanceMeters(deviceCoords, navTarget.coordinates);
    const distanceM = initialJourneyDistance(routeDistanceM, deviceStraightM);
    if (distanceM == null) return;

    const source: DistanceSource = routeDistanceM != null ? 'route' : 'fallback';
    const canLockProgress = shouldAnchorInitial({
      hasDeviceGps: true,
      accuracyM: deviceAccuracyM,
    });
    const current = initialJourneyRef.current;
    if (
      canLockProgress &&
      (!current || current.key !== key || (current.source === 'fallback' && source === 'route'))
    ) {
      initialJourneyRef.current = {
        key,
        distanceM,
        source,
        startCoords: deviceCoords,
      };
      departedStartRef.current = false;
      presentationStickyRef.current.progressMax = null;
      setProgressMaxSticky(null);
      setInitialDistanceM(distanceM);
      setDistanceSource(source);
      setProgressDepartedStart(false);
      setJourneyStartCoords(deviceCoords);
    }

}
export function useMapJourneyProgressPublication(): PublishMapJourneyBaseline {
  const committed = useRef<MapJourneyBaselineInput | null>(null);
  return useCallback((input: MapJourneyBaselineInput) => commitMapJourneyBaseline(input, committed), []);
}
export function MapJourneyBaselineResource({ input, publishBaseline }: { input: MapJourneyBaselineInput; publishBaseline: PublishMapJourneyBaseline }) {
  const [previous, setPrevious] = useState({ input, generation: 0 });
  if (!sameMapJourneyBaseline(previous.input, input)) setPrevious({ input, generation: previous.generation + 1 });
  return <MapJourneyBaselineJob key={previous.generation} input={input} publishBaseline={publishBaseline} />;
}
function MapJourneyBaselineJob({ input, publishBaseline }: { input: MapJourneyBaselineInput; publishBaseline: PublishMapJourneyBaseline }) {
  useMountEffect(() => publishBaseline(input));
  return null;
}

export type MapJourneyDepartedInput = {
  gatedProgress: { departed: boolean } | undefined;
  departedStartRef: React.RefObject<boolean>;
  progressDepartedStart: boolean;
  setProgressDepartedStart: MapJourneyBaselineInput['setProgressDepartedStart'];
};
export function MapJourneyDepartedResource({ input, baselineInput, publishBaseline }: {
  input: MapJourneyDepartedInput; baselineInput: MapJourneyBaselineInput; publishBaseline: PublishMapJourneyBaseline;
}) {
  const [previous, setPrevious] = useState({ input, generation: 0 });
  if (!(Object.is(previous.input.gatedProgress?.departed, input.gatedProgress?.departed)
    && Object.is(previous.input.progressDepartedStart, input.progressDepartedStart))) setPrevious({ input, generation: previous.generation + 1 });
  return <MapJourneyDepartedJob key={previous.generation} input={input} baselineInput={baselineInput} publishBaseline={publishBaseline} />;
}
function MapJourneyDepartedJob({ input, baselineInput, publishBaseline }: {
  input: MapJourneyDepartedInput; baselineInput: MapJourneyBaselineInput; publishBaseline: PublishMapJourneyBaseline;
}) {
  const { gatedProgress, departedStartRef, progressDepartedStart, setProgressDepartedStart } = input;
  useMountEffect(() => {
    publishBaseline(baselineInput);

    if (!gatedProgress?.departed) return;
    departedStartRef.current = true;
    if (!progressDepartedStart) setProgressDepartedStart(true);

  });
  return null;
}


export type MapJourneyStickyInput = {
  journeyActive: boolean;
  navTarget: Destination | undefined;
  groupId: string | null;
  navigationSessionState: MapJourneyBaselineInput['navigationSessionState'];
  state: MapJourneyBaselineInput['state'];
  presentationStickyRef: MapJourneyBaselineInput['presentationStickyRef'];
  personalProgress: Pick<ReturnType<typeof usePersonalProgressSurfaces>['personalProgress'], 'progress' | 'distanceMeters' | 'etaSeconds'>;
  setProgressMaxSticky: MapJourneyBaselineInput['setProgressMaxSticky'];
  lastValidPresentation: MapJourneyPresentation;
  travelMode: TravelMode;
  setLastValidPresentation: MapJourneyBaselineInput['setLastValidPresentation'];
};
export function MapJourneyStickyResource({ input, baselineInput, publishBaseline }: {
  input: MapJourneyStickyInput; baselineInput: MapJourneyBaselineInput; publishBaseline: PublishMapJourneyBaseline;
}) {
  const [previous, setPrevious] = useState({ input, generation: 0 });
  if (!(Object.is(previous.input.journeyActive, input.journeyActive)
    && Object.is(previous.input.navTarget, input.navTarget)
    && Object.is(previous.input.groupId, input.groupId)
    && Object.is(previous.input.state?.group.journeyStartedAt, input.state?.group.journeyStartedAt)
    && Object.is(previous.input.navigationSessionState.session?.id, input.navigationSessionState.session?.id)
    && Object.is(previous.input.personalProgress.progress, input.personalProgress.progress)
    && Object.is(previous.input.personalProgress.distanceMeters, input.personalProgress.distanceMeters)
    && Object.is(previous.input.personalProgress.etaSeconds, input.personalProgress.etaSeconds)
    && Object.is(previous.input.travelMode, input.travelMode))) setPrevious({ input, generation: previous.generation + 1 });
  return <MapJourneyStickyJob key={previous.generation} input={input} baselineInput={baselineInput} publishBaseline={publishBaseline} />;
}
function MapJourneyStickyJob({ input, baselineInput, publishBaseline }: {
  input: MapJourneyStickyInput; baselineInput: MapJourneyBaselineInput; publishBaseline: PublishMapJourneyBaseline;
}) {
  const { journeyActive, navTarget, groupId, navigationSessionState, state, presentationStickyRef, personalProgress, setProgressMaxSticky, lastValidPresentation, travelMode, setLastValidPresentation } = input;
  useMountEffect(() => {
    publishBaseline(baselineInput);

    if (!journeyActive || !navTarget || !groupId) return;
    const key = `${groupId}:${navTarget.id}:${navigationSessionState.session?.id ?? state?.group.journeyStartedAt ?? ''}`;
    const sticky = presentationStickyRef.current;
    if (sticky.key !== key) {
      // Key was just set in baseline effect; align ref so subsequent samples stick.
      sticky.key = key;
    }
    const nextProgress = personalProgress.progress;
    if (nextProgress != null && Number.isFinite(nextProgress)) {
      const max =
        sticky.progressMax == null
          ? nextProgress
          : Math.max(sticky.progressMax, nextProgress);
      if (sticky.progressMax == null || max > sticky.progressMax + 1e-9) {
        sticky.progressMax = max;
        setProgressMaxSticky(max);
      }
    }
    if (
      personalProgress.distanceMeters != null
      && Number.isFinite(personalProgress.distanceMeters)
    ) {
      const d = personalProgress.distanceMeters;
      const e = personalProgress.etaSeconds;
      const p = personalProgress.progress;
      if (
        sticky.distanceM !== d
        || sticky.etaSeconds !== e
        || sticky.progress !== p
        || lastValidPresentation.travelMode !== travelMode
      ) {
        sticky.distanceM = d;
        sticky.etaSeconds = e;
        sticky.progress = p;
        setLastValidPresentation({ distanceM: d, etaSeconds: e, progress: p, travelMode });
      }
    }

  });
  return null;
}
