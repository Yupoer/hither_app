import React from 'react';
import { Pressable, Text } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AuthScreen from '../screens/AuthScreen';
import GroupScreen from '../screens/GroupScreen';
import MapScreen from '../screens/MapScreen';
import SettingsScreen from '../screens/SettingsScreen';
import { useTheme } from '../state/PreferencesContext';
import { useTranslation } from '../i18n';

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
  const { colors } = useTheme();
  const { t } = useTranslation();

  return (
    <Stack.Navigator
      initialRouteName="Auth"
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { color: colors.textPrimary },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen
        name="Auth"
        component={AuthScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Group"
        component={GroupScreen}
        options={{ title: t('settings.groupSection') }}
      />
      <Stack.Screen
        name="Map"
        component={MapScreen}
        options={({ navigation }) => ({
          title: 'Hither',
          headerRight: () => (
            <Pressable
              onPress={() => navigation.navigate('Settings')}
              accessibilityRole="button"
              accessibilityLabel={t('settings.preferencesSection')}
            >
              <Text style={{ color: colors.accent, fontSize: 22 }}>⚙︎</Text>
            </Pressable>
          ),
        })}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: t('settings.preferencesSection') }}
      />
    </Stack.Navigator>
  );
}
