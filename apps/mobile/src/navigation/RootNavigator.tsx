import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import RoleSelectScreen from '../screens/RoleSelectScreen';
import AuthScreen from '../screens/AuthScreen';
import MapScreen from '../screens/MapScreen';
import { useTheme } from '../state/PreferencesContext';

/**
 * Route names and params for the root stack. The design collapses the app into
 * three surfaces — pick a role, enter a nickname, then the map (which now holds
 * the group, flock, gathering points and settings in its pull-up sheet, so the
 * old Group / Settings stack screens are gone).
 */
export type RootStackParamList = {
  RoleSelect: undefined;
  Auth: { role: 'leader' | 'follower' } | undefined;
  Map: { groupId: string } | undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { colors } = useTheme();

  return (
    <Stack.Navigator
      initialRouteName="RoleSelect"
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="RoleSelect" component={RoleSelectScreen} />
      <Stack.Screen name="Auth" component={AuthScreen} />
      <Stack.Screen name="Map" component={MapScreen} />
    </Stack.Navigator>
  );
}
