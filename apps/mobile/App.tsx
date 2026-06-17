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
