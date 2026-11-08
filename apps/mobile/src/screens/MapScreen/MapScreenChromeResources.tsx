import React, { useRef, useState } from 'react';
import { useMountEffect } from '../../hooks/useMountEffect';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import type { useSession } from '../../state/SessionContext';
import type { useGroupState } from '../../state/useGroupState';
import type { useTranslation } from '../../i18n';
import { Alert } from 'react-native';
import { isDemoGroup } from "../../api/demo";

type MapAccessLossInput = {
  user: Pick<NonNullable<ReturnType<typeof useSession>['user']>, 'id'> | null;
  groupId: string | null;
  membership: { group: { id: string } } | null;
  groupStateError: ReturnType<typeof useGroupState>['error'];
  kickedHandledRef: React.RefObject<boolean>;
  leaveGroup: ReturnType<typeof useSession>['leaveGroup'];
  voluntaryLeaveRef: React.RefObject<boolean>;
  t: ReturnType<typeof useTranslation>['t'];
  navigation: Pick<NativeStackScreenProps<RootStackParamList, 'Map'>['navigation'], 'reset'>;
};

export function MapAccessLossResource(input: MapAccessLossInput) {
  const [previous, setPrevious] = useState({ input, generation: 0 });
  if (!Object.is(previous.input.user?.id, input.user?.id)
    || !Object.is(previous.input.groupId, input.groupId)
    || !Object.is(previous.input.groupStateError, input.groupStateError)
    || !Object.is(previous.input.membership?.group.id, input.membership?.group.id)
    || !Object.is(previous.input.leaveGroup, input.leaveGroup)
    || !Object.is(previous.input.navigation, input.navigation)
    || !Object.is(previous.input.t, input.t)) {
    setPrevious({ input, generation: previous.generation + 1 });
  }
  return <MapAccessLossJob key={previous.generation} input={input} />;
}

function MapAccessLossJob({ input }: { input: MapAccessLossInput }) {
  const { user, groupId, membership, groupStateError, kickedHandledRef, leaveGroup, voluntaryLeaveRef, t, navigation } = input;
  useMountEffect(() => {
    if (!user?.id || !groupId || isDemoGroup(groupId)) return;
    if (membership?.group.id !== groupId) return;
    if (groupStateError === null) kickedHandledRef.current = false;
    if (groupStateError !== 'not_member' || kickedHandledRef.current) return;
    kickedHandledRef.current = true;
    leaveGroup();
    if (!voluntaryLeaveRef.current) Alert.alert(t('group.kickedTitle'), t('group.kickedMsg'));
    navigation.reset({ index: 0, routes: [{ name: 'RoleSelect' }] });
  });
  return null;
}

type MapRouteOpenInput = {
  overlay: string | null;
  routeOpenSyncGenerationRef: React.RefObject<number>;
  routeOpenSyncSessionRef: React.RefObject<'idle' | 'started' | 'done'>;
  setRouteInteractionMode: React.Dispatch<React.SetStateAction<'drag' | 'select' | 'none'>>;
  setRouteSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
  syncFromDatabase: () => Promise<void>;
};

export function MapRouteOpenResource(input: MapRouteOpenInput) {
  const [previous, setPrevious] = useState({ input, generation: 0 });
  if (!Object.is(previous.input.overlay, input.overlay)
    || !Object.is(previous.input.syncFromDatabase, input.syncFromDatabase)) {
    setPrevious({ input, generation: previous.generation + 1 });
  }
  return <MapRouteOpenJob key={previous.generation} input={input} />;
}

function MapRouteOpenJob({ input }: { input: MapRouteOpenInput }) {
  const { overlay, routeOpenSyncGenerationRef, routeOpenSyncSessionRef, setRouteInteractionMode, setRouteSelectedIds, syncFromDatabase } = input;
  useMountEffect(() => {
    if (overlay !== 'route') {
      routeOpenSyncGenerationRef.current += 1;
      routeOpenSyncSessionRef.current = 'idle';
      // Reset list chrome when leaving the sheet.
      setRouteInteractionMode('drag');
      setRouteSelectedIds([]);
      return;
    }
    if (routeOpenSyncSessionRef.current !== 'idle') return;
    routeOpenSyncSessionRef.current = 'started';
    const generation = routeOpenSyncGenerationRef.current;
    void syncFromDatabase().finally(() => {
      if (generation === routeOpenSyncGenerationRef.current) routeOpenSyncSessionRef.current = 'done';
    });
  });
  return null;
}
