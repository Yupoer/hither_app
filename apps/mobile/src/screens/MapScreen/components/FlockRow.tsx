import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText as Text } from '../../../components/AppText';
import Pressable from '../../../components/MotionPressable';
import Animated, { cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { HitherText } from '../../../components/HitherText';
import { displayMemberAvatar } from '../../../constants/avatars';
import { accentMix, glass } from '../../../glass';
import { useMountEffect } from '../../../hooks/useMountEffect';
import { type TranslationKey } from '../../../i18n';
import { useForegroundClock } from '../../../state/foregroundUi';
import { isLocationSampleFresh, locationFreshness } from '../../../utils/locationFreshness';
import { MemberInboxBadge } from './MemberInboxBadge';

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
  inboxCount,
  onOpenInbox,
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
  inboxCount: number;
  onOpenInbox: () => void;
}) {
  const { now: nowMs, lifecycle: clockLifecycle } = useForegroundClock(30_000);
  const reduceMotion = useReducedMotion();
  const revision = lastUpdated ? Date.parse(lastUpdated) : null;
  const [locationUpdate, setLocationUpdate] = useState({ revision, highlight: false });
  if (!Object.is(revision, locationUpdate.revision)) {
    setLocationUpdate({
      revision,
      highlight: revision != null && (locationUpdate.revision == null || revision > locationUpdate.revision),
    });
  }

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

  const rowContent = (
    <>
      <View>
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
        {inboxCount > 0 ? (
          <MemberInboxBadge count={inboxCount} style={{ top: -4, right: 0 }} testID={`member-inbox-badge-${userId}`} />
        ) : null}
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
    </>
  );

  return (
    <View style={[styles.flockRow, last && styles.flockRowLast]}>
      {clockLifecycle}
      {!isMe && sharingEnabled !== false && !reduceMotion && locationUpdate.highlight && (
        <FlockLocationTint key={locationUpdate.revision} accent={accent} />
      )}
      {inboxCount > 0 ? (
        <Pressable
          style={({ pressed }) => [styles.flockRowMain, pressed && styles.rowActionPressed]}
          accessibilityRole="button"
          accessibilityLabel={t('memberInbox.open', { name, count: inboxCount })}
          onPress={onOpenInbox}
          testID={`member-inbox-open-${userId}`}
        >
          {rowContent}
        </Pressable>
      ) : (
        <View style={styles.flockRowMain}>{rowContent}</View>
      )}
      {isMe && (
        <View style={styles.selfControls}>
          {subgroupId ? (
            <Pressable
              onPress={() => void onSelfMerge()}
              testID="map-subgroup-merge"
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
              testID="map-subgroup-split"
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
            testID={`map-kick-${userId}`}
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

function FlockLocationTint({ accent }: { accent: string }) {
  const opacity = useSharedValue(1);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
  useMountEffect(() => {
    opacity.set(withDelay(1_000, withTiming(0, { duration: 280 })));
    return () => cancelAnimation(opacity);
  });
  return (
    <Animated.View
      testID="map-member-location-tint"
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: accentMix(accent, 14) }, fade]}
    />
  );
}
