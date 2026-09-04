import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export type NativeTeamCardMember = { emoji?: string; placeholder?: boolean };
export type NativeTeamCardProps = {
  teamName: string;
  subtitle: string;
  inviteCode?: string;
  groupEmoji: string;
  groupColor?: string;
  members: NativeTeamCardMember[];
  extraCount: number;
  expanded: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
};

/** Non-iOS fallback; iOS resolves the sibling SwiftUI implementation. */
export default function NativeTeamCard({
  teamName,
  subtitle,
  inviteCode,
  groupEmoji,
  groupColor = 'rgba(255,255,255,0.16)',
  members,
  extraCount,
  expanded,
  onPress,
  accessibilityLabel,
  testID,
  style,
  children,
}: NativeTeamCardProps) {
  return (
    <View style={[styles.card, style]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ expanded }}
        testID={testID}
        style={({ pressed }) => [styles.headerRow, pressed && styles.pressed]}
      >
        <View style={[styles.groupAvatar, { backgroundColor: groupColor }]}><Text style={styles.groupEmoji}>{groupEmoji}</Text></View>
        <View style={styles.copy}>
          <Text style={styles.name} numberOfLines={1}>{teamName}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.subtitle}>{subtitle}</Text>
            {inviteCode ? <Text style={styles.code}>{inviteCode}</Text> : null}
          </View>
        </View>
        <View style={styles.trailing}>
          <View style={styles.stack}>
            {members.map((member, index) => (
              <View key={index} style={[styles.member, { zIndex: 10 - index }]}>
                {member.placeholder ? <Ionicons name="person" size={14} color="rgba(255,255,255,0.25)" /> : <Text style={styles.memberEmoji}>{member.emoji}</Text>}
              </View>
            ))}
            {extraCount > 0 ? <View style={[styles.member, styles.extra]}><Text style={styles.extraText}>+{extraCount}</Text></View> : null}
          </View>
        </View>
      </Pressable>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%', borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.22)', backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  headerRow: { minHeight: 84, width: '100%', flexDirection: 'row', alignItems: 'center', padding: 16 },
  groupAvatar: { width: 48, height: 48, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  groupEmoji: { fontSize: 26 },
  copy: { flex: 1, minWidth: 0 },
  name: { color: '#fff', fontSize: 16.5, fontWeight: '700', marginBottom: 5 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  subtitle: { color: 'rgba(255,255,255,0.65)', fontSize: 13 },
  code: { color: '#ff9500', backgroundColor: 'rgba(255,149,0,0.2)', borderRadius: 7, width: 85, textAlign: 'center', paddingVertical: 2, fontSize: 14.5, fontWeight: '800' },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 8 },
  stack: { flexDirection: 'row', alignItems: 'center' },
  member: { width: 32, height: 32, marginLeft: -10, borderRadius: 16, borderWidth: 2, borderColor: '#132034', backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  memberEmoji: { fontSize: 16 },
  extra: { marginLeft: -10, backgroundColor: 'rgba(255,255,255,0.18)' },
  extraText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  pressed: { opacity: 0.82 },
});
