import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
} from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts, Fredoka_500Medium, Fredoka_600SemiBold } from '@expo-google-fonts/fredoka';
import RootNavigator from './src/navigation/RootNavigator';
import OnboardingScreen from './src/onboarding/OnboardingScreen';
import { readOnboardingState } from './src/onboarding/sync';
import { installGlobalErrorLogger } from './src/utils/activityLog';
import { SessionProvider, useSession } from './src/state/SessionContext';
import { usePushRegistration } from './src/state/usePushRegistration';
import { useGroupNotifications } from './src/state/useGroupNotifications';
import { useSubgroupInvites } from './src/state/useSubgroupInvites';
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
  const { initializing, user, membership } = useSession();
  // Fredoka is the design's display face (gathering-point titles, ETA numerals,
  // Live Activity numbers). Held alongside the session/onboarding splash so the
  // first screen never flashes system font before Fredoka swaps in.
  const [fontsLoaded] = useFonts({ Fredoka_500Medium, Fredoka_600SemiBold });
  // Register this device for APNs once signed in (no-op until a Dev Build);
  // also asks notification permission, which the local-notification flow needs.
  usePushRegistration();
  // Interim: turn group realtime events into local notifications (no APNs yet).
  useGroupNotifications();
  // Same realtime -> local-notification treatment for subgroup invites,
  // wherever in the app the user happens to be. MapScreen mounts its own
  // instance too (for the accept/decline UI) — see useSubgroupInvites for
  // how duplicate notifications across the two instances are avoided.
  useSubgroupInvites();

  // First-launch Onboarding gate: a local AsyncStorage flag
  // (hither.onboarding.v1), independent of session/auth. `null` means
  // "still checking" — held alongside the session splash below so neither
  // flashes the wrong first screen.
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    readOnboardingState().then((state) => {
      if (active) setNeedsOnboarding(!state?.completed);
    });
    return () => {
      active = false;
    };
  }, []);

  // Re-surface Onboarding when the user signs out or ends a group AND the
  // onboarding flag has been cleared (via "reset travel preferences"). This
  // only ever PROMOTES to onboarding — it never hides it — so signing in or
  // joining a group can't race a not-yet-flushed completion write.
  useEffect(() => {
    if (user && membership) return; // fully in-app, nothing to re-check
    let active = true;
    readOnboardingState().then((state) => {
      if (active && !state?.completed) setNeedsOnboarding(true);
    });
    return () => {
      active = false;
    };
  }, [user, membership]);

  // Hold the navigator until the persisted session AND the onboarding flag
  // are resolved, so RootNavigator's initialRouteName sees the correct
  // logged-in/out state (a restored user skips Login) instead of flashing
  // the wrong first screen.
  if (initializing || needsOnboarding === null || !fontsLoaded) {
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

  if (needsOnboarding) {
    return (
      <>
        <OnboardingScreen onDone={() => setNeedsOnboarding(false)} />
        <StatusBar style={themeName === 'day' ? 'dark' : 'light'} />
      </>
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

installGlobalErrorLogger();

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
