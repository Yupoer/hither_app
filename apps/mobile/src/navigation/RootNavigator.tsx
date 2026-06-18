import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
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
              hitSlop={12}
              style={styles.gearButton}
            >
              <Text style={[styles.gearIcon, { color: colors.accent }]}>⚙</Text>
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

const styles = StyleSheet.create({
  // Fixed-size, centred tap target so the gear sits in the middle and is easy
  // to hit (the bare glyph alone has a tiny, off-centre touch area).
  gearButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gearIcon: {
    fontSize: 22,
    lineHeight: 26,
    textAlign: 'center',
    textAlignVertical: 'center',
  },
});
