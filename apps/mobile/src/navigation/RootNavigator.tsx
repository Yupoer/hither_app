import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AuthScreen from '../screens/AuthScreen';
import GroupScreen from '../screens/GroupScreen';
import MapScreen from '../screens/MapScreen';
import SettingsScreen from '../screens/SettingsScreen';

/**
 * Route names and params for the root stack. Keep this in sync with the
 * screens registered below; screens get typed props via
 * `NativeStackScreenProps<RootStackParamList, 'X'>`.
 */
export type RootStackParamList = {
  Auth: undefined;
  Group: undefined;
  Map: { groupId: string } | undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  return (
    <Stack.Navigator initialRouteName="Auth">
      <Stack.Screen
        name="Auth"
        component={AuthScreen}
        options={{ title: 'Hither' }}
      />
      <Stack.Screen
        name="Group"
        component={GroupScreen}
        options={{ title: '群組' }}
      />
      <Stack.Screen
        name="Map"
        component={MapScreen}
        options={{ title: '地圖' }}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: '設定' }}
      />
    </Stack.Navigator>
  );
}
