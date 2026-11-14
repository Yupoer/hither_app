import React, { useRef, useState, type RefObject } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NavigationHelpers } from '@react-navigation/native';
import LoginScreen from '../screens/LoginScreen';
import RoleSelectScreen from '../screens/RoleSelectScreen';
import AuthScreen from '../screens/AuthScreen';
import MapScreen from '../screens/MapScreen';
import MyTeamsScreen from '../screens/MyTeamsScreen';
import { useTheme } from '../state/PreferencesContext';
import { useSession, type Membership } from '../state/SessionContext';
import { useMountEffect } from '../hooks/useMountEffect';
import { getMyJoinedGroups } from '../api/services/GroupService';
import { readCoreSnapshot } from '../state/coreDataStore';
import { authCallbackOrigin } from '../auth/callbacks';
import WaveLoading from '../components/WaveLoading';
import { readInviteLink, readLastActiveTeam, writeLastActiveTeam } from './teamEntry';
import { ENTRY_BACKGROUND, EntryBackdrop } from '../screens/entry/EntryVisuals';

type EntryParams = { rejectedInviteKey?: string } | undefined;
export type RootStackParamList = {
  Login: undefined;
  RoleSelect: EntryParams;
  Auth: { role: 'leader' }
    | { role: 'follower'; code: string };
  Map: { groupId: string; showTeamInvite?: boolean } | undefined;
  MyTeams: EntryParams;
};

type Startup = { kind: 'entry' } | { kind: 'team'; groupId: string };
type Route = { name: string; params?: object };

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { user } = useSession();
  const actorId = user?.id;
  const consumedInitialInvite = useRef(false);
  const [identity, setIdentity] = useState({ actorId, generation: 0 });
  if (identity.actorId !== actorId) {
    setIdentity({
      actorId,
      generation: identity.actorId ? identity.generation + 1 : identity.generation,
    });
  }
  return <TeamStack key={identity.generation} actorId={actorId} consumedInitialInvite={consumedInitialInvite} />;
}

function TeamStack({ actorId, consumedInitialInvite }: { actorId: string | undefined; consumedInitialInvite: RefObject<boolean> }) {
  const { colors } = useTheme();
  const { setMembership } = useSession();
  const [startup, setStartup] = useState<Startup | null>(() => actorId ? null : { kind: 'entry' });

  if (startup === null && actorId) {
    return (
      <View style={styles.loading}>
        <RestoreTeam key={actorId} actorId={actorId} onRestored={(membership) => {
          if (membership) setMembership(membership);
          setStartup(membership ? { kind: 'team', groupId: membership.group.id } : { kind: 'entry' });
        }} />
        <WaveLoading size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <Stack.Navigator
      initialRouteName={startup?.kind === 'team' && actorId ? 'Map' : 'RoleSelect'}
      layout={({ state, children, navigation }) => {
        const route = state.routes[state.index];
        const entryBackdrop = route.name === 'RoleSelect' || route.name === 'MyTeams'
          || (route.name === 'Auth' && state.routes[state.index - 1]?.name !== 'Map');
        return (
          <View style={styles.fill}>
            <EntryNavigationResources navigation={navigation} route={route} actorId={actorId} consumedInitialInvite={consumedInitialInvite} />
            {entryBackdrop ? <EntryBackdrop active /> : null}
            {children}
          </View>
        );
      }}
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: ENTRY_BACKGROUND },
      }}
    >
      <Stack.Screen name="RoleSelect" component={RoleSelectScreen} options={{ contentStyle: styles.transparent }} />
      <Stack.Screen name="Login" component={LoginScreen} options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="Auth" component={AuthScreen} options={{
        presentation: 'transparentModal',
        contentStyle: { backgroundColor: 'transparent' },
        animation: 'fade',
        gestureEnabled: false,
      }} />
      {actorId && <Stack.Screen
        name="Map"
        navigationKey={actorId}
        component={MapScreen}
        initialParams={startup?.kind === 'team' ? { groupId: startup.groupId } : undefined}
        options={{
          contentStyle: { backgroundColor: colors.background },
          gestureEnabled: false,
          fullScreenGestureEnabled: false,
        }}
      />}
      <Stack.Screen name="MyTeams" component={MyTeamsScreen} options={{ contentStyle: styles.transparent }} />
    </Stack.Navigator>
  );
}

function RestoreTeam({ actorId, onRestored }: { actorId: string; onRestored: (result: Membership | null) => void }) {
  useMountEffect(() => {
    let current = true;
    void restoreLastMembership(actorId).then(membership => {
      if (current) onRestored(membership);
    });
    return () => { current = false; };
  });
  return null;
}

async function restoreLastMembership(actorId: string): Promise<Membership | null> {
  const groupId = await readLastActiveTeam(actorId).catch(() => null);
  if (!groupId) return null;
  const cached = await readCoreSnapshot(groupId).catch(() => null);
  const cachedRole = cached?.members?.find(member => member.userId === actorId)?.role;
  if (cached && cachedRole && (!cached.ownerActorId || cached.ownerActorId === actorId)) {
    return { group: cached.group, role: cachedRole };
  }
  try {
    const groups = await getMyJoinedGroups({ expectedActorId: actorId, includeProfiles: false });
    const selected = groups.find(info => info.group.id === groupId);
    return selected ? { group: selected.group, role: selected.role } : null;
  } catch {
    return null;
  }
}

function EntryNavigationResources({
  navigation, route, actorId, consumedInitialInvite,
}: {
  navigation: Pick<NavigationHelpers<RootStackParamList>, 'navigate' | 'getState'>;
  route: Route;
  actorId: string | undefined;
  consumedInitialInvite: RefObject<boolean>;
}) {
  useMountEffect(() => {
    let mounted = true;
    let handledLiveLink = false;
    function openInvite(url: string) {
      let origin: string | undefined;
      try { origin = authCallbackOrigin(); } catch {}
      const code = readInviteLink(url, origin);
      const state = navigation.getState();
      if (!code || state.routes[state.index]?.name === 'Auth') return;
      navigation.navigate('Auth', { role: 'follower', code });
      return true;
    }
    const subscription = Linking.addEventListener('url', ({ url }) => {
      if (openInvite(url)) handledLiveLink = true;
    });
    if (!consumedInitialInvite.current) {
      void Linking.getInitialURL().then(url => {
        if (!mounted) return;
        consumedInitialInvite.current = true;
        if (!handledLiveLink && url) openInvite(url);
      }).catch(() => undefined);
    }
    return () => { mounted = false; subscription.remove(); };
  });

  if (!actorId) return null;
  if (route.name === 'Map' && route.params && 'groupId' in route.params && typeof route.params.groupId === 'string') {
    return <PersistTeamRoute key={`${actorId}:${route.params.groupId}`} actorId={actorId} groupId={route.params.groupId} />;
  }
  if (route.name === 'RoleSelect' || route.name === 'MyTeams') {
    return <PersistTeamRoute key={`${actorId}:entry`} actorId={actorId} groupId={null} />;
  }
  return null;
}

function PersistTeamRoute({ actorId, groupId }: { actorId: string; groupId: string | null }) {
  useMountEffect(() => { void writeLastActiveTeam(actorId, groupId).catch(() => undefined); });
  return null;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: ENTRY_BACKGROUND },
  transparent: { backgroundColor: 'transparent' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: ENTRY_BACKGROUND },
});
