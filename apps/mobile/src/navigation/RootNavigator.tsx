import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import RoleSelectScreen from '../screens/RoleSelectScreen';
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
  RoleSelect: undefined;
  Auth: { role: 'leader' | 'follower' } | undefined;
  Group: undefined;
  Map: { groupId: string } | undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { colors, themeName } = useTheme();
  const { t } = useTranslation();
  // Frosted (UIBlurEffect) material behind the map header so it's translucent.
  // UltraThin = the most see-through system material (map shows through clearly).
  const headerBlur =
    themeName === 'day' ? 'systemUltraThinMaterialLight' : 'systemUltraThinMaterialDark';

  return (
    <Stack.Navigator
      initialRouteName="RoleSelect"
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { color: colors.textPrimary },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen
        name="RoleSelect"
        component={RoleSelectScreen}
        options={{ headerShown: false }}
      />
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
          title: '',
          // Translucent frosted-glass header floating over the live map.
          headerTransparent: true,
          headerBlurEffect: headerBlur,
          headerStyle: { backgroundColor: 'transparent' },
          headerRight: () => (
            <Pressable
              onPress={() => navigation.navigate('Settings')}
              accessibilityRole="button"
              accessibilityLabel={t('settings.preferencesSection')}
              hitSlop={12}
              style={styles.gearButton}
            >
              <Ionicons name="settings-sharp" size={22} color={colors.accent} />
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
