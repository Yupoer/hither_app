import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { accentMix } from '../../../glass';
import type { TranslationKey } from '../../../i18n';
import type { Subgroup } from '../../../types';
import type { UseCoordinationRequestsResult } from '../hooks/useCoordinationRequests';
import type { MemberInboxEntry } from '../memberInbox';
import type { MapStyles } from '../styles';
import { CoordinationRequestsPanel } from './CoordinationRequestsPanel';
import InviteMembersSheet from './InviteMembersSheet';

export function MemberInboxSheet({
  accent, name, entries, coordination, isLeader, manageCoordination, busy,
  onResolve, onClose, styles, subgroups, t,
}: {
  accent: string;
  name: string | null;
  entries: readonly MemberInboxEntry[];
  coordination: UseCoordinationRequestsResult;
  isLeader: boolean;
  manageCoordination: boolean;
  busy: boolean;
  onResolve: (entry: Extract<MemberInboxEntry, { kind: 'start' | 'destination' }>, approve: boolean) => void;
  onClose: () => void;
  styles: MapStyles;
  subgroups: Subgroup[];
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  const requests = entries.flatMap(entry => entry.kind === 'coordination' ? [entry.request] : []);
  const messages = entries.map(entry => {
    switch (entry.kind) {
      case 'coordination':
        return null;
      case 'notice': {
        const { item } = entry;
        return (
          <View key={item.id} style={styles.listGroup} testID={`member-inbox-notice-${item.id}`}>
            <View style={[styles.listRow, styles.listRowLast]}>
              <View style={styles.grow}>
                <Text style={styles.listRowTitle}>{t(`exception.type.${item.type}`)}</Text>
                <Text style={styles.overlayHint}>
                  {item.gatheringPointTitle ? `${t('exception.gathering', { title: item.gatheringPointTitle })} · ` : ''}
                  {t('exception.lastSeen', {
                    time: new Date(item.lastSeenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  })}
                </Text>
              </View>
            </View>
          </View>
        );
      }
      case 'start':
      case 'destination': {
        const { request } = entry;
        const title = entry.kind === 'start'
          ? entry.request.title
          : entry.request.items.map(item => item.title).join('、');
        const label = t(entry.kind === 'start' ? 'command.request_start' : 'gatherRequest.pending');
        return (
          <View key={`${entry.kind}:${request.id}`} style={styles.listGroup} testID={`member-inbox-${entry.kind}-${request.id}`}>
            <View style={[styles.listRow, styles.listRowLast]}>
              <View style={styles.grow}>
                <Text style={styles.listRowTitle}>{label}</Text>
                <Text style={styles.overlayHint}>{title}</Text>
                {entry.kind === 'destination' ? (
                  <Text style={styles.overlayHint}>{t('gatherRequest.target', {
                    team: entry.request.subgroupId
                      ? subgroups.find(team => team.id === entry.request.subgroupId)?.name ?? t('gatherRequest.unknownTeam')
                      : t('gatherRequest.mainTeam'),
                  })}</Text>
                ) : null}
              </View>
            </View>
            <View style={[styles.splitActions, { paddingHorizontal: 12, paddingBottom: 10 }]}>
              <Pressable
                style={[styles.chipGhost, { minHeight: 44 }, busy && { opacity: 0.5 }]}
                onPress={() => onResolve(entry, false)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={t('gatherRequest.reject')}
                testID={`${entry.kind === 'start' ? 'start' : 'gather'}-request-reject-${request.id}`}
              >
                <Text style={styles.chipText}>{t('gatherRequest.reject')}</Text>
              </Pressable>
              <Pressable
                style={[styles.chip, { minHeight: 44, backgroundColor: accentMix(accent, 24) }, busy && { opacity: 0.5 }]}
                onPress={() => onResolve(entry, true)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={t('gatherRequest.approve')}
                testID={`${entry.kind === 'start' ? 'start' : 'gather'}-request-approve-${request.id}`}
              >
                <Text style={styles.chipText}>{t('gatherRequest.approve')}</Text>
              </Pressable>
            </View>
          </View>
        );
      }
    }
  });
  return (
    <InviteMembersSheet
      visible={name !== null || manageCoordination}
      title={manageCoordination ? t('coordination.title') : t('memberInbox.title', { name: name ?? '' })}
      doneLabel={t('map.done')}
      onClose={onClose}
      accent={accent}
    >
      {manageCoordination || requests.length > 0 ? (
        <CoordinationRequestsPanel
          key={manageCoordination ? 'manage' : name}
          accent={accent}
          isLeader={isLeader}
          showCreateAction={manageCoordination}
          styles={styles}
          coordination={manageCoordination ? coordination : { ...coordination, requests }}
          header={messages}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.overlayBody} testID="member-inbox">
          {entries.length > 0 ? messages : <Text style={styles.overlayHint}>{t('memberInbox.empty')}</Text>}
        </ScrollView>
      )}
    </InviteMembersSheet>
  );
}
