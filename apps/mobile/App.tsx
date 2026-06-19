import React from 'react';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
} from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import RootNavigator from './src/navigation/RootNavigator';
import { SessionProvider } from './src/state/SessionContext';
import { usePushRegistration } from './src/state/usePushRegistration';
import { useGroupNotifications } from './src/state/useGroupNotifications';
import {
  PreferencesProvider,
  useTheme,
} from './src/state/PreferencesContext';

/**
 * Navigation theme + status bar follow the active palette, so the header and
 * screen backgrounds restyle when the user switches theme in Settings.
 */
function ThemedNavigation() {
  const { colors, themeName } = useTheme();
  // Register this device for APNs once signed in (no-op until a Dev Build);
  // also asks notification permission, which the local-notification flow needs.
  usePushRegistration();
  // Interim: turn group realtime events into local notifications (no APNs yet).
  useGroupNotifications();
  const base = themeName === 'day' ? DefaultTheme : DarkTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      background: colors.background,
      card: colors.background,
      text: colors.textPrimary,
      primary: colors.accent,
      border: colors.border,
    },
  };

  return (
    <NavigationContainer theme={navTheme}>
      <RootNavigator />
      <StatusBar style={themeName === 'day' ? 'dark' : 'light'} />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <PreferencesProvider>
        <SessionProvider>
          <ThemedNavigation />
        </SessionProvider>
      </PreferencesProvider>
    </SafeAreaProvider>
  );
}
