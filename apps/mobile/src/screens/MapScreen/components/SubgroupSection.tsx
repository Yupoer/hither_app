import React from 'react';
import { View, Text, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../../../i18n';
import { lightTap } from '../../../utils/haptics';

const DISPLAY_FONT = Platform.OS === 'ios' ? 'SF Pro Rounded' : 'sans-serif-medium';

interface SubgroupSectionProps {
  subgroups: any[];
  flock: any[];
  mySubgroupId: string | null | undefined;
  sentInvites: any[];
  accent: string;
  setInviteSheetOpen: (open: boolean) => void;
  renderFlockRow: (f: any, last: boolean, index?: number) => React.ReactNode;
  styles: any;
}

export function SubgroupSection({
  subgroups,
  flock,
  mySubgroupId,
  sentInvites,
  accent,
  setInviteSheetOpen,
  renderFlockRow,
  styles,
}: SubgroupSectionProps) {
  const { t } = useTranslation();

  return (
    <>
      {subgroups.map((sg) => {
        const memberRows = flock.filter((f) => f.subgroupId === sg.id);
        const parentName = subgroups.find((s) => s.id === sg.parentId)?.name;
        return (
          <View key={sg.id} style={styles.subgroupCard}>
            <View style={styles.subgroupHead}>
              <View style={styles.grow}>
                <Text style={styles.subgroupName}>
                  {sg.name} · <Text style={{ fontFamily: DISPLAY_FONT }}>{memberRows.length}</Text>
                </Text>
                <Text style={styles.subgroupMeta}>
                  {t('subgroup.collab')}
                  {parentName ? ` · ${t('subgroup.childOf', { name: parentName })}` : ''}
                </Text>
              </View>
            </View>
            {memberRows.map((f, i) => renderFlockRow(f, i === memberRows.length - 1, i))}
            {/* Invite entry lives ON my own team card — where you look to grow
                the team — instead of buried on every other member's row. */}
            {sg.id === mySubgroupId && (
              <Pressable
                style={({ pressed }) => [
                  styles.inviteMemberBtn,
                  { backgroundColor: accent },
                  pressed && { opacity: 0.85 },
                ]}
                onPress={() => {
                  lightTap();
                  setInviteSheetOpen(true);
                }}
                accessibilityRole="button"
              >
                <Ionicons name="person-add" size={16} color="#0c1a12" />
                <Text style={[styles.rowAction, { color: '#0c1a12' }]}>
                  {t('subgroup.inviteAction')}
                </Text>
              </Pressable>
            )}
            {/* So sending an invite doesn't look like it did nothing while
                the other person hasn't accepted yet. */}
            {sg.id === mySubgroupId && sentInvites.length > 0 && (
              <Text style={styles.subgroupPendingHint}>
                {t('subgroup.pendingInvites', {
                  names: sentInvites.map((i) => i.inviteeName).join('、'),
                })}
              </Text>
            )}
          </View>
        );
      })}
    </>
  );
}
