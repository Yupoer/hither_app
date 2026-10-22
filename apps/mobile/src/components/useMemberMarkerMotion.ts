import { createElement, useState, useRef, type RefObject, type ReactElement } from 'react';
import { useMountEffect } from '../hooks/useMountEffect';
import type { Coordinates } from '../types';
import { memberMotionDuration, type MemberMotionSample } from '../utils/memberMotion';

interface MarkerMotionHandle {
  animateMarkerToCoordinate: (coordinates: Coordinates, duration: number) => void;
}
interface MarkerMotionInput {
  latitude: number;
  longitude: number;
  sampledAt: number;
  valid: boolean;
  canAnimate: boolean;
  markerRef: RefObject<MarkerMotionHandle | null>;
}
interface MarkerMotionOwner {
  lastSample: MemberMotionSample | null;
  wasAnimating: boolean;
}

/** Only commands own subsequent coordinates: React props never preempt native interpolation. */
export function useMemberMarkerMotion(
  markerRef: RefObject<MarkerMotionHandle | null>,
  sample: MemberMotionSample,
  canAnimate: boolean,
): { coordinate: Coordinates | null; lifecycle: ReactElement } {
  const { latitude, longitude } = sample.coordinates;
  const sampledAt = sample.sampledAt;
  const valid = Number.isFinite(latitude) && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
  const initialCoordinate = useRef<Coordinates | null>(null);
  if (valid && !initialCoordinate.current) initialCoordinate.current = sample.coordinates;
  const [owner] = useState<MarkerMotionOwner>(() => ({ lastSample: null, wasAnimating: false }));
  return { coordinate: initialCoordinate.current,
    lifecycle: createElement(MemberMarkerLifecycle, { owner,
      input: { latitude, longitude, sampledAt, valid, canAnimate, markerRef } }) };
}

function MemberMarkerLifecycle({ owner, input }: {
  owner: MarkerMotionOwner; input: MarkerMotionInput;
}): ReactElement {
  const [motion, setMotion] = useState(() => ({ input, commandGeneration: 0, attachmentGeneration: 0 }));
  const previous = motion.input;
  if (!Object.is(previous.latitude, input.latitude) || !Object.is(previous.longitude, input.longitude)
    || !Object.is(previous.sampledAt, input.sampledAt) || !Object.is(previous.valid, input.valid)
    || !Object.is(previous.canAnimate, input.canAnimate) || !Object.is(previous.markerRef, input.markerRef)) {
    setMotion({ input, commandGeneration: motion.commandGeneration + 1,
      attachmentGeneration: motion.attachmentGeneration + (Object.is(previous.markerRef, input.markerRef) ? 0 : 1) });
  }
  return createElement(MemberMarkerAttachment, { key: motion.attachmentGeneration,
    owner, input: motion.input, commandGeneration: motion.commandGeneration });
}

function MemberMarkerAttachment({ owner, input, commandGeneration }: {
  owner: MarkerMotionOwner; input: MarkerMotionInput; commandGeneration: number;
}): ReactElement {
  const markerRef = input.markerRef;
  useMountEffect(() => () => {
    if (owner.lastSample) markerRef.current?.animateMarkerToCoordinate(owner.lastSample.coordinates, 0);
  });
  return createElement(MemberMarkerCommand, { key: commandGeneration, owner, input });
}

function MemberMarkerCommand({ owner, input }: {
  owner: MarkerMotionOwner; input: MarkerMotionInput;
}): null {
  useMountEffect(() => {
    const { latitude, longitude, sampledAt, valid, canAnimate, markerRef } = input;
    const previous = owner.lastSample;
    let next = { coordinates: { latitude, longitude }, sampledAt };
    const monotonic = !previous || !Number.isFinite(previous.sampledAt)
      || (Number.isFinite(sampledAt) && sampledAt > previous.sampledAt);
    if (!valid || !monotonic) {
      // A policy transition snaps to the last accepted endpoint without accepting a late fix.
      if (!previous || owner.wasAnimating === canAnimate) return;
      next = previous;
    }
    const duration = memberMotionDuration(previous, next, Date.now(), canAnimate && owner.wasAnimating);
    owner.wasAnimating = canAnimate;
    owner.lastSample = next;
    markerRef.current?.animateMarkerToCoordinate(next.coordinates, duration);
  });
  return null;
}
