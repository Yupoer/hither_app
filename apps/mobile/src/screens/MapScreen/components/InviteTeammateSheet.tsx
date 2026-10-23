import { HitherText } from '../../../components/HitherText';
import OverlaySheet from '../../../components/OverlaySheet';
import { displayMemberAvatar } from '../../../constants/avatars';
import { accentMix } from '../../../glass';
import { type TranslationKey } from '../../../i18n';
import React from 'react';
import { ScrollView, Text, View, Pressable } from 'react-native';
import type { MapStyles } from '../styles';

export interface InviteTeammateSheetProps {
  accent: string;
  handleInvite: (subgroupId: string, inviteeId: string) => Promise<void>;
  invitable: { userId: string; name: string; avatar: string | undefined; avatarColor: string; solo: boolean; subgroupId: string | undefined; color: string; isLeader: boolean; arrived: boolean; lastUpdated: string | null | undefined; sharingEnabled: boolean | undefined; locationTrackingMode: string | null | undefined; locationSource: string | null | undefined; locationNavigationSessionId: string | null | undefined; statusColor: "rgba(235, 235, 245, 0.6)" | "#5FD08A" | "#FF9F6B"; eta: string; dist: string; }[];
  inviteSheetOpen: boolean;
  mySubgroupId: string | undefined;
  setInviteSheetOpen: React.Dispatch<React.SetStateAction<boolean>>;
  styles: MapStyles;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

export function InviteTeammateSheet({
  accent,
  handleInvite,
  invitable,
  inviteSheetOpen,
  mySubgroupId,
  setInviteSheetOpen,
  styles,
  t,
}: InviteTeammateSheetProps) {
  return (
    <OverlaySheet
      visible={inviteSheetOpen}
      onClose={() => setInviteSheetOpen(false)}
      title={t('subgroup.inviteTitle')}
      accent={accent}
      doneLabel={t('map.done')}
      edgeToEdge
    >
      <ScrollView contentContainerStyle={styles.overlayBody}>
        {invitable.length === 0 ? (
          <Text style={styles.overlayHint}>{t('subgroup.inviteEmpty')}</Text>
        ) : (
          <View style={styles.list}>
            {invitable.map((f, i) => (
              <View
                key={f.userId}
                style={[styles.flockRow, i === invitable.length - 1 && styles.flockRowLast]}
              >
                <View style={styles.flockRowMain}>
                  <View style={[styles.flockAvatar, { backgroundColor: f.color, borderColor: 'transparent' }]}>
                    <HitherText typeRole="emoji" style={styles.flockEmoji}>
                      {displayMemberAvatar(f.avatar, f.userId).emoji}
                    </HitherText>
                  </View>
                  <View style={styles.grow}>
                    <Text style={styles.flockName}>{f.name}</Text>
                  </View>
                  <Pressable
                    style={[styles.chip, { backgroundColor: accentMix(accent, 24), borderColor: accentMix(accent, 50) }]}
                    onPress={() => mySubgroupId && void handleInvite(mySubgroupId, f.userId)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.chipText}>{t('subgroup.inviteAction')}</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </OverlaySheet>
  );
}
