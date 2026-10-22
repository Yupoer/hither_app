import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { HitherText } from '../../../components/HitherText';
import { displayMemberAvatar } from '../../../constants/avatars';
import { glass } from '../../../glass';
import { type TranslationKey } from '../../../i18n';
import { useForegroundClock } from '../../../state/foregroundUi';
import { isLocationSampleFresh, locationFreshness } from '../../../utils/locationFreshness';

/**
 * One flock member row. Owns a 30s tick for freshness / "moving" status so the
 * parent MapScreen tree is not on a location-age interval.
 */
export const FlockRow = React.memo(function FlockRow({
  userId,
  name,
  avatar,
  color,
  isLeader,
  solo,
  subgroupId,
  dist,
  arrived,
  lastUpdated,
  sharingEnabled,
  locationTrackingMode,
  locationSource,
  locationNavigationSessionId,
  serverTimeOffsetMs,
  syncFailed,
  isMe,
  canKick = false,
  last,
  styles,
  t,
  accent,
  onSelfMerge,
  onSelfSplit,
  onKick,
}: {
  userId: string;
  name: string;
  avatar?: string | null;
  color: string;
  isLeader: boolean;
  solo: boolean;
  subgroupId?: string | null;
  dist: string;
  arrived: boolean;
  lastUpdated?: string;
  sharingEnabled?: boolean;
  locationTrackingMode?: string | null;
  locationSource?: string | null;
  locationNavigationSessionId?: string | null;
  serverTimeOffsetMs: number;
  syncFailed: boolean;
  isMe: boolean;
  canKick?: boolean;
  last: boolean;
  styles: any;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  /** Theme accent for primary self actions (e.g. 建立小隊). */
  accent: string;
  onSelfMerge: () => void | Promise<unknown>;
  onSelfSplit: () => void | Promise<unknown>;
  onKick?: () => void;
}) {
  const nowMs = useForegroundClock(30_000);

  const movingRecently = isLocationSampleFresh(lastUpdated, {
    locationTrackingMode, locationSource, locationNavigationSessionId,
  }, nowMs + serverTimeOffsetMs);
  const statusText = solo
    ? t('solo.badge')
    : isLeader
      ? t('flock.leading')
      : arrived
        ? t('memberStatus.arrived')
        : movingRecently
          ? t('memberStatus.moving')
          : t('memberStatus.notStarted');
  const role = isLeader ? t('map.leaderRole') : t('map.memberRole');
  const distOrStatus = dist || statusText;
  const freshness = locationFreshness(lastUpdated, nowMs + serverTimeOffsetMs);
  const freshnessText = sharingEnabled === false ? t('map.locationSharingStopped') :
    freshness.unit === 'minutes'
      ? t('locationUpdate.minutes', { minutes: freshness.value })
      : freshness.unit === 'hours'
        ? t('locationUpdate.hours', { hours: freshness.value })
        : t(`locationUpdate.${freshness.unit}`);

  return (
    <View style={[styles.flockRow, last && styles.flockRowLast]}>
      <View style={styles.flockRowMain}>
        <View
          style={[
            styles.flockAvatar,
            {
              backgroundColor: color,
              borderColor: isLeader ? 'rgba(255,255,255,0.55)' : 'transparent',
            },
          ]}
        >
          <HitherText typeRole="emoji" style={styles.flockEmoji}>
            {displayMemberAvatar(avatar, userId).emoji}
          </HitherText>
        </View>
        <View style={styles.grow}>
          <Text style={styles.flockName}>{isMe ? t('flock.you') : name}</Text>
          <Text style={styles.flockStatus} numberOfLines={2}>
            <Text style={styles.flockMetaRole}>{role}</Text>
            {!isMe && distOrStatus ? (
              <Text style={styles.flockMetaDist}>{` · ${distOrStatus}`}</Text>
            ) : null}
            {freshnessText ? (
              <Text style={styles.flockMetaFresh}>{` · ${freshnessText}${syncFailed ? ` · ${t('map.locationSyncFailed')}` : ''}`}</Text>
            ) : null}
            {!isMe && solo ? (
              <Text style={styles.flockMetaWarn}>{` · ${t('solo.badge')}`}</Text>
            ) : null}
          </Text>
        </View>
      </View>
      {isMe && (
        <View style={styles.selfControls}>
          {subgroupId ? (
            <Pressable
              onPress={() => void onSelfMerge()}
              hitSlop={8}
              accessibilityRole="button"
              style={({ pressed }) => pressed && styles.rowActionPressed}
            >
              <Text style={styles.rowActionSecondary}>
                {t('subgroup.leaveTeam')}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => void onSelfSplit()}
              hitSlop={8}
              accessibilityRole="button"
              style={({ pressed }) => pressed && styles.rowActionPressed}
            >
              <Text style={[styles.rowActionSecondary, { color: accent }]}>
                {t('subgroup.createTeam')}
              </Text>
            </Pressable>
          )}
        </View>
      )}
      {!isMe && canKick && onKick ? (
        <View style={styles.selfControls}>
          <Pressable
            onPress={onKick}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('group.kick')}
            style={({ pressed }) => pressed && styles.rowActionPressed}
          >
            <Text style={[styles.rowActionSecondary, { color: glass.danger }]}>
              {t('group.kick')}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
});
