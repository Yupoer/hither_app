import React, { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
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
import CrookIcon from './src/components/CrookIcon';
import { installGlobalErrorLogger } from './src/utils/activityLog';
import { SessionProvider, useSession } from './src/state/SessionContext';
import { usePushRegistration } from './src/state/usePushRegistration';
import { useGroupNotifications } from './src/state/useGroupNotifications';
import { useSubgroupInvites } from './src/state/useSubgroupInvites';
import {
  PreferencesProvider,
  usePreferences,
  useTheme,
} from './src/state/PreferencesContext';
import { GLOBAL_FONT_SCALE_CAP } from './src/theme/typeScale';
import { metrics } from './src/native';
import { diagnostics } from './src/state/diagnostics';
import { uploadMetricPayload } from './src/api/services/DiagnosticService';
import { uploadPerformanceBatch } from './src/api/services/PerformanceService';
import {
  configurePerformanceTracing,
  purgePerformance,
  startPerformanceMonitor,
} from './src/state/performance';
import {
  configureLogBatchScheduler,
  setLogBatchSchedulerEnabled,
  stopLogBatchScheduler,
} from './src/state/logBatchScheduler';
import { setDiagnosticConsentEnabled } from './src/state/diagnosticConsent';
import { uploadLocalLogs } from './src/utils/uploadLocalLogs';
import { startOtaUpdateBootstrap } from './src/utils/otaUpdates';

// Dynamic Type: scale with the system up to GLOBAL_FONT_SCALE_CAP, then freeze.
// Per-role caps (HitherText) may be tighter. Never reintroduce a hard 1.0 cap.
const textDefaults = Text as typeof Text & { defaultProps?: Record<string, unknown> };
textDefaults.defaultProps = {
  ...(textDefaults.defaultProps ?? {}),
  maxFontSizeMultiplier: GLOBAL_FONT_SCALE_CAP,
};
const textInputDefaults = TextInput as typeof TextInput & {
  defaultProps?: Record<string, unknown>;
};
textInputDefaults.defaultProps = {
  ...(textInputDefaults.defaultProps ?? {}),
  maxFontSizeMultiplier: GLOBAL_FONT_SCALE_CAP,
};

/**
 * Navigation theme + status bar follow the active palette, so the header and
 * screen backgrounds restyle when the user switches theme in Settings.
 */
function ThemedNavigation() {

  const { colors } = useTheme();
  const { ready, diagnosticUploadEnabled } = usePreferences();
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

  useEffect(() => {
    if (initializing) return;
    void metrics.markLaunchPhase('session_resolved');
  }, [initializing]);

  useEffect(() => {
    if (!ready || initializing || !user) return;

    if (!diagnosticUploadEnabled) {
      void setDiagnosticConsentEnabled(false);
      stopLogBatchScheduler();
      setLogBatchSchedulerEnabled(false);
      void diagnostics.purge().catch(() => undefined);
      void purgePerformance().catch(() => undefined);
      void metrics.setCollectionEnabled(false).catch(() => undefined);
      void metrics.purgePayloads().catch(() => undefined);
      return;
    }

    configurePerformanceTracing(uploadPerformanceBatch);
    configureLogBatchScheduler(async () => {
      const logs = await uploadLocalLogs();
      const allPayloads = await metrics.drainPayloads();
      const payloads = allPayloads.slice(0, 5);
      const acknowledged: string[] = [];
      for (const payload of payloads) {
        try {
          await uploadMetricPayload(payload);
          acknowledged.push(payload.id);
        } catch {
          break;
        }
      }
      await metrics.removePayloads(acknowledged);
      return {
        sent: logs.diagnosticSent + logs.performanceSent + acknowledged.length,
        remaining:
          logs.diagnosticRemaining +
          logs.performanceRemaining +
          Math.max(0, allPayloads.length - acknowledged.length),
      };
    });
    setLogBatchSchedulerEnabled(true);
    void metrics.setCollectionEnabled(true).catch(() => undefined);
    return startPerformanceMonitor();
  }, [ready, diagnosticUploadEnabled, initializing, user]);

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

  const navigatorReady =
    !initializing && needsOnboarding === false && fontsLoaded;

  useEffect(() => {
    if (!navigatorReady) return;
    void metrics.markLaunchPhase('navigation_ready');
    const timer = setTimeout(() => {
      void metrics.markLaunchPhase('stable');
    }, 30_000);
    return () => clearTimeout(timer);
  }, [navigatorReady]);

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
        <CrookIcon size={96} color={colors.accent} glow />
      </View>
    );
  }

  if (needsOnboarding) {
    return (
      <>
        <OnboardingScreen onDone={() => setNeedsOnboarding(false)} />
        {/* BUG-04: glass chrome is always dark — force light status icons. */}
        <StatusBar style="light" />
      </>
    );
  }

  // Glass UI is always dark (see glass.ts); map theme can still be day/dusk/night.
  // Prefer DarkTheme for chrome so system-tinted controls don't go light.
  const base = DarkTheme;
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
      <StatusBar style="light" />
    </NavigationContainer>
  );
}

installGlobalErrorLogger();

export default function App() {
  useEffect(() => {
    void metrics.markLaunchPhase('js_root_mounted');
    void metrics
      .previousLaunch()
      .then((previous) => {
        if (!previous) return;
        return diagnostics.write({
          event: 'previous_launch_incomplete',
          source: previous.phase,
          mode: previous.build,
        });
      })
      .catch(() => undefined);
  }, []);

  // TestFlight/store: fetch + reload OTA without requiring a second cold start.
  useEffect(() => startOtaUpdateBootstrap(), []);

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
