import React, { useState } from 'react';
import { useMountEffect } from '../../hooks/useMountEffect';
import type { CoreOperation } from '../../types/coreData';
import type { Destination } from '../../types';
import type { GroupMapHandle } from '../../components/GroupMap';
import type { TravelMode } from '../../utils/geo';
import type { useSession } from '../../state/SessionContext';
import type { usePreferences } from '../../state/PreferencesContext';
import type { useGroupState } from '../../state/useGroupState';
import type { useNavigationSession } from '../../state/useNavigationSession';
import type { useTranslation } from '../../i18n';
import type { useDeviceLocation } from './hooks/useDeviceLocation';
import type { useJourneyNavigation } from './hooks/useJourneyNavigation';
import type { useMapKitRoutes } from './hooks/useMapKitRoutes';
import type { usePersonalProgressSurfaces } from './hooks/usePersonalProgressSurfaces';
import type { FavoritePlace } from '../../api/client';
import { hydrateLocationSharing } from "../../state/locationSharingSync";
import { AppState, Keyboard, Platform } from "react-native";
import { notifyJourneyApproach } from "../../state/journeyNotifications";
import { shouldFireApproachNotify } from "../../utils/approachNotify";
import { getCoreOperationOutbox, subscribeCoreOutboxChanges } from "../../state/coreDataSync";
import { energyObservability } from "../../state/energyObservability";
import { readAddPlaceTourCompletedLocal, retryPendingAddPlaceTourAccountSync } from "../../featureTour";
import { consumePendingLocationPermission, recoverPendingLocationRefreshes } from "../../state/backgroundLocationRefresh";
import { location } from "../../native";
import { listFavoritePlaces } from "../../api/client";
import AsyncStorage from "@react-native-async-storage/async-storage";

type MapArrivalOutboxInput = {
  groupId: string | null;
  setArrivalOperations: React.Dispatch<React.SetStateAction<CoreOperation[]>>;
  user: Pick<NonNullable<ReturnType<typeof useSession>['user']>, 'id'> | null;
};

export function MapArrivalOutboxResource(input: MapArrivalOutboxInput) {
  const [previous, setPrevious] = useState({ input, generation: 0 });
  if (!Object.is(previous.input.groupId, input.groupId)
    || !Object.is(previous.input.user?.id, input.user?.id)) {
    setPrevious({ input, generation: previous.generation + 1 });
  }
  return <MapArrivalOutboxJob key={previous.generation} input={input} />;
}

function MapArrivalOutboxJob({ input }: { input: MapArrivalOutboxInput }) {
  const { groupId, setArrivalOperations } = input;
  useMountEffect(() => {
    let active = true;
    const reload = async () => {
      const rows = groupId ? await getCoreOperationOutbox().listByGroup(groupId) : [];
      if (active) setArrivalOperations(rows.filter(op =>
        op.operationType === 'record_arrival' || op.operationType === 'leader_correct_arrival'));
    };
    void reload().catch(() => undefined);
    const unsubscribe = subscribeCoreOutboxChanges(() => { void reload().catch(() => undefined); });
    return () => { active = false; unsubscribe(); };
  });
  return null;
}

type MapForegroundNavigationInput = {
  groupId: string | null;
  navigationSessionState: Pick<ReturnType<typeof useNavigationSession>, 'refresh'>;
  refresh: ReturnType<typeof useGroupState>['refresh'];
};

export function MapForegroundNavigationResource(input: MapForegroundNavigationInput) {
  const [previous, setPrevious] = useState({ input, generation: 0 });
  if (!Object.is(previous.input.groupId, input.groupId)
    || !Object.is(previous.input.navigationSessionState.refresh, input.navigationSessionState.refresh)
    || !Object.is(previous.input.refresh, input.refresh)) {
    setPrevious({ input, generation: previous.generation + 1 });
  }
  return <MapForegroundNavigationJob key={previous.generation} input={input} />;
}

function MapForegroundNavigationJob({ input }: { input: MapForegroundNavigationInput }) {
  const { groupId, navigationSessionState, refresh } = input;
  useMountEffect(() => {
    const onAppState = (next: string) => {
      if (next !== 'active' || !groupId) return;
      void navigationSessionState.refresh().catch(() => undefined);
      void refresh().catch(() => undefined);
    };
    const sub = AppState.addEventListener('change', onAppState);
    return () => sub.remove();
  });
  return null;
}

type MapCardWorkloadInput = {
  uiVisible: boolean;
  destinations: Destination[];
};

export function MapCardWorkloadResource(input: MapCardWorkloadInput) {
  const [previous, setPrevious] = useState({ input, generation: 0 });
  if (!Object.is(previous.input.uiVisible, input.uiVisible)
    || !Object.is(previous.input.destinations.length, input.destinations.length)) {
    setPrevious({ input, generation: previous.generation + 1 });
  }
  return <MapCardWorkloadJob key={previous.generation} input={input} />;
}

function MapCardWorkloadJob({ input }: { input: MapCardWorkloadInput }) {
  const { uiVisible, destinations } = input;
  useMountEffect(() => energyObservability.mountWorkload({ mountedCardCount: uiVisible ? destinations.length : 0 }));
  return null;
}

type MapKmlQuotaInput = {
  refreshKmlQuota: () => Promise<void>;
};

export function MapKmlQuotaResource(input: MapKmlQuotaInput) {
  const [previous, setPrevious] = useState({ input, generation: 0 });
  if (!Object.is(previous.input.refreshKmlQuota, input.refreshKmlQuota)) {
    setPrevious({ input, generation: previous.generation + 1 });
  }
  return <MapKmlQuotaJob key={previous.generation} input={input} />;
}

function MapKmlQuotaJob({ input }: { input: MapKmlQuotaInput }) {
  const { refreshKmlQuota } = input;
  useMountEffect(() => {
    void refreshKmlQuota();
  });
  return null;
}

type MapConfirmKeyboardInput = {
  confirmCardReady: boolean;
  setConfirmKeyboardHeight: React.Dispatch<React.SetStateAction<number>>;
};

export function MapConfirmKeyboardResource(input: MapConfirmKeyboardInput) {
  const [previous, setPrevious] = useState({ input, generation: 0 });
  if (!Object.is(previous.input.confirmCardReady, input.confirmCardReady)) {
    setPrevious({ input, generation: previous.generation + 1 });
  }
  return <MapConfirmKeyboardJob key={previous.generation} input={input} />;
}

function MapConfirmKeyboardJob({ input }: { input: MapConfirmKeyboardInput }) {
  const { confirmCardReady, setConfirmKeyboardHeight } = input;
  useMountEffect(() => {
    if (!confirmCardReady) {
      setConfirmKeyboardHeight(0);
      return;
    }
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      setConfirmKeyboardHeight(e.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setConfirmKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  });
  return null;
}

type MapAccountPlacesInput = {
  user: Pick<NonNullable<ReturnType<typeof useSession>['user']>, 'id' | 'preferences'> | null;
  setFavoritePlaces: React.Dispatch<React.SetStateAction<FavoritePlace[]>>;
  setAddPlaceTourLocalDone: React.Dispatch<React.SetStateAction<boolean>>;
};

export function MapAccountPlacesResource(input: MapAccountPlacesInput) {
  const [previous, setPrevious] = useState({ input, generation: 0 });
  if (!Object.is(previous.input.user?.id, input.user?.id)) {
    setPrevious({ input, generation: previous.generation + 1 });
  }
  return <MapAccountPlacesJob key={previous.generation} input={input} />;
}

function MapAccountPlacesJob({ input }: { input: MapAccountPlacesInput }) {
  const { user, setFavoritePlaces, setAddPlaceTourLocalDone } = input;
  useMountEffect(() => {
    if (!user?.id) {
      setFavoritePlaces([]);
      return;
    }
    let cancelled = false;
    void listFavoritePlaces()
      .then((rows) => {
        if (!cancelled) setFavoritePlaces(rows);
      })
      .catch(() => {
        if (!cancelled) setFavoritePlaces([]);
      });
    void readAddPlaceTourCompletedLocal(user?.id).then((done) => {
      if (!cancelled) setAddPlaceTourLocalDone(done);
    });
    // Retry account completion sync left pending after a prior profile write failure.
    void retryPendingAddPlaceTourAccountSync({
      accountId: user.id,
      existingPreferences: user.preferences ?? null,
    });
    return () => {
      cancelled = true;
    };
  });
  return null;
}

type MapNavigationStartFrameInput = {
  deviceCoords: ReturnType<typeof useDeviceLocation>['deviceCoords'];
  refreshStartFrame: ReturnType<typeof useJourneyNavigation>['refreshStartFrame'];
};

export function MapNavigationStartFrameResource(input: MapNavigationStartFrameInput) {
  const [previous, setPrevious] = useState({ input, generation: 0 });
  if (!Object.is(previous.input.deviceCoords, input.deviceCoords)
    || !Object.is(previous.input.refreshStartFrame, input.refreshStartFrame)) {
    setPrevious({ input, generation: previous.generation + 1 });
  }
  return <MapNavigationStartFrameJob key={previous.generation} input={input} />;
}

function MapNavigationStartFrameJob({ input }: { input: MapNavigationStartFrameInput }) {
  const { deviceCoords, refreshStartFrame } = input;
  useMountEffect(() => {
    if (deviceCoords) refreshStartFrame();
  });
  return null;
}

type MapSharingHydrationInput = {
  preferencesReady: boolean;
  user: Pick<NonNullable<ReturnType<typeof useSession>['user']>, 'id'> | null;
  privacyHydratedUserRef: React.RefObject<string | null>;
  setSharingEnabled: ReturnType<typeof usePreferences>['setSharingEnabled'];
};

export function MapSharingHydrationResource(input: MapSharingHydrationInput) {
  const [previous, setPrevious] = useState({ input, generation: 0 });
  if (!Object.is(previous.input.preferencesReady, input.preferencesReady)
    || !Object.is(previous.input.setSharingEnabled, input.setSharingEnabled)
    || !Object.is(previous.input.user?.id, input.user?.id)) {
    setPrevious({ input, generation: previous.generation + 1 });
  }
  return <MapSharingHydrationJob key={previous.generation} input={input} />;
}

function MapSharingHydrationJob({ input }: { input: MapSharingHydrationInput }) {
  const { preferencesReady, user, privacyHydratedUserRef, setSharingEnabled } = input;
  useMountEffect(() => {
    if (!preferencesReady || !user?.id || privacyHydratedUserRef.current === user.id) {
      return;
    }
    privacyHydratedUserRef.current = user.id;
    let cancelled = false;
    void hydrateLocationSharing(user.id)
      .then((enabled) => { if (!cancelled && enabled != null) setSharingEnabled(enabled); })
      .catch(() => {
        privacyHydratedUserRef.current = null;
      });
    return () => { cancelled = true; };
  });
  return null;
}

type MapNavigationAckInput = {
  isLeader: boolean;
  navigationSessionState: Pick<ReturnType<typeof useNavigationSession>, 'session' | 'ack'>;
  navigationAckRef: React.RefObject<string | null>;
  sharingEnabled: boolean;
};

export function MapNavigationAckResource(input: MapNavigationAckInput) {
  const [previous, setPrevious] = useState({ input, generation: 0 });
  if (!Object.is(previous.input.isLeader, input.isLeader)
    || !Object.is(previous.input.navigationSessionState, input.navigationSessionState)
    || !Object.is(previous.input.sharingEnabled, input.sharingEnabled)) {
    setPrevious({ input, generation: previous.generation + 1 });
  }
  return <MapNavigationAckJob key={previous.generation} input={input} />;
}

function MapNavigationAckJob({ input }: { input: MapNavigationAckInput }) {
  const { isLeader, navigationSessionState, navigationAckRef, sharingEnabled } = input;
  useMountEffect(() => {
    if (isLeader || !navigationSessionState.session) {
      navigationAckRef.current = null;
      return;
    }
    const key = `${navigationSessionState.session.id}:${sharingEnabled ? 'tracking' : 'disabled'}`;
    if (navigationAckRef.current === key) return;
    navigationAckRef.current = key;
    void navigationSessionState.ack(
      sharingEnabled ? 'tracking_active' : 'sharing_disabled',
      { source: 'foreground_session_effect' },
    ).catch(() => {
      navigationAckRef.current = null;
    });
  });
  return null;
}

type MapTrackingModeInput = {
  sharingEnabled: boolean;
  appState: ReturnType<typeof useDeviceLocation>['appState'];
  effectiveNavigationActive: boolean;
  highAccuracy: boolean;
};

export function MapTrackingModeResource(input: MapTrackingModeInput) {
  const [previous, setPrevious] = useState({ input, generation: 0 });
  if (!Object.is(previous.input.appState, input.appState)
    || !Object.is(previous.input.highAccuracy, input.highAccuracy)
    || !Object.is(previous.input.effectiveNavigationActive, input.effectiveNavigationActive)
    || !Object.is(previous.input.sharingEnabled, input.sharingEnabled)) {
    setPrevious({ input, generation: previous.generation + 1 });
  }
  return <MapTrackingModeJob key={previous.generation} input={input} />;
}

function MapTrackingModeJob({ input }: { input: MapTrackingModeInput }) {
  const { sharingEnabled, appState, effectiveNavigationActive, highAccuracy } = input;
  useMountEffect(() => {
    energyObservability.setTrackingMode(!sharingEnabled ? 'hidden'
      : appState === 'background' ? effectiveNavigationActive ? highAccuracy ? 'navigationMax' : 'teamNavigation' : 'passiveBackground'
      : effectiveNavigationActive ? highAccuracy ? 'navigationMax' : 'teamNavigation' : 'foreground');
  });
  return null;
}

type MapRouteCameraInput = {
  activePoint: ReturnType<typeof useJourneyNavigation>['activePoint'];
  travelMode: TravelMode;
  lastFittedRouteRef: React.RefObject<string | null>;
  selfRoute: ReturnType<typeof useMapKitRoutes>['selfRoute'];
  mapRef: React.RefObject<GroupMapHandle | null>;
  deviceCoords: ReturnType<typeof useDeviceLocation>['deviceCoords'];
};

export function MapRouteCameraResource(input: MapRouteCameraInput) {
  const [previous, setPrevious] = useState({ input, generation: 0 });
  if (!Object.is(previous.input.activePoint, input.activePoint)
    || !Object.is(previous.input.selfRoute, input.selfRoute)
    || !Object.is(previous.input.travelMode, input.travelMode)
    || !Object.is(previous.input.deviceCoords, input.deviceCoords)) {
    setPrevious({ input, generation: previous.generation + 1 });
  }
  return <MapRouteCameraJob key={previous.generation} input={input} />;
}

function MapRouteCameraJob({ input }: { input: MapRouteCameraInput }) {
  const { activePoint, travelMode, lastFittedRouteRef, selfRoute, mapRef, deviceCoords } = input;
  useMountEffect(() => {
    const key = activePoint ? `${activePoint.id}:${travelMode}` : null;
    if (activePoint && key && key !== lastFittedRouteRef.current && selfRoute?.points.length) {
      lastFittedRouteRef.current = key;
      mapRef.current?.fitRoute([
        ...selfRoute.points,
        ...(deviceCoords ? [deviceCoords] : []),
        activePoint.coordinates,
      ]);
    }
    if (!key) lastFittedRouteRef.current = null;
  });
  return null;
}

type MapProgressDeadlineInput = {
  journeyActive: boolean;
  navTarget: Pick<Destination, 'id'> | null | undefined;
  deviceCoordsAcceptedAtMs: number | null;
  setProgressClockMs: React.Dispatch<React.SetStateAction<number>>;
  PERSONAL_PROGRESS_STALE_MS: number;
};

export function MapProgressDeadlineResource(input: MapProgressDeadlineInput) {
  const [previous, setPrevious] = useState({ input, generation: 0 });
  if (!Object.is(previous.input.journeyActive, input.journeyActive)
    || !Object.is(previous.input.navTarget?.id, input.navTarget?.id)
    || !Object.is(previous.input.deviceCoordsAcceptedAtMs, input.deviceCoordsAcceptedAtMs)) {
    setPrevious({ input, generation: previous.generation + 1 });
  }
  return <MapProgressDeadlineJob key={previous.generation} input={input} />;
}

function MapProgressDeadlineJob({ input }: { input: MapProgressDeadlineInput }) {
  const { journeyActive, navTarget, deviceCoordsAcceptedAtMs, setProgressClockMs, PERSONAL_PROGRESS_STALE_MS } = input;
  useMountEffect(() => {
    if (!journeyActive || !navTarget || deviceCoordsAcceptedAtMs == null) {
      return;
    }
    const now = Date.now();
    setProgressClockMs(now);
    const age = Math.max(0, now - deviceCoordsAcceptedAtMs);
    if (age >= PERSONAL_PROGRESS_STALE_MS) {
      return;
    }
    const timer = setTimeout(() => {
      setProgressClockMs(Date.now());
    }, PERSONAL_PROGRESS_STALE_MS - age + 50);
    return () => clearTimeout(timer);
  });
  return null;
}

type MapApproachNoticeInput = {
  journeyActive: boolean;
  navTarget: ReturnType<typeof useJourneyNavigation>['navTarget'];
  personalProgress: ReturnType<typeof usePersonalProgressSurfaces>['personalProgress'];
  initialDistanceM: number | undefined;
  localArrivalRadiusM: number;
  localNavigationArrived: boolean;
  navigationSessionState: Pick<ReturnType<typeof useNavigationSession>, 'session'>;
};

export function MapApproachNoticeResource(input: MapApproachNoticeInput) {
  const [previous, setPrevious] = useState({ input, generation: 0 });
  if (!Object.is(previous.input.journeyActive, input.journeyActive)
    || !Object.is(previous.input.navTarget, input.navTarget)
    || !Object.is(previous.input.personalProgress.arrived, input.personalProgress.arrived)
    || !Object.is(previous.input.personalProgress.distanceMeters, input.personalProgress.distanceMeters)
    || !Object.is(previous.input.initialDistanceM, input.initialDistanceM)
    || !Object.is(previous.input.localArrivalRadiusM, input.localArrivalRadiusM)
    || !Object.is(previous.input.localNavigationArrived, input.localNavigationArrived)
    || !Object.is(previous.input.navigationSessionState.session?.id, input.navigationSessionState.session?.id)) {
    setPrevious({ input, generation: previous.generation + 1 });
  }
  return <MapApproachNoticeJob key={previous.generation} input={input} />;
}

function MapApproachNoticeJob({ input }: { input: MapApproachNoticeInput }) {
  const { journeyActive, navTarget, personalProgress, initialDistanceM, localArrivalRadiusM, localNavigationArrived, navigationSessionState } = input;
  useMountEffect(() => {
    if (!journeyActive || !navTarget || personalProgress.arrived) return;
    const remaining = personalProgress.distanceMeters;
    const total = initialDistanceM;
    if (remaining == null || total == null) return;
    if (!shouldFireApproachNotify({
      remainingM: remaining,
      totalM: total,
      arrivalRadiusM: localArrivalRadiusM,
      arrived: personalProgress.arrived || localNavigationArrived,
      alreadyFired: false,
    })) return;
    void notifyJourneyApproach(navigationSessionState.session?.id, navTarget.id, navTarget.title, {
      remainingM: remaining, totalM: total, arrivalRadiusM: localArrivalRadiusM,
      arrived: personalProgress.arrived || localNavigationArrived, alreadyFired: false,
    }).catch(() => undefined);
  });
  return null;
}

type MapPermissionRecoveryInput = {
  appState: ReturnType<typeof useDeviceLocation>['appState'];
  backgroundPermissionDeniedRef: React.RefObject<string | null>;
  showLocationPermissionAlert: (title?: string, body?: string) => void;
  t: ReturnType<typeof useTranslation>['t'];
  groupId: string | null;
};

export function MapPermissionRecoveryResource(input: MapPermissionRecoveryInput) {
  const [previous, setPrevious] = useState({ input, generation: 0 });
  if (!Object.is(previous.input.appState, input.appState)
    || !Object.is(previous.input.groupId, input.groupId)
    || !Object.is(previous.input.showLocationPermissionAlert, input.showLocationPermissionAlert)
    || !Object.is(previous.input.t, input.t)) {
    setPrevious({ input, generation: previous.generation + 1 });
  }
  return <MapPermissionRecoveryJob key={previous.generation} input={input} />;
}

function MapPermissionRecoveryJob({ input }: { input: MapPermissionRecoveryInput }) {
  const { appState, backgroundPermissionDeniedRef, showLocationPermissionAlert, t } = input;
  useMountEffect(() => {
    if (appState !== 'active') return;
    void Promise.all([
      location.getPermissionState().catch(() => null),
      consumePendingLocationPermission(),
    ]).then(([permission, pending]) => {
      if (permission?.backgroundStatus === 'granted') {
        backgroundPermissionDeniedRef.current = null;
      }
      if (pending && permission?.backgroundStatus !== 'granted') {
        showLocationPermissionAlert(
          t('map.bgLocationTitle'),
          t('map.bgLocationBody'),
        );
      }
    });
    void recoverPendingLocationRefreshes();
  });
  return null;
}

type MapRouteScopePreferenceInput = {
  myScopeId: string | undefined;
  routeScopeStorageKey: string | null;
  setRouteScopeExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
};

export function MapRouteScopePreferenceResource(input: MapRouteScopePreferenceInput) {
  const [previous, setPrevious] = useState({ input, generation: 0 });
  if (!Object.is(previous.input.myScopeId, input.myScopeId)
    || !Object.is(previous.input.routeScopeStorageKey, input.routeScopeStorageKey)) {
    setPrevious({ input, generation: previous.generation + 1 });
  }
  return <MapRouteScopePreferenceJob key={previous.generation} input={input} />;
}

function MapRouteScopePreferenceJob({ input }: { input: MapRouteScopePreferenceInput }) {
  const { myScopeId, routeScopeStorageKey, setRouteScopeExpanded } = input;
  useMountEffect(() => {
    let cancelled = false;
    const defaults: Record<string, boolean> = myScopeId
      ? { main: false, subgroup: true }
      : { main: true };
    if (!routeScopeStorageKey) {
      setRouteScopeExpanded(defaults);
      return () => { cancelled = true; };
    }
    void AsyncStorage.getItem(routeScopeStorageKey).then((stored) => {
      if (cancelled) return;
      try {
        const parsed = stored ? JSON.parse(stored) as Record<string, boolean> : null;
        setRouteScopeExpanded(parsed && typeof parsed === 'object' ? { ...defaults, ...parsed } : defaults);
      } catch {
        setRouteScopeExpanded(defaults);
      }
    }).catch(() => {
      if (!cancelled) setRouteScopeExpanded(defaults);
    });
    return () => { cancelled = true; };
  });
  return null;
}
