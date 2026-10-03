import { useEffect, useRef, type RefObject } from 'react';
import type { Coordinates } from '../types';
import { memberMotionDuration, type MemberMotionSample } from '../utils/memberMotion';

interface MarkerMotionHandle {
  animateMarkerToCoordinate: (coordinates: Coordinates, duration: number) => void;
}

/** Only commands own subsequent coordinates: React props never preempt native interpolation. */
export function useMemberMarkerMotion(
  markerRef: RefObject<MarkerMotionHandle | null>,
  sample: MemberMotionSample,
  canAnimate: boolean,
): Coordinates | null {
  const { latitude, longitude } = sample.coordinates;
  const sampledAt = sample.sampledAt;
  const valid = Number.isFinite(latitude) && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
  const initialCoordinate = useRef<Coordinates | null>(null);
  if (valid && !initialCoordinate.current) initialCoordinate.current = sample.coordinates;
  const lastSample = useRef<MemberMotionSample | null>(null);
  const wasAnimating = useRef(false);

  useEffect(() => {
    const previous = lastSample.current;
    let next = { coordinates: { latitude, longitude }, sampledAt };
    const monotonic = !previous || !Number.isFinite(previous.sampledAt)
      || (Number.isFinite(sampledAt) && sampledAt > previous.sampledAt);
    if (!valid || !monotonic) {
      // A power/lifecycle transition still cancels the old animation at its
      // last accepted true endpoint, without accepting a late GPS fix.
      if (!previous || wasAnimating.current === canAnimate) return;
      next = previous;
    }
    const duration = memberMotionDuration(previous, next, Date.now(), canAnimate && wasAnimating.current);
    wasAnimating.current = canAnimate;
    lastSample.current = next;
    markerRef.current?.animateMarkerToCoordinate(next.coordinates, duration);
  }, [latitude, longitude, sampledAt, valid, canAnimate, markerRef]);

  useEffect(() => () => {
    if (lastSample.current) markerRef.current?.animateMarkerToCoordinate(lastSample.current.coordinates, 0);
  }, [markerRef]);
  return initialCoordinate.current;
}
