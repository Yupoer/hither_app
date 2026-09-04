import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Host, Button } from '@expo/ui/swift-ui';
import { HitherText } from './HitherText';
import {
  buttonBorderShape,
  buttonStyle,
  frame,
} from '@expo/ui/swift-ui/modifiers';
import { Ionicons } from '@expo/vector-icons';
import { liquidGlass } from '../native';
import type { NativeTeamCardProps } from './NativeTeamCard';

/** Native SwiftUI team-card header. Expanded actions stay RN siblings so each remains independently tappable. */
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
  accessibilityLabel: a11yLabel,
  testID,
  style,
  children,
}: NativeTeamCardProps) {
  const shownMembers = members.slice(0, 4);
  return (
    <View style={[styles.card, style]}>
      {/* Card shape: buttonBorderShape('roundedRectangle', 24) */}
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        accessibilityState={{ expanded }}
        testID={testID}
        style={({ pressed }) => [styles.headerRow, pressed && styles.pressed]}
      >
      <View style={[styles.groupAvatar, { backgroundColor: groupColor }]}>
        <HitherText typeRole="emoji" style={styles.groupEmoji}>{groupEmoji}</HitherText>
      </View>
      <View style={styles.copy}>
        <Text style={styles.name} numberOfLines={1}>{teamName}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.subtitle}>{subtitle}</Text>
          {inviteCode ? <Text style={styles.code}>{inviteCode}</Text> : null}
        </View>
      </View>
      <View style={styles.trailing}>
        <View style={styles.stack}>
          {shownMembers.map((member, index) => (
            <View key={index} style={[styles.member, { zIndex: 10 - index }]}>
              {member.placeholder ? (
                <Ionicons name="person" size={14} color="rgba(255,255,255,0.25)" />
              ) : (
                <HitherText typeRole="emoji" style={styles.memberEmoji}>{member.emoji}</HitherText>
              )}
            </View>
          ))}
          {extraCount > 0 ? (
            <View style={[styles.member, styles.extra]}>
              <Text style={styles.extraText}>+{extraCount}</Text>
            </View>
          ) : null}
        </View>
      </View>
      </Pressable>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderRadius: 24,
    backgroundColor: 'rgba(10, 16, 28, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    overflow: 'hidden',
  },
  headerRow: {
    minHeight: 84,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  groupAvatar: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  groupEmoji: { fontSize: 26 },
  copy: { flex: 1, minWidth: 0 },
  name: { color: '#fff', fontSize: 16.5, fontWeight: '700', marginBottom: 5 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  subtitle: { color: 'rgba(255,255,255,0.65)', fontSize: 13 },
  code: {
    color: '#ff9500',
    backgroundColor: 'rgba(255,149,0,0.2)',
    borderRadius: 7,
    width: 85,
    textAlign: 'center',
    paddingVertical: 2,
    fontSize: 14.5,
    fontWeight: '800',
  },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 8 },
  stack: { flexDirection: 'row', alignItems: 'center' },
  member: {
    width: 32,
    height: 32,
    marginLeft: -10,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#132034',
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberEmoji: { fontSize: 16 },
  extra: { marginLeft: -10, backgroundColor: 'rgba(255,255,255,0.18)' },
  extraText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  pressed: { opacity: 0.82 },
});
