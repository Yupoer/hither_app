import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import LoginScreen from '../screens/LoginScreen';
import RoleSelectScreen from '../screens/RoleSelectScreen';
import AuthScreen from '../screens/AuthScreen';
import MapScreen from '../screens/MapScreen';
import MyTeamsScreen from '../screens/MyTeamsScreen';
import { useTheme } from '../state/PreferencesContext';
import { useSession } from '../state/SessionContext';
import { JoinedGroupInfo } from '../api/client';

/**
 * Route names and params for the root stack. A logged-out launch starts on
 * Login; the rest collapses the app into three surfaces — pick a role, enter a
 * nickname, then the map (which now holds the group, flock, gathering points
 * and settings in its pull-up sheet, so the old Group / Settings stack screens
 * are gone).
 */
export type RootStackParamList = {
  Login: undefined;
  RoleSelect: undefined;
  Auth: { role: 'leader' | 'follower' } | undefined;
  Map: { groupId: string } | undefined;
  MyTeams: { initialGroups?: JoinedGroupInfo[] } | undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { colors } = useTheme();
  const { user } = useSession();

  return (
    // A restored session (email / Google / guest) skips Login and lands on
    // RoleSelect. `initialRouteName` is only read once, after the App-level
    // `initializing` splash has resolved the persisted session.
    <Stack.Navigator
      initialRouteName={user ? 'RoleSelect' : 'Login'}
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="RoleSelect" component={RoleSelectScreen} />
      <Stack.Screen name="Auth" component={AuthScreen} />
      <Stack.Screen name="Map" component={MapScreen} />
      <Stack.Screen name="MyTeams" component={MyTeamsScreen} />
    </Stack.Navigator>
  );
}
