/**
 * Development-only fixed-route location player.
 * Linear ~600 m north→south path ending at a chosen destination.
 * No-ops outside __DEV__; never touches background location policy.
 */

import type { Coordinates } from '../types';
import type { LocationSample } from './location';

// ponytail: straight 600 m route; use a MapKit polyline only if route-shape testing becomes necessary.
const DEBUG_START_LATITUDE_OFFSET = 0.0054;
const EMIT_INTERVAL_MS = 1_000;
const DEBUG_ACCURACY_M = 5;

export interface DebugRouteConfig {
  destination: Coordinates;
  simulatedDurationMs: number;
  playbackRate: number;
}

export interface DebugRouteFrame {
  coordinates: Coordinates;
  accuracy: number;
  timestamp: number;
  progress: number;
}

type Listener = (sample: LocationSample) => void;

let active = false;
let config: DebugRouteConfig | null = null;
let startedAtWallMs = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let lastFrame: DebugRouteFrame | null = null;
const listeners = new Set<Listener>();

function startCoordinates(destination: Coordinates): Coordinates {
  return {
    latitude: destination.latitude + DEBUG_START_LATITUDE_OFFSET,
    longitude: destination.longitude,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Pure deterministic sample at wall-clock elapsed ms (after playback rate). */
export function debugRouteSampleAt(
  routeConfig: DebugRouteConfig,
  elapsedWallMs: number,
  startedAt = 0,
): DebugRouteFrame {
  const duration = Math.max(1, routeConfig.simulatedDurationMs);
  const rate = Math.max(0.001, routeConfig.playbackRate);
  const progress = Math.min(1, Math.max(0, ((elapsedWallMs - startedAt) * rate) / duration));
  const start = startCoordinates(routeConfig.destination);
  const latitude = progress >= 1
    ? routeConfig.destination.latitude
    : lerp(start.latitude, routeConfig.destination.latitude, progress);
  const longitude = progress >= 1
    ? routeConfig.destination.longitude
    : lerp(start.longitude, routeConfig.destination.longitude, progress);
  return {
    coordinates: { latitude, longitude },
    accuracy: DEBUG_ACCURACY_M,
    timestamp: Date.now(),
    progress,
  };
}

function emit(frame: DebugRouteFrame): void {
  lastFrame = frame;
  const sample: LocationSample = {
    coordinates: frame.coordinates,
    accuracy: frame.accuracy,
    timestamp: frame.timestamp,
  };
  for (const listener of listeners) {
    try {
      listener(sample);
    } catch {
      // ignore subscriber errors
    }
  }
}

function tick(): void {
  if (!config || !active) return;
  const frame = debugRouteSampleAt(config, Date.now(), startedAtWallMs);
  emit(frame);
  if (frame.progress >= 1 && timer) {
    // Retain final destination sample until explicitly stopped.
    clearInterval(timer);
    timer = null;
  }
}

export function isDebugRouteActive(): boolean {
  return active;
}

export function getDebugLocationSample(): LocationSample | null {
  if (!active || !lastFrame) return null;
  return {
    coordinates: lastFrame.coordinates,
    accuracy: lastFrame.accuracy,
    timestamp: lastFrame.timestamp,
  };
}

export function subscribeDebugLocation(onSample: Listener): () => void {
  listeners.add(onSample);
  if (active && lastFrame) {
    onSample({
      coordinates: lastFrame.coordinates,
      accuracy: lastFrame.accuracy,
      timestamp: lastFrame.timestamp,
    });
  }
  return () => {
    listeners.delete(onSample);
  };
}

export function startDebugRoute(next: DebugRouteConfig): void {
  if (typeof __DEV__ !== 'undefined' && !__DEV__) return;
  stopDebugRoute();
  config = next;
  active = true;
  startedAtWallMs = Date.now();
  const first = debugRouteSampleAt(next, 0);
  // Align timestamps to now for the first sample.
  first.timestamp = Date.now();
  emit(first);
  timer = setInterval(tick, EMIT_INTERVAL_MS);
}

export function stopDebugRoute(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  active = false;
  config = null;
  lastFrame = null;
}
