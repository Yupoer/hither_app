import { leaveGroups, saveOnboardingProfile } from '../../../api/client';
import { clearGroupFeatureTour, clearAddPlaceTour, clearRouteReorderTour } from '../../../featureTour';
import { type TranslationKey } from '../../../i18n';
import { type RootStackParamList } from '../../../navigation/RootNavigator';
import { markOnboardingReplayForHome } from '../../../onboarding/sync';
import { clearLiveActivities } from '../../../state/useLiveActivity';
import { logEvent, logError } from '../../../utils/activityLog';
import { confirmAction } from '../../../utils/confirm';
import { runUiAction } from '../../../utils/uiAction';
import React, { useCallback } from 'react';
import { Alert } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AccountPreferences, User } from '../../../types';

export interface UseAccountActionsInput {
  groupId: string | null;
  isLeader: boolean;
  leaveGroup: () => void;
  navigation: NativeStackNavigationProp<RootStackParamList, "Map", undefined>;
  reevaluateRouteTour: () => void;
  setAddPlaceTourLocalDone: React.Dispatch<React.SetStateAction<boolean>>;
  signOut: () => Promise<void>;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  updateProfile: (fields: { nickname?: string; avatar?: string; avatarColor?: string; preferences?: AccountPreferences; }) => Promise<void>;
  user: User | null;
  voluntaryLeaveRef: React.RefObject<boolean>;
}

export function useAccountActions({
  groupId,
  isLeader,
  leaveGroup,
  navigation,
  reevaluateRouteTour,
  setAddPlaceTourLocalDone,
  signOut,
  t,
  updateProfile,
  user,
  voluntaryLeaveRef,
}: UseAccountActionsInput) {

  const confirmLeave = useCallback(() => {
    // Red style only on the confirm button in the dialog — not on settings rows.
    confirmAction(
      {
        title: isLeader ? t('map.endGroupTitle') : t('group.leaveTitle'),
        message: isLeader ? t('map.endGroupMsg') : t('group.leaveMsg'),
        confirmLabel: isLeader ? t('map.endGroupConfirm') : t('group.leaveConfirm'),
        cancelLabel: t('common.cancel'),
        destructive: true,
      },
      () => {
        void runUiAction(
          'map.leave_group',
          async (token) => {
            voluntaryLeaveRef.current = true;
            logEvent('group_leave', { groupId, isLeader });
            try {
            if (groupId) {
              await leaveGroups([groupId]);
              if (!token.isCurrent()) return;
              await clearLiveActivities({ groupIds: [groupId] });
            } else {
              await clearLiveActivities();
            }
            if (!token.isCurrent()) return;
            leaveGroup();
            navigation.reset({ index: 0, routes: [{ name: 'RoleSelect' }] });
            } catch (error) {
              voluntaryLeaveRef.current = false;
              throw error;
            }
          },
          { screen: 'Map' },
        );
      },
    );
  }, [t, groupId, isLeader, leaveGroup, navigation]);

  function startMapSignOut(): void {
    void runUiAction(
      'map.sign_out',
      async (token) => {
        logEvent('sign_out');
        await signOut();
        if (!token.isCurrent()) return;
        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      },
      {
        screen: 'Map',
        suppressBanner: true,
        onError: (kind) => {
          const message = kind === 'timeout'
            ? t('interaction.signOutTimeout')
            : t('interaction.error');
          Alert.alert(t('settings.signOutTitle'), message, [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('interaction.retry'), onPress: startMapSignOut },
          ]);
        },
      },
    );
  }

  const confirmSignOut = useCallback(() => {
    confirmAction(
      {
        title: t('settings.signOutTitle'),
        message: t('settings.signOutMsg'),
        confirmLabel: t('settings.signOut'),
        cancelLabel: t('common.cancel'),
        destructive: true,
      },
      startMapSignOut,
    );
  }, [t, signOut, navigation]);

  const resetPrefs = useCallback(async () => {
    logEvent('reset_prefs');
    try {
      await saveOnboardingProfile({});
    } catch (e) {
      logError('reset_prefs_failed', e);
      console.warn('[settings] resetPrefs saveOnboardingProfile failed', e);
    }
    // #171: mark durable onboarding replay for create/join home — do not navigate.
    await markOnboardingReplayForHome().catch(() => undefined);
    await clearGroupFeatureTour({
      accountId: user?.id ?? null,
      existingPreferences: user?.preferences ?? null,
    }).catch(() => undefined);
    await clearAddPlaceTour({
      accountId: user?.id ?? null,
      existingPreferences: {
        ...(user?.preferences ?? {}),
        groupFeatureTourCompleted: false,
      },
    }).catch(() => undefined);
    await clearRouteReorderTour({
      accountId: user?.id ?? null,
      existingPreferences: {
        ...(user?.preferences ?? {}),
        groupFeatureTourCompleted: false,
        addPlaceTourCompleted: false,
      },
    }).catch(() => undefined);
    reevaluateRouteTour();
    setAddPlaceTourLocalDone(false);
    // Optimistically clear session prefs so reevaluate does not see stale true.
    // clearGroupFeatureTour already best-effort wrote the account; this updates
    // in-memory user.preferences. Failures are non-fatal (reset intent covers them).
    try {
      await updateProfile({
        preferences: {
          ...(user?.preferences ?? {}),
          groupFeatureTourCompleted: false,
          addPlaceTourCompleted: false,
          routeReorderTourCompleted: false,
        },
      });
    } catch {
      // Pending / reset-intent paths keep replay working without session write.
    }
    Alert.alert(t('settings.resetAllPrefs'), t('settings.resetPrefsDone'));
  }, [t, user?.id, user?.preferences, updateProfile, reevaluateRouteTour]);

  const confirmResetPrefs = useCallback(() => {
    confirmAction(
      {
        title: t('settings.resetAllPrefs'),
        message: t('settings.resetPrefsConfirm'),
        confirmLabel: t('settings.resetAllPrefs'),
        cancelLabel: t('common.cancel'),
        destructive: true,
      },
      () => void resetPrefs(),
    );
  }, [t, resetPrefs]);
  return {
    confirmLeave,
    confirmResetPrefs,
    confirmSignOut,
  };
}
