import React, { useCallback, useRef, useState } from 'react';
import { Alert, Platform, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMountEffect } from '../../hooks/useMountEffect';
import { displayMemberAvatar } from '../../constants/avatars';
import { prepareNativeJourneyLocation } from '../../native/backgroundLocation';
import { prepareBackgroundJourneyPermissions, startBackgroundJourney, stopBackgroundJourney } from '../../state/backgroundJourney';
import { rememberPendingLocationPermission } from '../../state/backgroundLocationRefresh';
import { purgeLocationOutbox } from '../../state/locationOutbox';
import { distanceMeters, type TravelMode } from '../../utils/geo';
import type { Coordinates, Destination, MemberLocation, Subgroup } from '../../types';
import type { MapJourneyBaselineInput, MapJourneyPresentation, PublishMapJourneyBaseline } from './MapJourneyProgressResources';

export type MapBackgroundLocationInput = {
  backgroundSharingScope: string | null;
  groupId: string | null;
  backgroundStartedKeyRef: React.RefObject<string | null>;
  backgroundPermissionAttemptedRef: React.RefObject<string | null>;
  setBackgroundPermissionsPreparedFor: React.Dispatch<React.SetStateAction<string | null>>;
  appState: AppStateStatus;
  backgroundPermissionDeniedRef: React.RefObject<string | null>;
  sharingEnabled: boolean;
  backgroundPermissionsPreparedFor: string | null;
  backgroundPermissionPrepareInFlightRef: React.RefObject<string | null>;
  effectiveNavigationActive: boolean;
  language: string;
  backgroundJourneyWantedRef: React.RefObject<string | null>;
  navTarget: Destination | undefined;
  myScopeId: string | undefined;
  deviceCoords: Coordinates | null;
  resolveCurrentNavigationSessionId: (destination: Destination) => string | null;
  pendingLeaderTargetId: string | null;
  highAccuracy: boolean;
  travelMode: TravelMode;
  localArrivalRadiusM: number;
  canEditItinerary: boolean;
  members: MemberLocation[];
  sessionEligibleMembers: MemberLocation[];
  initialJourneyRef: MapJourneyBaselineInput['initialJourneyRef'];
  user: { id: string } | null;
  activeDestinationArrivals: readonly { destinationId: string; userId: string }[];
  state: { subgroups: Pick<Subgroup, 'id' | 'leaderId'>[] } | null;
  lastValidPresentation: MapJourneyPresentation;
  lastRouteDistanceM: number | undefined;
  colors: { accent: string };
  membership: { group: { name: string } } | null;
  journeyStartCoords: Coordinates | null;
  progressDepartedStart: boolean;
  progressMaxSticky: number | null;
  backgroundEtaRef: React.RefObject<{ etaToPinSeconds?: number; etaTargetAtMs?: number; etaSampledAtMs?: number; lastEtaDistanceM?: number; personalArrivalAtMs?: number; personalArrivalSequence?: number; personalArrivalCorrectionAtMs?: number; personalArrived?: boolean }>;
  selfRoute: { expectedTravelTimeSeconds: number } | null;
  mapFocused: boolean;
  preferencesReady: boolean;
  localNavigationSessionId: string | null;
  journeyActive: boolean;
  navigationSessionId: string | null;
  hasNavigationSession: boolean;
  navigationStoppedLocally: boolean;
  showLocationPermissionAlert: (title?: string, body?: string) => void;
};

export function MapBackgroundLocationResource(input: MapBackgroundLocationInput & {
  baselineInput: MapJourneyBaselineInput; publishBaseline: PublishMapJourneyBaseline;
}) {
  const nativeIntent = useRef<{ key: string | null; appState: AppStateStatus } | null>(null);
  const applyNativeIntent = useCallback((key: string | null, appState: AppStateStatus, groupId: string | null) => {
    const previousIntent = nativeIntent.current;
    nativeIntent.current = { key, appState };
    if (!key && previousIntent?.key) {
      void prepareNativeJourneyLocation(null).catch(() => undefined);
    } else if (key && appState === 'active'
      && (previousIntent?.key !== key || previousIntent.appState !== 'active')) {
      // Core Location needs an Always service session before the scene backgrounds.
      void prepareNativeJourneyLocation(groupId).catch(() => undefined);
    }
  }, []);
  const [previous, setPrevious] = useState({ input, generation: 0 });
  if (!(Object.is(previous.input.appState, input.appState)
    && Object.is(previous.input.mapFocused, input.mapFocused)
    && Object.is(previous.input.backgroundSharingScope, input.backgroundSharingScope)
    && Object.is(previous.input.effectiveNavigationActive, input.effectiveNavigationActive)
    && Object.is(previous.input.backgroundPermissionsPreparedFor, input.backgroundPermissionsPreparedFor)
    && Object.is(previous.input.preferencesReady, input.preferencesReady)
    && Object.is(previous.input.language, input.language)
    && Object.is(previous.input.localArrivalRadiusM, input.localArrivalRadiusM)
    && Object.is(previous.input.localNavigationSessionId, input.localNavigationSessionId)
    && Object.is(previous.input.pendingLeaderTargetId, input.pendingLeaderTargetId)
    && Object.is(previous.input.myScopeId, input.myScopeId)
    && Object.is(previous.input.activeDestinationArrivals, input.activeDestinationArrivals)
    && Object.is(previous.input.resolveCurrentNavigationSessionId, input.resolveCurrentNavigationSessionId)
    && Object.is(previous.input.sessionEligibleMembers, input.sessionEligibleMembers)
    && Object.is(previous.input.user?.id, input.user?.id)
    && Object.is(previous.input.canEditItinerary, input.canEditItinerary)
    && Object.is(previous.input.deviceCoords, input.deviceCoords)
    && Object.is(previous.input.groupId, input.groupId)
    && Object.is(previous.input.highAccuracy, input.highAccuracy)
    && Object.is(previous.input.journeyActive, input.journeyActive)
    && Object.is(previous.input.navTarget, input.navTarget)
    && Object.is(previous.input.navigationSessionId, input.navigationSessionId)
    && Object.is(previous.input.hasNavigationSession, input.hasNavigationSession)
    && Object.is(previous.input.navigationStoppedLocally, input.navigationStoppedLocally)
    && Object.is(previous.input.sharingEnabled, input.sharingEnabled)
    && Object.is(previous.input.showLocationPermissionAlert, input.showLocationPermissionAlert)
    && Object.is(previous.input.travelMode, input.travelMode)
    && Object.is(previous.input.members, input.members)
    && Object.is(previous.input.membership?.group.name, input.membership?.group.name)
    && Object.is(previous.input.journeyStartCoords, input.journeyStartCoords)
    && Object.is(previous.input.progressDepartedStart, input.progressDepartedStart)
    && Object.is(previous.input.progressMaxSticky, input.progressMaxSticky)
    && Object.is(previous.input.selfRoute?.expectedTravelTimeSeconds, input.selfRoute?.expectedTravelTimeSeconds)
    && Object.is(previous.input.colors.accent, input.colors.accent)
    && Object.is(previous.input.lastValidPresentation.distanceM, input.lastValidPresentation.distanceM)
    && Object.is(previous.input.lastValidPresentation.etaSeconds, input.lastValidPresentation.etaSeconds)
    && Object.is(previous.input.lastValidPresentation.travelMode, input.lastValidPresentation.travelMode)
    && Object.is(previous.input.lastRouteDistanceM, input.lastRouteDistanceM))) {
    setPrevious({ input, generation: previous.generation + 1 });
  }
  useMountEffect(() => () => {
    if (nativeIntent.current?.key) void prepareNativeJourneyLocation(null).catch(() => undefined);
  });
  return <MapBackgroundLocationJob key={previous.generation} input={input} applyNativeIntent={applyNativeIntent} />;
}
function MapBackgroundLocationJob({ input, applyNativeIntent }: {
  input: MapBackgroundLocationInput & { baselineInput: MapJourneyBaselineInput; publishBaseline: PublishMapJourneyBaseline };
  applyNativeIntent: (key: string | null, appState: AppStateStatus, groupId: string | null) => void;
}) {
  const { backgroundSharingScope, groupId, backgroundStartedKeyRef, backgroundPermissionAttemptedRef, setBackgroundPermissionsPreparedFor, appState, backgroundPermissionDeniedRef, sharingEnabled, backgroundPermissionsPreparedFor, backgroundPermissionPrepareInFlightRef, effectiveNavigationActive, language, backgroundJourneyWantedRef, navTarget, myScopeId, deviceCoords, resolveCurrentNavigationSessionId, pendingLeaderTargetId, highAccuracy, travelMode, localArrivalRadiusM, canEditItinerary, members, sessionEligibleMembers, initialJourneyRef, user, activeDestinationArrivals, state, lastValidPresentation, lastRouteDistanceM, colors, membership, journeyStartCoords, progressDepartedStart, progressMaxSticky, backgroundEtaRef, selfRoute } = input;
  useMountEffect(() => {
    input.publishBaseline(input.baselineInput);

    const backgroundNavigationSessionId = navTarget ? resolveCurrentNavigationSessionId(navTarget) : null;
    const nativeKey = backgroundSharingScope && sharingEnabled && effectiveNavigationActive
      && backgroundPermissionsPreparedFor === backgroundSharingScope && navTarget && !navTarget.closedAt && backgroundNavigationSessionId
      ? JSON.stringify([backgroundSharingScope, navTarget.id, backgroundNavigationSessionId]) : null;
    applyNativeIntent(nativeKey, appState, groupId);

    if (!backgroundSharingScope || !groupId) {
      backgroundStartedKeyRef.current = null;
      backgroundPermissionAttemptedRef.current = null;
      setBackgroundPermissionsPreparedFor(null);
      void stopBackgroundJourney();
      return;
    }

    // A system cover keeps the existing foreground GPS owner and permissions.
    if (appState === 'inactive') {
      backgroundStartedKeyRef.current = null;
      void stopBackgroundJourney();
      return;
    }

    // Foreground owns GPS.
    if (appState === 'active') {
      backgroundStartedKeyRef.current = null;
      backgroundPermissionDeniedRef.current = null;
      if (sharingEnabled && backgroundPermissionsPreparedFor !== backgroundSharingScope
        && backgroundPermissionPrepareInFlightRef.current !== backgroundSharingScope
        && backgroundPermissionAttemptedRef.current !== backgroundSharingScope) {
        backgroundPermissionPrepareInFlightRef.current = backgroundSharingScope;
        backgroundPermissionAttemptedRef.current = backgroundSharingScope;
        void (async () => {
          const granted = await prepareBackgroundJourneyPermissions(false);
          if (granted === 'ready') return granted;
          const key = 'pref.journeyBackgroundExplained';
          const saved = await AsyncStorage.getItem(key);
          if (!saved) {
            const accepted = await new Promise<boolean>(resolve => Alert.alert(
              language === 'en' ? 'Share location in the background' : '背景位置分享',
              language === 'en'
                ? 'While location sharing is on, Hither shares your location with this team in the background, including when your screen is locked. Turn off location sharing to stop.'
                : '開啟位置分享時，Hither 會在背景向團隊分享位置，鎖定畫面後也會繼續。關閉位置分享即可停止。',
              [{ text: language === 'en' ? 'Not now' : '暫時不要', style: 'cancel', onPress: () => resolve(false) },
               { text: language === 'en' ? 'Continue' : '繼續', onPress: () => resolve(true) }],
            ));
            await AsyncStorage.setItem(key, accepted ? 'accepted' : 'declined');
            if (!accepted) return 'permission_denied' as const;
          }
          if (saved === 'declined') return 'permission_denied' as const;
          if (backgroundJourneyWantedRef.current !== backgroundSharingScope) return 'permission_denied' as const;
          return prepareBackgroundJourneyPermissions(true);
        })()
          .then((result) => {
            if (backgroundJourneyWantedRef.current !== backgroundSharingScope) return;
            if (result === 'ready') {
              backgroundPermissionDeniedRef.current = null;
              setBackgroundPermissionsPreparedFor(backgroundSharingScope);
            } else {
              setBackgroundPermissionsPreparedFor(null);
              void rememberPendingLocationPermission();
            }
          })
          .catch(() => {
            if (backgroundJourneyWantedRef.current === backgroundSharingScope) setBackgroundPermissionsPreparedFor(null);
          })
          .finally(() => {
            if (backgroundPermissionPrepareInFlightRef.current === backgroundSharingScope) {
              backgroundPermissionPrepareInFlightRef.current = null;
            }
          });
      } else if (!sharingEnabled && backgroundPermissionsPreparedFor != null) {
        setBackgroundPermissionsPreparedFor(null);
      }
      void stopBackgroundJourney();
      return;
    }

    backgroundPermissionAttemptedRef.current = null;
    const powerMode = effectiveNavigationActive ? 'journey' : 'allDay';
    const backgroundScopeSubgroupId = powerMode === 'journey'
      ? navTarget?.subgroupId ?? null : myScopeId ?? null;
    const dest =
      navTarget?.coordinates ??
      deviceCoords ??
      { latitude: 0, longitude: 0 };
    if (pendingLeaderTargetId === navTarget?.id && !backgroundNavigationSessionId) return;
    const scopedMembers = members.filter(member =>
      (member.subgroupId ?? null) === (navTarget?.subgroupId ?? null));
    const eligibleMembers = sessionEligibleMembers.filter(member => !member.solo
      && (member.subgroupId ?? null) === (navTarget?.subgroupId ?? null));
    const activityMembers = Platform.OS === 'ios' && eligibleMembers.length > 0
      ? eligibleMembers : scopedMembers;
    const activityAvatars = activityMembers.map(member =>
      displayMemberAvatar(member.avatar, member.userId, member.avatarColor));
    const sessionKey = backgroundNavigationSessionId ?? 'none';
    const key = JSON.stringify([backgroundSharingScope, backgroundScopeSubgroupId, powerMode,
      navTarget?.id ?? 'presence', sessionKey, highAccuracy, travelMode, localArrivalRadiusM,
      navTarget?.coordinates.latitude, navTarget?.coordinates.longitude, canEditItinerary,
      members.map(member => `${member.userId}:${member.subgroupId ?? ''}`).sort(),
      sessionEligibleMembers.filter(member => !member.solo).map(member => member.userId).sort(),
      navTarget?.title, navTarget?.meetAt, navTarget?.emoji, colors.accent, language, activityAvatars]);
    if (backgroundPermissionDeniedRef.current === key || backgroundStartedKeyRef.current === key) return;
    backgroundStartedKeyRef.current = key;

    const backgroundInitialM =
      initialJourneyRef.current?.distanceM ??
      (deviceCoords && navTarget
        ? distanceMeters(deviceCoords, navTarget.coordinates)
        : 0);

    void startBackgroundJourney({
      actorId: user?.id,
      scopeSubgroupId: backgroundScopeSubgroupId,
      memberIds: activityMembers.map(member => member.userId),
      navigationMemberIds: eligibleMembers.map(member => member.userId),
      arrivedMemberIds: activeDestinationArrivals.filter(a => a.destinationId === navTarget?.id).map(a => a.userId),
      leaderId: navTarget?.subgroupId
        ? state?.subgroups.find(subgroup => subgroup.id === navTarget.subgroupId)?.leaderId
        : members.find(member => member.role === 'leader')?.userId,
      target: navTarget ?? undefined,
      // The shared completion helper handles all-member completion separately from arrival.
      completeSolo: false,
      requiresLeaderCompletion: Platform.OS === 'ios',
      groupId,
      navigationSessionId: backgroundNavigationSessionId,
      destinationId: navTarget?.id ?? 'group-presence',
      destination: dest,
      arrivalRadiusMeters: localArrivalRadiusM,
      initialDistanceM: backgroundInitialM,
      distanceSource: initialJourneyRef.current?.source,
      routeAnchorGps: deviceCoords ?? undefined,
      routeAnchorRemainingM: lastValidPresentation.distanceM ?? lastRouteDistanceM ?? backgroundInitialM,
      accentHex: colors.accent,
      sequence: 0,
      travelMode,
      // Pause retains the preference while acquiring only passive fixes.
      highAccuracy: effectiveNavigationActive && highAccuracy,
      powerMode,
      sharingEnabled,
      hasMembership: members.some(m => m.userId === user?.id),
      gatheringTitle: navTarget?.title ?? membership?.group.name,
      groupName: membership?.group.name ?? '',
      memberEmojis: activityAvatars.map(avatar => avatar.emoji),
      memberColors: activityAvatars.map(avatar => avatar.color ?? ''),
      memberArrived: activityMembers.map(member => activeDestinationArrivals.some(arrival =>
        arrival.destinationId === navTarget?.id && arrival.userId === member.userId)),
      language: language === 'en' ? 'en' : 'zh',
      startCoords: journeyStartCoords ?? undefined,
      hasDepartedStart: progressDepartedStart,
      previousProgressMax: progressMaxSticky ?? undefined,
      ...backgroundEtaRef.current,
      etaToPinSeconds: backgroundEtaRef.current.etaToPinSeconds ?? selfRoute?.expectedTravelTimeSeconds,
      etaSeconds: (lastValidPresentation.travelMode === travelMode ? lastValidPresentation.etaSeconds : null)
        ?? selfRoute?.expectedTravelTimeSeconds,
      teamNavigationActive: effectiveNavigationActive,
      appState: appState === 'background' ? 'background' : 'inactive',
      permissionsPrepared: backgroundPermissionsPreparedFor === backgroundSharingScope,
    }).then((result) => {
      if (result !== 'started' && backgroundStartedKeyRef.current === key) backgroundStartedKeyRef.current = null;
      if (result === 'hidden') {
        void purgeLocationOutbox();
      }
      if (result === 'permission_denied') {
        backgroundPermissionDeniedRef.current = key;
        void rememberPendingLocationPermission();
      }
    }).catch(() => {
      if (backgroundStartedKeyRef.current === key) backgroundStartedKeyRef.current = null;
    });

  });
  return null;
}
