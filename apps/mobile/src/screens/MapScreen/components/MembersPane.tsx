import SystemToggle from '../../../components/SystemToggle';
import WaveLoading from '../../../components/WaveLoading';
import { glass, accentMix } from '../../../glass';
import { type TranslationKey } from '../../../i18n';
import { NativeMenuHost } from '../../../native/menu';
import { mediumTap, lightTap } from '../../../utils/haptics';
import { type PresenceMacroKind } from '../../../utils/presenceMacros';
import { RefreshLocationsButton } from './RefreshLocationsButton';
import { SubgroupSection } from './SubgroupSection';
import { statusIconForKind } from '../memberStatusSharing';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { View, Platform, Text, Pressable } from 'react-native';
import type { MapStyles } from '../styles';
import type { FontScaleBucket } from '../../../theme/typeScale';
import type { PendingInvite, Subgroup } from '../../../types';

export interface MembersPaneProps {
  accent: string;
  applyPresenceMacroKind: (next: PresenceMacroKind) => Promise<boolean>;
  flock: { userId: string; name: string; avatar: string | undefined; avatarColor: string; solo: boolean; subgroupId: string | undefined; color: string; isLeader: boolean; arrived: boolean; lastUpdated: string | null | undefined; sharingEnabled: boolean | undefined; locationTrackingMode: string | null | undefined; locationSource: string | null | undefined; locationNavigationSessionId: string | null | undefined; statusColor: "rgba(235, 235, 245, 0.6)" | "#5FD08A" | "#FF9F6B"; eta: string; dist: string; }[];
  fontBucket: FontScaleBucket;
  handleAcceptInvite: (inviteId: string) => Promise<void>;
  handleDeclineInvite: (inviteId: string) => Promise<void>;
  handleSharingEnabledChangeAnimated: () => void;
  highAccuracy: boolean;
  myStatusKind: PresenceMacroKind;
  mySubgroupId: string | undefined;
  openAndroidStatusSheet: () => void;
  pendingInvites: PendingInvite[];
  refreshAllLocations: () => Promise<void>;
  refreshCooldownUntil: number;
  refreshingLocations: boolean;
  renderFlockRow: (f: { userId: string; name: string; avatar: string | undefined; avatarColor: string; solo: boolean; subgroupId: string | undefined; color: string; isLeader: boolean; arrived: boolean; lastUpdated: string | null | undefined; sharingEnabled: boolean | undefined; locationTrackingMode: string | null | undefined; locationSource: string | null | undefined; locationNavigationSessionId: string | null | undefined; statusColor: "rgba(235, 235, 245, 0.6)" | "#5FD08A" | "#FF9F6B"; eta: string; dist: string; }, last: boolean, index?: number) => React.JSX.Element;
  sentInvites: { id: string; inviteeName: string; }[];
  setHighAccuracy: (on: boolean) => void;
  setInviteSheetOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setOverlay: React.Dispatch<React.SetStateAction<"route" | "settings" | "profile" | "feedback" | "history" | "account" | "custom" | "invite" | "commands" | "arrivalManage" | "arrival" | "ops" | null>>;
  sharingApplying: boolean;
  sharingEnabled: boolean;
  statusMenuItems: ({ id: "follow"; title: string; subtitle: string; selected: boolean; } | { id: "solo"; title: string; subtitle: string; selected: boolean; } | { id: "stealth"; title: string; subtitle: string; selected: boolean; })[];
  styles: MapStyles;
  subgroups: Subgroup[];
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  topFlockMemo: { userId: string; name: string; avatar: string | undefined; avatarColor: string; solo: boolean; subgroupId: string | undefined; color: string; isLeader: boolean; arrived: boolean; lastUpdated: string | null | undefined; sharingEnabled: boolean | undefined; locationTrackingMode: string | null | undefined; locationSource: string | null | undefined; locationNavigationSessionId: string | null | undefined; statusColor: "rgba(235, 235, 245, 0.6)" | "#5FD08A" | "#FF9F6B"; eta: string; dist: string; }[];
}

export function MembersPane({
  accent,
  applyPresenceMacroKind,
  flock,
  fontBucket,
  handleAcceptInvite,
  handleDeclineInvite,
  handleSharingEnabledChangeAnimated,
  highAccuracy,
  myStatusKind,
  mySubgroupId,
  openAndroidStatusSheet,
  pendingInvites,
  refreshAllLocations,
  refreshCooldownUntil,
  refreshingLocations,
  renderFlockRow,
  sentInvites,
  setHighAccuracy,
  setInviteSheetOpen,
  setOverlay,
  sharingApplying,
  sharingEnabled,
  statusMenuItems,
  styles,
  subgroups,
  t,
  topFlockMemo,
}: MembersPaneProps) {
  return (
    <>
      {/* My status + refresh on one row (stage 1+ body) */}
      <View style={styles.myStatusBar}>
        <View style={styles.myStatusCluster}>
          {Platform.OS === 'ios' ? (
            <NativeMenuHost
              items={statusMenuItems}
              onSelect={(id) => {
                if (id === 'follow' || id === 'solo' || id === 'stealth') {
                  void applyPresenceMacroKind(id);
                }
              }}
              accessibilityLabel={t('solo.statusTitle')}
              testID="map-presence"
              style={styles.myStatusTrigger}
            >
              <View style={styles.myStatusTriggerInner} pointerEvents="none">
                <Ionicons
                  name={statusIconForKind(myStatusKind)}
                  size={20}
                  color={glass.textSecondary}
                />
                <Text style={styles.myStatusName} numberOfLines={1}>
                  {myStatusKind === 'stealth'
                    ? t('solo.stealth')
                    : myStatusKind === 'solo'
                      ? t('solo.switch')
                      : t('solo.followTeam')}
                </Text>
              </View>
            </NativeMenuHost>
          ) : (
            <Pressable
              style={styles.myStatusTrigger}
              onPress={openAndroidStatusSheet}
              accessibilityRole="button"
              accessibilityLabel={t('solo.statusTitle')}
              testID="map-presence"
            >
              <View style={styles.myStatusTriggerInner} pointerEvents="none">
                <Ionicons
                  name={statusIconForKind(myStatusKind)}
                  size={20}
                  color={glass.textSecondary}
                />
                <Text style={styles.myStatusName} numberOfLines={1}>
                  {myStatusKind === 'stealth'
                    ? t('solo.stealth')
                    : myStatusKind === 'solo'
                      ? t('solo.switch')
                      : t('solo.followTeam')}
                </Text>
              </View>
            </Pressable>
          )}
          <Pressable
            style={({ pressed }) => [
              styles.locationSharingButton,
              pressed && styles.locationSharingButtonPressed,
            ]}
            disabled={sharingApplying}
            accessibilityRole="button"
            accessibilityLabel={t('settings.locationSharing')}
            accessibilityHint={t('settings.locationSharingHint')}
            accessibilityState={{ disabled: sharingApplying, busy: sharingApplying }}
            testID="members-location-sharing"
            onPress={() => {
              mediumTap();
              handleSharingEnabledChangeAnimated();
            }}
            >
            {sharingApplying ? (
              <WaveLoading size="small" color={sharingEnabled ? accent : glass.danger} />
            ) : (
              <Ionicons
                name={sharingEnabled ? 'eye-outline' : 'eye-off-outline'}
                size={22}
                color={sharingEnabled ? accent : glass.danger}
              />
            )}
          </Pressable>
        </View>
        <RefreshLocationsButton
          refreshing={refreshingLocations}
          cooldownUntil={refreshCooldownUntil}
          accent={accent}
          styles={styles}
          t={t}
          onPress={refreshAllLocations}
        />
      </View>
      {subgroups.length === 0 && (
        <View style={styles.list}>
          {topFlockMemo.map((f, i) => renderFlockRow(f, i === topFlockMemo.length - 1, i))}
        </View>
      )}
      <SubgroupSection
        subgroups={subgroups}
        flock={flock}
        mySubgroupId={mySubgroupId}
        sentInvites={sentInvites}
        accent={accent}
        setInviteSheetOpen={setInviteSheetOpen}
        renderFlockRow={renderFlockRow}
        styles={styles}
      />
      {pendingInvites.length > 0 && (
        <View style={styles.list}>
          {pendingInvites.map((inv, i) => {
            const isRequest = inv.kind === 'request';
            const inviteStacked = fontBucket === 'large' || fontBucket === 'xl';
            return (
              <View
                key={`inv-${inv.id}-${i}`}
                style={[
                  styles.flockRow,
                  i === pendingInvites.length - 1 && styles.flockRowLast,
                  inviteStacked && styles.inviteRowStacked,
                ]}
              >
                <Text style={[styles.flockName, inviteStacked && styles.invitePromptFull]}>
                  {t(isRequest ? 'subgroup.requestPrompt' : 'subgroup.invitePrompt', {
                    name: inv.inviterName,
                    team: inv.subgroupName,
                  })}
                </Text>
                <View style={[styles.splitActions, inviteStacked && styles.inviteActionsRow]}>
                  <Pressable
                    style={[styles.chip, { backgroundColor: accentMix(accent, 24), borderColor: accentMix(accent, 50) }]}
                    onPress={() => void handleAcceptInvite(inv.id)}
                    testID={`subgroup-invite-accept-${inv.id}`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.chipText}>
                      {t(isRequest ? 'subgroup.approve' : 'subgroup.accept')}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={styles.chipGhost}
                    onPress={() => void handleDeclineInvite(inv.id)}
                    testID={`subgroup-invite-decline-${inv.id}`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.chipText}>{t('subgroup.decline')}</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      )}
    
      <View style={styles.listGroup}>
        <Pressable
          style={[styles.listRow, styles.listRowLast]}
          testID="map-invite-members"
          onPress={() => {
            lightTap();
            setOverlay('invite');
          }}
          accessibilityRole="button"
        >
          <Text style={styles.listRowTitle}>{t('map.inviteMembers')}</Text>
          <Ionicons name="chevron-forward" size={16} color={glass.textTertiary} />
        </Pressable>
      </View>
    
      {/* 精準定位 — 成員欄最下方 */}
      <View style={[styles.accuracyRow, styles.accuracyRowLast]}>
        <View style={styles.accuracyCopy}>
          <Text style={styles.accuracyLabel}>
            {t('settings.preciseLocation')}
          </Text>
          <Text style={styles.accuracyBattery}>{t('settings.preciseLocationHint')}</Text>
        </View>
        <SystemToggle
          value={highAccuracy}
          testID="map-precise-location"
          onValueChange={setHighAccuracy}
          accessibilityLabel={t('settings.preciseLocation')}
        />
      </View>
    </>
  );
}
