import { APP_TEXT_SIZE } from '../../../theme/typeScale';
import { AmicroButton } from '../../../components/AmicroButton';
import { glass } from '../../../glass';
import { type TranslationKey } from '../../../i18n';
import InviteMembersSheet from './InviteMembersSheet';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../../../components/AppText';
import Pressable from '../../../components/MotionPressable';
import type { MapStyles } from '../styles';
import type { Group } from '../../../types';

export interface InviteMembersOverlayProps {
  accent: string;
  codeCopied: boolean;
  copyCode: () => Promise<void>;
  group: Group | null;
  inviteBlockedForAnonymousLeader: boolean;
  overlay: "route" | "settings" | "profile" | "feedback" | "history" | "account" | "custom" | "invite" | "commands" | "arrivalManage" | "arrival" | "coordination" | null;
  promptAnonymousLeaderRegistration: () => void;
  setOverlay: React.Dispatch<React.SetStateAction<"route" | "settings" | "profile" | "feedback" | "history" | "account" | "custom" | "invite" | "commands" | "arrivalManage" | "arrival" | "coordination" | null>>;
  shareCode: () => Promise<void>;
  styles: MapStyles;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

export function InviteMembersOverlay({
  accent,
  codeCopied,
  copyCode,
  group,
  inviteBlockedForAnonymousLeader,
  overlay,
  promptAnonymousLeaderRegistration,
  setOverlay,
  shareCode,
  styles,
  t,
}: InviteMembersOverlayProps) {
  return (
    <InviteMembersSheet
      visible={overlay === 'invite'}
      onClose={() => setOverlay(null)}
      title={t('map.inviteMembers')}
      accent={accent}
      doneLabel={t('map.done')}
    >
      <ScrollView contentContainerStyle={[styles.overlayBody, inviteStyles.body]}>
        <Text style={inviteStyles.hint}>
          {inviteBlockedForAnonymousLeader
            ? t('anon.registrationRequiredBody')
            : t('map.inviteMembersHint')}
        </Text>
        {!inviteBlockedForAnonymousLeader && (
          <View
            style={styles.inviteCodeBoxes}
            accessible
            accessibilityRole="text"
            accessibilityLabel={group?.inviteCode ?? ''}
          >
            {Array.from({ length: 6 }, (_, index) => (
              <React.Fragment key={index}>
                {index === 3 ? <Text style={styles.inviteCodeDash}>-</Text> : null}
                <View style={styles.inviteCodeCell}>
                  <Text
                    style={styles.inviteCodeChar}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                    numberOfLines={1}
                  >
                    {group?.inviteCode?.[index] ?? ''}
                  </Text>
                </View>
              </React.Fragment>
            ))}
          </View>
        )}
        {inviteBlockedForAnonymousLeader ? (
          <Pressable
            style={[styles.settingsButton, { marginBottom: 10 }]}
            onPress={promptAnonymousLeaderRegistration}
            accessibilityRole="button"
          >
            <Ionicons name="person-add-outline" size={20} color="#fff" />
            <Text style={[styles.settingsText, inviteStyles.label]}>{t('anon.registrationRequiredCta')}</Text>
          </Pressable>
        ) : (
          <View style={styles.inviteActions}>
            <AmicroButton
              icon="link-outline"
              activeIcon="send-outline"
              color="#fff"
              label={t('map.share')}
              centeredLabel
              durationMs={420}
              style={[styles.inviteActionButton, inviteStyles.action]}
              accessibilityLabel={t('map.shareInviteLink')}
              testID="map-share-code"
              labelStyle={inviteStyles.label}
              onAnimationComplete={async () => {
                try {
                  await shareCode();
                } catch {
                  // Existing error path; always release busy via Amicro finally.
                }
              }}
            />
            <AmicroButton
              icon="copy-outline"
              activeIcon="checkmark"
              active={codeCopied}
              activeOnPress
              resetAfterComplete={false}
              color="#fff"
              activeColor={glass.ok}
              label={t('map.copy')}
              centeredLabel
              style={[styles.inviteActionButton, inviteStyles.action]}
              accessibilityLabel={codeCopied ? t('group.copied') : t('map.copyGroupCode')}
              testID="map-copy-code"
              labelStyle={inviteStyles.label}
              onAnimationComplete={() => { void copyCode(); }}
            />
          </View>
        )}
      </ScrollView>
    </InviteMembersSheet>
  );
}

const inviteStyles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingTop: 10 },
  hint: { color: '#ffffffba', fontSize: APP_TEXT_SIZE.body, lineHeight: 24 },
  label: { fontSize: APP_TEXT_SIZE.body, fontWeight: '700' },
  action: { height: 54, borderRadius: 27, backgroundColor: '#ffffff1f' },
});
