import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
} from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import RootNavigator from './src/navigation/RootNavigator';
import { SessionProvider, useSession } from './src/state/SessionContext';
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
  const { initializing } = useSession();
  // Register this device for APNs once signed in (no-op until a Dev Build);
  // also asks notification permission, which the local-notification flow needs.
  usePushRegistration();
  // Interim: turn group realtime events into local notifications (no APNs yet).
  useGroupNotifications();

  // Hold the navigator until the persisted session is resolved, so
  // RootNavigator's initialRouteName sees the correct logged-in/out state
  // (a restored user skips Login) instead of flashing the wrong first screen.
  if (initializing) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

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
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PreferencesProvider>
          <SessionProvider>
            <ThemedNavigation />
          </SessionProvider>
        </PreferencesProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
