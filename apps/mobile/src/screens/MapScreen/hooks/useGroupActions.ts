import { anonymousLeaderRequiresRegistration } from '../../../entitlements';
import { type TranslationKey } from '../../../i18n';
import { type RootStackParamList } from '../../../navigation/RootNavigator';
import { type MemberLocation } from '../../../types';
import { logEvent } from '../../../utils/activityLog';
import { lightTap } from '../../../utils/haptics';
import { runUiAction } from '../../../utils/uiAction';
import * as Clipboard from 'expo-clipboard';
import React, { useState, useCallback } from 'react';
import { Alert, Share } from 'react-native';
import type { Group, MemberRole } from '../../../types';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

export interface UseGroupActionsInput {
  group: Group | null;
  isAnonymous: boolean;
  members: MemberLocation[];
  navigation: NativeStackNavigationProp<RootStackParamList, "Map", undefined>;
  role: MemberRole | null;
  setOverlay: React.Dispatch<React.SetStateAction<"route" | "settings" | "profile" | "feedback" | "history" | "account" | "custom" | "invite" | "commands" | "arrivalManage" | "arrival" | "ops" | null>>;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

export function useGroupActions({
  group,
  isAnonymous,
  members,
  navigation,
  role,
  setOverlay,
  t,
}: UseGroupActionsInput) {



  // --- Group actions --------------------------------------------------------
  const [codeCopied, setCodeCopied] = useState(false);
  /** Anonymous Leader at 5 members must register before inviting a 6th. */
  const inviteBlockedForAnonymousLeader = anonymousLeaderRequiresRegistration(
    isAnonymous && role === 'leader',
    members.length,
  );
  const promptAnonymousLeaderRegistration = useCallback(() => {
    Alert.alert(
      t('anon.registrationRequiredTitle'),
      t('anon.registrationRequiredBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('anon.registrationRequiredCta'),
          onPress: () => {
            setOverlay('account');
          },
        },
      ],
    );
  }, [t]);
  const copyCode = useCallback(async () => {
    if (!group) return;
    if (inviteBlockedForAnonymousLeader) {
      promptAnonymousLeaderRegistration();
      return;
    }
    logEvent('code_copy');
    await Clipboard.setStringAsync(group.inviteCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 1500);
  }, [group, inviteBlockedForAnonymousLeader, promptAnonymousLeaderRegistration]);
  const shareCode = useCallback(async () => {
    if (!group) return;
    if (inviteBlockedForAnonymousLeader) {
      promptAnonymousLeaderRegistration();
      return;
    }
    logEvent('code_share');
    await Share.share({ message: t('map.shareMsg', { code: group.inviteCode }) });
  }, [group, t, inviteBlockedForAnonymousLeader, promptAnonymousLeaderRegistration]);

  // --- Profile (nickname + emoji avatar) — avatar button only --------------
  const openProfile = useCallback(() => {
    lightTap();
    setOverlay('profile');
  }, []);

  /** RoleSelect create/join home — workflow boundary: reset stack, keep membership. */
  const goHomeCreateOrJoin = useCallback(() => {
    void runUiAction(
      'map.go_home_create_or_join',
      () => {
        lightTap();
        logEvent('settings_go_home_create_or_join');
        // Close overlay/sheet local state in the same transaction as the reset so the
        // departing Map instance does not leave modal state hanging, and so re-entry
        // cannot stack another Map on top of the old one.
        setOverlay(null);
        logEvent('navigation_reset', { target: 'RoleSelect', reason: 'go_home_create_or_join' });
        navigation.reset({ index: 0, routes: [{ name: 'RoleSelect' }] });
      },
      { screen: 'Map' },
    );
  }, [navigation]);
  return {
    codeCopied,
    copyCode,
    goHomeCreateOrJoin,
    inviteBlockedForAnonymousLeader,
    openProfile,
    promptAnonymousLeaderRegistration,
    shareCode,
  };
}
