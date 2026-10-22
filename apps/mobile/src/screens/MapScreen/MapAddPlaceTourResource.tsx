import React, { useCallback, useRef, useState } from 'react';
import { useMountEffect } from '../../hooks/useMountEffect';
import type { PlaceResult } from '../../native';
import type { AccountPreferences } from '../../types';
import { ADD_PLACE_TOUR_SETTLE_MS, ADD_PLACE_TOUR_STEPS, areAddPlaceTourTargetsReady,
  shouldStartAddPlaceTour, isMeasuredTourRect } from '../../featureTour/addPlaceTour';
import { measureTargetWithRetry, type MeasureFn } from '../../featureTour/measureTarget';

type TourRect = { x: number; y: number; width: number; height: number };
export type MapAddPlaceTourInput = {
  addPlaceTourGenerationRef: React.RefObject<number>;
  confirmCardReady: boolean;
  pendingPlace: PlaceResult | null;
  setAddPlaceTourStep: React.Dispatch<React.SetStateAction<number | null>>;
  setAddPlaceTourTargetRect: React.Dispatch<React.SetStateAction<TourRect | null>>;
  setAddPlaceTourTransitioning: React.Dispatch<React.SetStateAction<boolean>>;
  measureTourTarget: MeasureFn;
  addPlaceTourLocalDone: boolean;
  user: { preferences?: AccountPreferences | null } | null;
  addPlaceTourStep: number | null;
  confirmKeyboardHeight: number;
};

function sameMapAddPlaceStart(previous: MapAddPlaceTourInput, input: MapAddPlaceTourInput) {
  return Object.is(previous.confirmCardReady, input.confirmCardReady)
    && Object.is(previous.pendingPlace, input.pendingPlace)
    && Object.is(previous.addPlaceTourLocalDone, input.addPlaceTourLocalDone)
    && Object.is(previous.user?.preferences, input.user?.preferences)
    && Object.is(previous.measureTourTarget, input.measureTourTarget);
}
function sameMapAddPlaceMeasurement(previous: MapAddPlaceTourInput, input: MapAddPlaceTourInput) {
  return Object.is(previous.addPlaceTourStep, input.addPlaceTourStep)
    && Object.is(previous.measureTourTarget, input.measureTourTarget)
    && Object.is(previous.confirmKeyboardHeight, input.confirmKeyboardHeight);
}

function beginMapAddPlaceStart(input: MapAddPlaceTourInput) {
  const { addPlaceTourGenerationRef, confirmCardReady, pendingPlace, setAddPlaceTourStep,
    setAddPlaceTourTargetRect, setAddPlaceTourTransitioning, measureTourTarget, addPlaceTourLocalDone, user } = input;

    const generation = ++addPlaceTourGenerationRef.current;
    if (!confirmCardReady || !pendingPlace) {
      setAddPlaceTourStep(null);
      setAddPlaceTourTargetRect(null);
      setAddPlaceTourTransitioning(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      setAddPlaceTourTransitioning(true);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, ADD_PLACE_TOUR_SETTLE_MS);
      });
      if (cancelled) return;
      const starRect = await measureTargetWithRetry({
        measure: measureTourTarget,
        target: 'addPlaceFavoriteStar',
      });
      if (cancelled || generation !== addPlaceTourGenerationRef.current) return;
      const centerRect = await measureTargetWithRetry({
        measure: measureTourTarget,
        target: 'addPlaceCenter',
      });
      if (cancelled || generation !== addPlaceTourGenerationRef.current) return;
      const targetsReady = areAddPlaceTourTargetsReady({ starRect, centerRect });
      if (
        shouldStartAddPlaceTour({
          pendingPlaceVisible: true,
          targetsReady,
          localCompleted: addPlaceTourLocalDone,
          accountPreferences: user?.preferences ?? null,
        })
      ) {
        setAddPlaceTourStep(0);
        setAddPlaceTourTargetRect(starRect);
      }
      if (generation === addPlaceTourGenerationRef.current) {
        setAddPlaceTourTransitioning(false);
      }
    })();
    return () => {
      cancelled = true;
    };

}

function beginMapAddPlaceMeasurement(input: MapAddPlaceTourInput) {
  const { addPlaceTourStep, setAddPlaceTourTargetRect, addPlaceTourGenerationRef,
    setAddPlaceTourTransitioning, measureTourTarget } = input;

    if (addPlaceTourStep == null) {
      setAddPlaceTourTargetRect(null);
      return;
    }
    const step = ADD_PLACE_TOUR_STEPS[addPlaceTourStep];
    if (!step) return;
    let cancelled = false;
    const generation = ++addPlaceTourGenerationRef.current;
    setAddPlaceTourTransitioning(true);
    void (async () => {
      const rect = await measureTargetWithRetry({
        measure: measureTourTarget,
        target: step.target,
      });
      if (cancelled || generation !== addPlaceTourGenerationRef.current) return;
      if (isMeasuredTourRect(rect)) {
        setAddPlaceTourTargetRect(rect);
      }
      setAddPlaceTourTransitioning(false);
    })();
    return () => {
      cancelled = true;
    };

}

type AddPlaceStartLease = { input: MapAddPlaceTourInput; release: () => void };
type AddPlaceMeasurementLease = { input: MapAddPlaceTourInput; release: () => void };
type ObserveAddPlaceStart = (input: MapAddPlaceTourInput) => () => void;
type ObserveAddPlaceMeasurement = (input: MapAddPlaceTourInput) => () => void;

export function MapAddPlaceTourResource(input: MapAddPlaceTourInput) {
  const startLease = useRef<AddPlaceStartLease | null>(null);
  const measurementLease = useRef<AddPlaceMeasurementLease | null>(null);
  const observeStart = useCallback((snapshot: MapAddPlaceTourInput) => {
    const previous = startLease.current;
    if (previous && sameMapAddPlaceStart(previous.input, snapshot)) return previous.release;
    previous?.release();
    const cancel = beginMapAddPlaceStart(snapshot);
    const lease: AddPlaceStartLease = { input: snapshot, release: () => {
      cancel?.();
      if (startLease.current === lease) startLease.current = null;
    } };
    startLease.current = lease;
    return lease.release;
  }, []);
  const observeMeasurement = useCallback((snapshot: MapAddPlaceTourInput) => {
    // The start generation is published before a same-commit step measurement.
    observeStart(snapshot);
    const previous = measurementLease.current;
    if (previous && sameMapAddPlaceMeasurement(previous.input, snapshot)) return previous.release;
    previous?.release();
    const cancel = beginMapAddPlaceMeasurement(snapshot);
    const lease: AddPlaceMeasurementLease = { input: snapshot, release: () => {
      cancel?.();
      if (measurementLease.current === lease) measurementLease.current = null;
    } };
    measurementLease.current = lease;
    return lease.release;
  }, [observeStart]);
  useMountEffect(() => () => { startLease.current?.release(); measurementLease.current?.release(); });
  return <>
    <MapAddPlaceMeasurementResource input={input} observeMeasurement={observeMeasurement} />
    <MapAddPlaceStartResource input={input} observeStart={observeStart} />
  </>;
}

function MapAddPlaceStartResource({ input, observeStart }: { input: MapAddPlaceTourInput; observeStart: ObserveAddPlaceStart }) {
  const [previous, setPrevious] = useState({ input, generation: 0 });
  if (!sameMapAddPlaceStart(previous.input, input)) setPrevious({ input, generation: previous.generation + 1 });
  return <MapAddPlaceStartJob key={previous.generation} input={input} observeStart={observeStart} />;
}
function MapAddPlaceStartJob({ input, observeStart }: { input: MapAddPlaceTourInput; observeStart: ObserveAddPlaceStart }) {
  useMountEffect(() => observeStart(input));
  return null;
}
function MapAddPlaceMeasurementResource({ input, observeMeasurement }: { input: MapAddPlaceTourInput; observeMeasurement: ObserveAddPlaceMeasurement }) {
  const [previous, setPrevious] = useState({ input, generation: 0 });
  if (!sameMapAddPlaceMeasurement(previous.input, input)) setPrevious({ input, generation: previous.generation + 1 });
  return <MapAddPlaceMeasurementJob key={previous.generation} input={input} observeMeasurement={observeMeasurement} />;
}
function MapAddPlaceMeasurementJob({ input, observeMeasurement }: { input: MapAddPlaceTourInput; observeMeasurement: ObserveAddPlaceMeasurement }) {
  useMountEffect(() => observeMeasurement(input));
  return null;
}
