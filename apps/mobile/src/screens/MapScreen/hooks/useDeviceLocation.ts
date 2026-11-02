import { locationSourceHealth, subscribeLocationSourceHealth } from '../../../native/locationSourceHealth';
import { setSyncTimingProfile } from '../../../state/syncTiming';
import * as Crypto from 'expo-crypto';
import { createElement, useState, useCallback, useRef, type ReactElement, type RefObject, useSyncExternalStore } from 'react';
import { useMountEffect } from '../../../hooks/useMountEffect';
import { AppState, type AppStateStatus } from 'react-native';
import { location } from '../../../native';
import { getLocalAuthActorId } from '../../../api/supabase';
import { setLocationAccessContext, captureLocationAccess, isLocationAccessCurrent, locationConsentRevision } from '../../../state/locationPrivacy';
import { energyObservability } from '../../../state/energyObservability';
import {
  isDebugRouteActive,
  subscribeDebugLocation,
} from '../../../native/debugLocation';
import type { LocationSample } from '../../../native/location';
import type { Coordinates } from '../../../types';
import {
  enqueueLocationOutbox,
  flushLocationOutbox,
} from '../../../state/locationOutbox';
import {
  createMotionState,
  locationPolicy,
  isForegroundLocationState,
  syncTimingScale,
  reduceMotionState,
  shouldAcceptUiSample,
  shouldUploadSample,
  shouldWatchLocation,
  type LocationGateState,
  type MotionState,
  type LocationPowerMode,
} from '../../../utils/locationPolicy';

interface UseDeviceLocationParams {
  groupId: string | null | undefined;
  highAccuracy: boolean;
  navigationTargetKey?: string;
  /** False while preferences or membership are still hydrating. */
  accessReady?: boolean;
  sharingEnabled?: boolean;
  hasMembership?: boolean;
  teamNavigationActive?: boolean;
  /** Shared owner policy: paused foreground uses the same Balanced profile as presence. */
  powerMode?: LocationPowerMode;
  /**
   * Receives every valid, fresh foreground sensor fix before React UI
   * projection throttling. The coordinator can use this for arrival and
   * target state without making the map re-render at GPS callback rate.
   */
  onIncomingSample?: (sample: LocationSample, acceptedAtMs: number) => void;
}

function isUsableLocationSample(sample: LocationSample): boolean {
  const coordinates = sample.coordinates;
  if (!coordinates) return false;
  const { latitude, longitude } = coordinates;
  return Number.isFinite(sample.timestamp)
    && Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90
    && Math.abs(longitude) <= 180;
}

export type ForegroundSampleOptions = {
  /** Important target/arrival consumers may request an immediate UI projection. */
  immediate?: boolean;
};

export function useDeviceLocation({
  groupId,
  highAccuracy,
  navigationTargetKey,
  accessReady = true,
  sharingEnabled = true,
  hasMembership,
  teamNavigationActive = false,
  powerMode = highAccuracy || teamNavigationActive ? 'journey' : 'foreground',
  onIncomingSample,
}: UseDeviceLocationParams) {
  const sourceHealth = useSyncExternalStore(subscribeLocationSourceHealth, locationSourceHealth);
  const [deviceCoords, setDeviceCoords] = useState<Coordinates | null>(null);
  const [deviceAccuracyM, setDeviceAccuracyM] = useState<number | null>(null);
  /** Original capture time of the latest accepted sample, including stationary fixes. */
  const [deviceCoordsAcceptedAtMs, setDeviceCoordsAcceptedAtMs] = useState<number | null>(null);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const foregroundLocationAvailable = isForegroundLocationState(appState);
  const lastSampleAtRef = useRef(0);
  const latestSampleRef = useRef<LocationSample | null>(null);
  const latestUploadRef = useRef<{
    sample: LocationSample;
    groupId: string;
    accessRevision: number;
    completion: Promise<void>;
  } | null>(null);
  const onIncomingSampleRef = useRef(onIncomingSample);
  onIncomingSampleRef.current = onIncomingSample;
  const uiGateRef = useRef<LocationGateState>({ lastCoords: null, lastAtMs: 0 });
  const uploadGateRef = useRef<LocationGateState>({ lastCoords: null, lastAtMs: 0 });
  const motionRef = useRef<MotionState>(createMotionState());
  const forceSyncInFlightRef = useRef(false);
  const groupIdRef = useRef(groupId);
  groupIdRef.current = groupId;
  const highAccuracyRef = useRef(highAccuracy);
  // Precision is an explicit user switch. Team navigation selects the journey
  // power profile but must not silently promote upload/GPS precision.
  highAccuracyRef.current = highAccuracy;
  const powerModeRef = useRef(powerMode);
  powerModeRef.current = powerMode;
  const deviceCoordsRef = useRef(deviceCoords);
  deviceCoordsRef.current = deviceCoords;
  const sharingEnabledRef = useRef(sharingEnabled);
  sharingEnabledRef.current = sharingEnabled;
  const hasMembershipResolved = accessReady && (hasMembership ?? Boolean(groupId));
  const hasMembershipRef = useRef(hasMembershipResolved);
  hasMembershipRef.current = hasMembershipResolved;
  const policyNow = () => locationPolicy(
    highAccuracyRef.current,
    powerModeRef.current,
  );

  const acceptIncomingSample = useCallback((sample: LocationSample, now: number): boolean => {
    if (!groupIdRef.current || !sharingEnabledRef.current || !hasMembershipRef.current
      || !isForegroundLocationState(AppState.currentState) || !isUsableLocationSample(sample)
      || sample.timestamp <= lastSampleAtRef.current || sample.timestamp > now + 120_000) return false;
    lastSampleAtRef.current = sample.timestamp;
    latestSampleRef.current = sample;
    latestUploadRef.current = null;
    try {
      onIncomingSampleRef.current?.(sample, Math.min(now, sample.timestamp));
    } catch {
      // An arrival/target observer is advisory; it must not stop GPS uploads.
    }
    return true;
  }, []);

  const applySampleToUi = useCallback((
    sample: LocationSample,
    now: number,
    options: ForegroundSampleOptions = {},
  ) => {
    const coords = sample.coordinates;
    if (!groupIdRef.current || !sharingEnabledRef.current || !hasMembershipRef.current
      || !isForegroundLocationState(AppState.currentState) || !isUsableLocationSample(sample)) return false;
    setDeviceCoordsAcceptedAtMs(Math.min(now, sample.timestamp));
    if (!options.immediate && !shouldAcceptUiSample(coords, now, uiGateRef.current, policyNow())) {
      return false;
    }
    setDeviceCoords(coords);
    deviceCoordsRef.current = coords;
    setDeviceAccuracyM(
      sample.accuracy != null && Number.isFinite(sample.accuracy) ? sample.accuracy : null,
    );
    uiGateRef.current = { lastCoords: coords, lastAtMs: now };
    return true;
  }, []);

  const enqueueUpload = useCallback(
    async (
      sample: LocationSample,
      now: number,
      requestedGroup = groupIdRef.current,
    ): Promise<void> => {
      const gid = requestedGroup;
      if (!gid || !sharingEnabledRef.current || !hasMembershipRef.current) throw new Error('location_access_denied');
      const access = await captureLocationAccess(gid);
      if (!access) throw new Error('location_access_denied');
      if (gid !== groupIdRef.current || !sharingEnabledRef.current || !hasMembershipRef.current) throw new Error('location_access_changed');
      const eventId = Crypto.randomUUID();
      await enqueueLocationOutbox({
        id: eventId,
        groupId: gid,
        coordinates: {
          ...sample.coordinates,
          ...(sample.accuracy != null && Number.isFinite(sample.accuracy)
            ? { accuracy: sample.accuracy }
            : {}),
        },
        capturedAt: sample.timestamp,
      });
      if (!isLocationAccessCurrent(access) || gid !== groupIdRef.current) throw new Error('location_access_changed');
      uploadGateRef.current = {
        lastCoords: sample.coordinates,
        lastAtMs: now,
      };
      const result = await flushLocationOutbox();
      if (!result.acceptedIds?.includes(eventId)) throw new Error('location_upload_not_confirmed');
    },
    [],
  );

  /**
   * Apply one foreground Expo sample. Raw fixes are kept
   * separate from the throttled React projection so arrival stays accurate
   * without making the map render at callback frequency.
   * Never calls getCurrentLocation — caller owns the sample source.
   */
  const consumeForegroundSample = useCallback(
    (sample: LocationSample, options: ForegroundSampleOptions = {}): void => {
      energyObservability.increment('location_callback');
      const now = Date.now();
      if (!acceptIncomingSample(sample, now)) return;
      const policy = policyNow();
      const coords = sample.coordinates;
      motionRef.current = reduceMotionState(motionRef.current, coords, now, policy, sample.accuracy ?? 0);
      applySampleToUi(sample, now, options);

      energyObservability.increment('location_accepted');
      energyObservability.event('location_acquisition');

      if (
        groupIdRef.current &&
        sharingEnabledRef.current &&
        hasMembershipRef.current &&
        shouldUploadSample(
          coords,
          now,
          uploadGateRef.current,
          policy,
          motionRef.current.cadence,
        )
      ) {
        // Reserve the gate before the async SQLite serial queue starts. GPS
        // callbacks can arrive faster than persistence; without this
        // reservation they would all pass the same stale gate.
        uploadGateRef.current = { lastCoords: coords, lastAtMs: now };
        const requestedGroup = groupIdRef.current;
        const accessRevision = locationConsentRevision();
        const completion = enqueueUpload(sample, now, requestedGroup);
        latestUploadRef.current = { sample, groupId: requestedGroup, accessRevision, completion };
        void completion.catch(() => undefined);
      }
    },
    [acceptIncomingSample, applySampleToUi, enqueueUpload],
  );

  /**
   * Force one-shot GPS + immediate upload (manual refresh / foreground resume).
   * Bypasses distance/time gates — "force sync".
   *
   * @param options.requireUpload When true (Force Refresh), upload failures
   *   propagate so callers can report upload failure independently of reads.
   *   Background/foreground auto paths keep soft-fail upload.
   * @param options.waitForUpload When false, return the accepted fix while its
   *   upload continues. Journey Start uses this so network latency cannot
   *   turn a fresh GPS fix stale before the durable command is queued.
   */
  const refreshDeviceLocation = useCallback(async (options?: {
    requireUpload?: boolean;
    waitForUpload?: boolean;
  }): Promise<Coordinates | null> => {
    const sampleAtRequest = lastSampleAtRef.current;
    energyObservability.increment('location_callback');
    const requestedGroup = groupIdRef.current;
    if (!requestedGroup || !sharingEnabledRef.current || !hasMembershipRef.current || !isForegroundLocationState(AppState.currentState)) return null;
    const requestedActor = await getLocalAuthActorId();
    const access = await captureLocationAccess(requestedGroup);
    if (!access) return null;
    const acquiredFix = await location.getCurrentLocation(
      highAccuracyRef.current,
      powerModeRef.current,
    );
    if (!acquiredFix || await getLocalAuthActorId() !== requestedActor || !isLocationAccessCurrent(access) || !sharingEnabledRef.current || requestedGroup !== groupIdRef.current || !groupIdRef.current || !hasMembershipRef.current || !isForegroundLocationState(AppState.currentState)) return null;
    const now = Date.now();
    const accepted = acceptIncomingSample(acquiredFix, now);
    const latest = latestSampleRef.current;
    // Expo's final permission read can finish after the continuous owner advances.
    const observedDuringRequest = isUsableLocationSample(acquiredFix)
      && acquiredFix.timestamp > sampleAtRequest && acquiredFix.timestamp <= now + 120_000
      && latest != null && (latest.timestamp > acquiredFix.timestamp
        || (latest.timestamp === acquiredFix.timestamp
          && acquiredFix.coordinates.latitude === latest.coordinates.latitude
          && acquiredFix.coordinates.longitude === latest.coordinates.longitude
          && acquiredFix.accuracy === latest.accuracy));
    if (!accepted && !observedDuringRequest) {
      if (options?.requireUpload) throw new Error('no_new_location_sample');
      return null;
    }
    const fix = latest && observedDuringRequest ? latest : acquiredFix;
    if (accepted) {
      energyObservability.increment('location_accepted');
      energyObservability.event('location_acquisition');
      motionRef.current = reduceMotionState(
        motionRef.current, fix.coordinates, now, policyNow(), fix.accuracy ?? 0,
      );
    }
    applySampleToUi(fix, now, { immediate: true });
    if (groupIdRef.current && sharingEnabledRef.current && hasMembershipRef.current) {
      uploadGateRef.current = { lastCoords: fix.coordinates, lastAtMs: now };
      const receipt = latestUploadRef.current;
      const upload = receipt?.sample === latest && receipt.groupId === requestedGroup
        && receipt.accessRevision === access.generation
        ? receipt.completion
        : enqueueUpload(fix, now, requestedGroup);
      if (options?.requireUpload) await upload;
      else if (options?.waitForUpload === false) void upload.catch(() => undefined);
      else await upload.catch(() => undefined);
    }
    if (await getLocalAuthActorId() !== requestedActor || !isLocationAccessCurrent(access) || requestedGroup !== groupIdRef.current
      || !sharingEnabledRef.current || !hasMembershipRef.current
      || !isForegroundLocationState(AppState.currentState)) return null;
    return fix.coordinates;
  }, [acceptIncomingSample, applySampleToUi, enqueueUpload]);

  const [sampleOwner] = useState<DeviceLocationSampleOwner>(() => ({
    uiGateRef, uploadGateRef, lastSampleAtRef, latestSampleRef, motionRef,
    forceSyncInFlightRef, powerModeRef, setAppState, policyNow,
  }));
  const lifecycle = createElement(DeviceLocationLifecycle, { owner: sampleOwner, input: {
    groupId, highAccuracy, navigationTargetKey, teamNavigationActive, powerMode,
    accessReady, sharingEnabled, hasMembershipResolved, appState, foregroundLocationAvailable,
    refreshDeviceLocation, applySampleToUi, consumeForegroundSample,
  } });

  return {
    lifecycle,
    sourceHealth,
    deviceCoords,
    /** Horizontal accuracy of the last accepted device fix, metres. */
    deviceAccuracyM,
    /** When the last UI-accepted sample was applied (ms since epoch). */
    deviceCoordsAcceptedAtMs,
    /** Exposed so MapScreen can own a single GPS path (FG watch vs BG task). */
    appState,
    refreshDeviceLocation,
    consumeForegroundSample,
    /** Raw latest fix for imperative coordinator wiring; does not trigger renders. */
    latestLocationSampleRef: latestSampleRef,
  };
}


interface DeviceLocationSampleOwner {
  uiGateRef: RefObject<LocationGateState>;
  uploadGateRef: RefObject<LocationGateState>;
  lastSampleAtRef: RefObject<number>;
  latestSampleRef: RefObject<LocationSample | null>;
  motionRef: RefObject<MotionState>;
  forceSyncInFlightRef: RefObject<boolean>;
  powerModeRef: RefObject<LocationPowerMode>;
  setAppState: (state: AppStateStatus) => void;
  policyNow: () => ReturnType<typeof locationPolicy>;
}
interface DeviceLocationInput {
  navigationTargetKey?: string;
  groupId: string | null | undefined;
  highAccuracy: boolean;
  teamNavigationActive: boolean;
  powerMode: LocationPowerMode;
  accessReady: boolean;
  sharingEnabled: boolean;
  hasMembershipResolved: boolean;
  appState: AppStateStatus;
  foregroundLocationAvailable: boolean;
  refreshDeviceLocation: (options?: { requireUpload?: boolean }) => Promise<Coordinates | null>;
  applySampleToUi: (sample: LocationSample, now: number, options?: ForegroundSampleOptions) => boolean;
  consumeForegroundSample: (sample: LocationSample, options?: ForegroundSampleOptions) => void;
}
interface DeviceLocationResources {
  previous: DeviceLocationInput | null;
  sourceStartedAtMs: number;
  appStateSubscription: { remove(): void } | null;
  stopWatch: (() => void) | null;
  stopDebug: (() => void) | null;
  watchdog: ReturnType<typeof setInterval> | null;
}

/** The same owner publishes access before any synchronous native sample can arrive. */
function DeviceLocationLifecycle({ owner, input }: {
  owner: DeviceLocationSampleOwner; input: DeviceLocationInput;
}): ReactElement {
  const [resources] = useState<DeviceLocationResources>(() => ({
    previous: null, sourceStartedAtMs: Date.now(), appStateSubscription: null, stopWatch: null, stopDebug: null, watchdog: null,
  }));
  const [profile, setProfile] = useState(() => ({ input, generation: 0 }));
  const previous = profile.input;
  if (!Object.is(previous.groupId, input.groupId)
    || !Object.is(previous.navigationTargetKey, input.navigationTargetKey)
    || !Object.is(previous.highAccuracy, input.highAccuracy)
    || !Object.is(previous.teamNavigationActive, input.teamNavigationActive)
    || !Object.is(previous.powerMode, input.powerMode)
    || !Object.is(previous.accessReady, input.accessReady)
    || !Object.is(previous.sharingEnabled, input.sharingEnabled)
    || !Object.is(previous.hasMembershipResolved, input.hasMembershipResolved)
    || !Object.is(previous.appState, input.appState)
    || !Object.is(previous.foregroundLocationAvailable, input.foregroundLocationAvailable)
    || !Object.is(previous.refreshDeviceLocation, input.refreshDeviceLocation)
    || !Object.is(previous.applySampleToUi, input.applySampleToUi)
    || !Object.is(previous.consumeForegroundSample, input.consumeForegroundSample)) {
    setProfile({ input, generation: profile.generation + 1 });
  }
  useMountEffect(() => () => {
    resources.stopWatch?.(); resources.stopWatch = null;
    resources.stopDebug?.(); resources.stopDebug = null;
    if (resources.watchdog) clearInterval(resources.watchdog);
    resources.watchdog = null;
    resources.appStateSubscription?.remove(); resources.appStateSubscription = null;
    resources.previous = null;
    setSyncTimingProfile(false, 'allDay');
    setLocationAccessContext(null, false);
  });
  return createElement(DeviceLocationProfile, {
    key: profile.generation, owner, resources, input: profile.input,
  });
}

/** Concrete location lifetimes share ordered privacy, gate reset and source ownership. */
function DeviceLocationProfile({ owner, resources, input }: {
  owner: DeviceLocationSampleOwner; resources: DeviceLocationResources; input: DeviceLocationInput;
}): null {
  useMountEffect(() => {
    const old = resources.previous;
    const { groupId, highAccuracy, navigationTargetKey, teamNavigationActive, powerMode,
      accessReady, sharingEnabled, hasMembershipResolved, appState, foregroundLocationAvailable,
      refreshDeviceLocation, applySampleToUi, consumeForegroundSample } = input;
    setSyncTimingProfile(highAccuracy, powerMode);
    const scopeChanged = !old || !Object.is(old.foregroundLocationAvailable, foregroundLocationAvailable)
      || !Object.is(old.groupId, groupId) || !Object.is(old.sharingEnabled, sharingEnabled)
      || !Object.is(old.hasMembershipResolved, hasMembershipResolved);
    const targetChanged = Boolean(navigationTargetKey) && (!old || !Object.is(old.navigationTargetKey, navigationTargetKey));
    const bootstrapChanged = scopeChanged || !old
      || targetChanged
      || !Object.is(old.powerMode, powerMode) || !Object.is(old.highAccuracy, highAccuracy)
      || !Object.is(old.refreshDeviceLocation, refreshDeviceLocation);
    const debugChanged = scopeChanged || !old || !Object.is(old.applySampleToUi, applySampleToUi);
    const watchChanged = scopeChanged || !old || !Object.is(old.highAccuracy, highAccuracy)
      || !Object.is(old.powerMode, powerMode) || !Object.is(old.teamNavigationActive, teamNavigationActive)
      || !Object.is(old.consumeForegroundSample, consumeForegroundSample);
    // Stop accepting the old source before changing privacy or resetting shared gates.
    if (watchChanged) { resources.stopWatch?.(); resources.stopWatch = null; resources.sourceStartedAtMs = Date.now(); }
    if (debugChanged) { resources.stopDebug?.(); resources.stopDebug = null; }
    if (bootstrapChanged && resources.watchdog) { clearInterval(resources.watchdog); resources.watchdog = null; }
    if (!old || !Object.is(old.accessReady, accessReady) || !Object.is(old.groupId, groupId) || !Object.is(old.hasMembershipResolved, hasMembershipResolved)
      || !Object.is(old.sharingEnabled, sharingEnabled) || !Object.is(old.appState, appState)) {
      setLocationAccessContext(accessReady ? (hasMembershipResolved ? groupId ?? null : null) : undefined, sharingEnabled, accessReady && appState === 'active');
    }
    if (!resources.appStateSubscription) {
      resources.appStateSubscription = AppState.addEventListener('change', owner.setAppState);
    }
    // Profile reset deliberately preserves the displayed React sample.
    if (!old || !Object.is(old.highAccuracy, highAccuracy) || !Object.is(old.teamNavigationActive, teamNavigationActive)
      || !Object.is(old.powerMode, powerMode) || !Object.is(old.groupId, groupId)) {
      owner.uiGateRef.current = { lastCoords: null, lastAtMs: 0 };
      owner.uploadGateRef.current = { lastCoords: null, lastAtMs: 0 };
      owner.lastSampleAtRef.current = 0;
      owner.latestSampleRef.current = null;
      owner.motionRef.current = createMotionState(Date.now());
    }
    if (targetChanged) owner.uiGateRef.current = { lastCoords: null, lastAtMs: 0 };
    const foregroundAllowed = Boolean(groupId && isForegroundLocationState(appState) && sharingEnabled && hasMembershipResolved);
    const watchAllowed = shouldWatchLocation(groupId ?? null, appState, sharingEnabled, hasMembershipResolved);
    if (bootstrapChanged && foregroundAllowed
      && !owner.forceSyncInFlightRef.current) {
      owner.forceSyncInFlightRef.current = true;
      void refreshDeviceLocation().catch(() => null).finally(() => { owner.forceSyncInFlightRef.current = false; });
    }
    if (scopeChanged && foregroundAllowed) void flushLocationOutbox().catch(() => undefined);
    if (bootstrapChanged && foregroundAllowed) {
      resources.watchdog = setInterval(() => {
        void flushLocationOutbox().catch(() => undefined);
        const silenceLimit = Math.max(60_000 * syncTimingScale(highAccuracy, powerMode), owner.policyNow().timeInterval * 2);
        if (Date.now() - Math.max(owner.lastSampleAtRef.current, resources.sourceStartedAtMs) < silenceLimit || owner.forceSyncInFlightRef.current) return;
        owner.forceSyncInFlightRef.current = true;
        void refreshDeviceLocation().catch(() => null).finally(() => { owner.forceSyncInFlightRef.current = false; });
      }, 30_000 * syncTimingScale(highAccuracy, powerMode));
    }
    // Debug samples stay local and never enter the team location outbox.
    if (debugChanged && watchAllowed) {
      resources.stopDebug = subscribeDebugLocation((sample: LocationSample) => {
        if (!isDebugRouteActive()) return;
        const now = Date.now();
        owner.motionRef.current = reduceMotionState(owner.motionRef.current, sample.coordinates, now, owner.policyNow());
        applySampleToUi(sample, now, { immediate: true });
      });
    }
    if (watchChanged && watchAllowed) {
      let cancelled = false;
      let stop = () => {};
      void location.watchLocation((sample: LocationSample) => {
        if (!cancelled) consumeForegroundSample(sample);
      }, highAccuracy, powerMode).then((unsubscribe: () => void) => {
        if (cancelled) unsubscribe();
        else stop = unsubscribe;
      }).catch(() => undefined);
      resources.stopWatch = () => { cancelled = true; stop(); };
    }
    resources.previous = input;
  });
  return null;
}
