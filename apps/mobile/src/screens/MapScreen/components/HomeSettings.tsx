import { APP_TEXT_SIZE } from '../../../theme/typeScale';
import WaveLoading from '../../../components/WaveLoading';
import React, { useRef, useState } from 'react';
import { Alert, Linking, StyleSheet, View, type ViewStyle } from 'react-native';
import Pressable from '../../../components/MotionPressable';
import { Ionicons } from '@expo/vector-icons';
import { AccountSheetContent } from '../../../components/AccountSheet';
import { HitherText, HitherTextInput } from '../../../components/HitherText';
import NotificationPreferencesCard from '../../../components/NotificationPreferencesCard';
import SystemToggle from '../../../components/SystemToggle';
import { avatarColorForGroup, avatarForGroup, displayMemberAvatar } from '../../../constants/avatars';
import { requireUserId } from '../../../api/services/_helpers';
import { updateGroupIdentity, type JoinedGroupInfo } from '../../../api/services/GroupService';
import { useTranslation } from '../../../i18n';
import { MARQUEE_SPEED_MIN, MARQUEE_SPEED_MAX, usePreferences, useTheme } from '../../../state/PreferencesContext';
import { useSession } from '../../../state/SessionContext';
import { confirmAction } from '../../../utils/confirm';
import { confirmDeleteAccount } from '../../../utils/deleteAccount';
import { DEFAULT_NOTIFICATION_PREFERENCES, type Group, type CoordinationPolicy } from '../../../types';
import { setNotificationPreferences } from '../../../api/services/NotificationService';
import type { UseCoordinationRequestsResult } from '../hooks/useCoordinationRequests';
import type { SettingsOverlayProps } from './SettingsOverlay';
import SettingsSheetPanel from './SettingsSheetPanel';
import { AvatarColors, EmojiCarousel } from './IdentityPicker';
import { ProfileEditor } from './ProfileEditor';
import HomeTeamsPage, { HomeTeamCard } from './HomeTeamsPage';
import { useIdentityEditor } from './useIdentityEditor';
import { D6Surface, useD6Numbers } from './D6HomeChrome';
import { MAP_SHEET_CORNER_RADIUS } from '../../../components/mapSheetChrome';
import PrefSlider from '../../../components/PrefSlider';
import { useSettingsUpdate } from './useSettingsUpdate';
import SheetHeaderAction from '../../../components/SheetHeaderAction';

export type SettingsPage = 'root' | 'profile' | 'team' | 'teams' | 'store' | 'notifications' | 'appearance' | 'account' | 'advanced' | 'coordination' | 'mapJourney' | 'support' | 'language';

export type HomeSettingsProps = {
  initialPage?: SettingsPage;
  liveActivitySettings?: { enabled: boolean; unlocked: boolean; unavailable: boolean; onChange: (enabled: boolean) => void };
  memberCount?: number;
  profileStatusColor?: string;
  refresh?: () => void;
  renderStore: (view: 'shop' | 'coins' | 'hidden') => React.ReactNode;
  onShareGroup?: () => void;
  onOpenCoordination?: () => void;
  onCreateCoordination?: UseCoordinationRequestsResult['createRequest'];
  onCoordinationCreated?: () => void;
  onConfirmEnd?: () => void;
  onSwitchTeam?: (info: JoinedGroupInfo) => void;
  onCreateTeam?: () => void;
  onJoinTeam?: () => void;
  inviteBlockedForAnonymousLeader?: boolean;
};

const colors = {
  white: '#fff',
  secondary: 'rgba(255,255,255,0.68)',
  accent: '#4C6FFF',
  success: '#34C759',
  destructive: '#FF6B6B',
};
const noop = () => undefined;

function Box({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.box, style]}>{children}</View>;
}

function Row({ label, value, action, divider, icon, destructive, testID }: {
  label: string;
  value?: string;
  action?: () => void;
  divider?: boolean;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  destructive?: boolean;
  testID?: string;
}) {
  const content = (
    <>
      <HitherText style={[styles.rowLabel, styles.fillRow, destructive && styles.destructive]}>{label}</HitherText>
      {value ? <HitherText style={styles.rowValue}>{value}</HitherText> : null}
      {icon || (action && !destructive) ? <Ionicons name={icon ?? 'chevron-forward'} size={17} color={icon === 'checkmark' ? colors.success : colors.secondary} /> : null}
    </>
  );
  const style = [styles.row, divider && styles.divider];
  return action ? (
    <Pressable testID={testID} style={style} onPress={action} accessibilityRole="button">{content}</Pressable>
  ) : <View testID={testID} style={style}>{content}</View>;
}

export default function HomeSettings({
  visible, initialPage = 'root', liveActivitySettings, onClose, onDismissComplete, memberCount = 0, group,
  profileStatusColor, refresh = noop, renderStore, isLeader = false, onShareGroup,
  onOpenCoordination, onCreateCoordination, onCoordinationCreated, onConfirmLeave, onConfirmEnd,
  onSwitchTeam, onCreateTeam, onJoinTeam, inviteBlockedForAnonymousLeader,
  onConfirmSignOut, onOpenFeedback, onAccountDeleted, onArchiveAllForTest, onGoHome, onConfirmResetPrefs,
}: SettingsOverlayProps & HomeSettingsProps) {
  const { t, language } = useTranslation();
  const { user, isAnonymous, deleteAccount } = useSession();
  const { colors: palette } = useTheme();
  const avatar = displayMemberAvatar(user?.avatar, user?.id ?? '', user?.avatarColor);
  const [stack, setStack] = useState<SettingsPage[]>([initialPage]);
  const [entry, setEntry] = useState({ visible, initialPage });
  if (entry.visible !== visible || entry.initialPage !== initialPage) {
    setEntry({ visible, initialPage });
    if (visible) setStack([initialPage]);
  }
  const page = stack[stack.length - 1];
  const go = (next: SettingsPage) => setStack(previous => [...previous, next]);
  const back = () => setStack(previous => previous.slice(0, -1));
  const [mounted, setMounted] = useState(visible);
  const [teamsLoading, setTeamsLoading] = useState(false);
  if (visible && !mounted) setMounted(true);

  const label = (zh: string, en: string) => (language === 'zh' ? zh : en);
  const title: Record<SettingsPage, string> = {
    root: '',
    profile: '',
    team: '',
    teams: label('切換隊伍', 'Switch teams'),
    store: label('商店', 'Store'),
    notifications: label('通知', 'Notifications'),
    appearance: label('外觀', 'Appearance'),
    account: t('settings.account'),
    advanced: t('settings.sectionAdvanced'),
    mapJourney: t('settings.sectionMapJourney'),
    support: t('settings.sectionSupport'),
    language: t('settings.language'),
    coordination: t('coordination.title'),
  };
  const provider = user?.provider === 'apple' ? 'Apple' : user?.provider === 'google' ? 'Google' : 'Email';
  const registered = !!user && !isAnonymous;

  return (<>
    <SettingsSheetPanel home singleStage visible={visible} zIndex={80} scrollResetKey={page}
      fitContent={page !== 'root' && page !== 'profile' && page !== 'team' && page !== 'store' && page !== 'teams'}
      fillContent={page === 'teams'}
      background={<D6Surface radius={MAP_SHEET_CORNER_RADIUS} thick />}
      title={title[page]} titleFontSize={24} doneLabel={label('關閉', 'Close')} backLabel={t('common.back')}
      onClose={onClose} onBack={stack.length > 1 ? back : undefined}
      onDismissComplete={() => { setMounted(false); onDismissComplete?.(); }}>
      <View testID="settings-slide-page" style={page === 'teams' ? styles.fillPage : undefined}>
        {page === 'root' ? (
          <>
            <Pressable style={styles.profileHeader} onPress={() => go('profile')} accessibilityRole="button"
              accessibilityLabel={user?.name ? `${t('profile.title')}，${user.name}` : t('profile.title')} testID="settings-page-profile">
              <View style={[styles.profileAvatar, { backgroundColor: avatar.color }]}>
                <HitherText typeRole="emoji" style={styles.profileEmoji}>{avatar.emoji}</HitherText>
                {profileStatusColor ? <View style={[styles.profileDot, { backgroundColor: profileStatusColor }]} /> : null}
              </View>
              <HitherText typeRole="title" style={styles.profileName} numberOfLines={2}>{user?.name}</HitherText>
              <Ionicons name="chevron-forward" size={18} color={colors.secondary} />
            </Pressable>
            {group ? <HomeTeamCard team={group} count={memberCount} onPress={() => go('team')} /> : null}
          </>
        ) : null}
        {mounted ? renderStore(page === 'root' ? 'coins' : page === 'store' ? 'shop' : 'hidden') : null}
        {page === 'root' ? (
          <>
            <Box>
              <Row label={title.teams} action={() => go('teams')} testID="settings-page-teams" />
              <Row label={title.store} action={() => go('store')} divider testID="settings-page-store" />
              {onGoHome ? <Row label={t('map.backToHome')} action={onGoHome} divider testID="settings-go-home" /> : null}
            </Box>
            <Box>
              <Row label={title.notifications} action={() => go('notifications')} testID="settings-page-notifications" />
              <Row label={title.appearance} action={() => go('appearance')} divider testID="settings-page-appearance" />
              <Row label={t('settings.language')} value={label('系統設定', 'System Settings')} icon="open-outline"
                action={() => { void Linking.openSettings().catch(() => Alert.alert(t('location.openSettings'))); }}
                divider testID="settings-page-language" />
              <Row label={title.mapJourney} action={() => go('mapJourney')} divider testID="settings-page-map-journey" />
            </Box>
            <Box>
              <Row label={title.account} value={registered ? provider : undefined} action={() => go('account')} testID="settings-page-account" />
              <Row label={title.advanced} action={() => go('advanced')} divider testID="settings-page-advanced" />
              <Row label={title.support} action={() => go('support')} divider testID="settings-page-support" />
            </Box>
          </>
        ) : null}
        {page === 'profile' ? <ProfileEditor key={user?.id} refresh={refresh} statusColor={profileStatusColor} /> : null}
        {page === 'team' && group ? (
          <HomeTeamSettings key={group.id} group={group} isLeader={isLeader} refresh={refresh}
            share={onShareGroup} showCode={!inviteBlockedForAnonymousLeader}
            onLeave={onConfirmLeave} onEnd={onConfirmEnd}
            coordination={isLeader && onCreateCoordination ? () => go('coordination') : onOpenCoordination} />
        ) : null}
        {page === 'teams' ? (
          <HomeTeamsPage onLoadingChange={setTeamsLoading} currentGroupId={group?.id} onSwitch={info => {
            if (info.group.id === group?.id) onClose();
            else onSwitchTeam?.(info);
          }} onCreate={onCreateTeam} onJoin={onJoinTeam} onLeaveCurrent={onConfirmLeave} />
        ) : null}
        {page === 'notifications' ? (
          <Box style={styles.noTopMargin}><NotificationPreferencesCard home colors={palette} /></Box>
        ) : null}
        {page === 'appearance' ? <Appearance openLanguage={() => go('language')} /> : null}
        {page === 'mapJourney' ? <MapJourneyPreferences activity={liveActivitySettings} onOpenStore={() => go('store')} /> : null}
        {page === 'language' ? <AppLanguage /> : null}
        {page === 'support' ? <Support visible={visible} onFeedback={onOpenFeedback} /> : null}
        {page === 'advanced' ? <Advanced onFeedback={onOpenFeedback} openSupport={() => go('support')} onArchiveAllForTest={onArchiveAllForTest} onResetTravel={onConfirmResetPrefs} /> : null}
        {page === 'coordination' && onCreateCoordination ? (
          <CoordinationForm create={onCreateCoordination} onCancel={back} onCreated={() => {
            if (onCoordinationCreated) {
              onClose();
              onCoordinationCreated();
            } else back();
          }} />
        ) : null}
        {page === 'account' && registered ? (
          <>
            <Box style={styles.noTopMargin}>
              <Row label={label(`使用 ${provider} 登入`, `Signed in with ${provider}`)} icon="checkmark" />
            </Box>
            <Box>
              <Row label={t('settings.signOut')} action={onConfirmSignOut} destructive testID="settings-signout" />
              <Row label={t('account.delete')} destructive divider testID="account-delete"
                action={() => confirmDeleteAccount({
                  t, actionId: 'account.delete', screen: 'Account', deleteAccount,
                  onDeleted: () => { onClose(); onAccountDeleted(); },
                })} />
            </Box>
          </>
        ) : null}
        {page === 'account' && !registered ? (
          <AccountSheetContent home visible onClose={stack.length > 1 ? back : onClose} accent={colors.accent} onAccountDeleted={onAccountDeleted} />
        ) : null}
      </View>
    </SettingsSheetPanel>
    {visible && page === 'teams' && teamsLoading ? <View testID="settings-teams-loading-overlay" pointerEvents="none" style={styles.teamsLoadingOverlay}>
      <WaveLoading size="large" color={colors.accent} />
    </View> : null}
  </>);
}

function HomeTeamSettings({ group, isLeader, refresh, share, showCode, coordination, onLeave, onEnd }: {
  group: Group;
  isLeader: boolean;
  refresh: () => void;
  share?: () => void;
  showCode: boolean;
  coordination?: () => void;
  onLeave: () => void;
  onEnd?: () => void;
}) {
  const { t, language } = useTranslation();
  const { user } = useSession();
  const numberFont = useD6Numbers(true);
  const { draft, failed, retry, change, finishName } = useIdentityEditor(`team:${group.id}`, {
    name: group.name,
    avatar: group.avatar ?? avatarForGroup(group.id),
    color: group.avatarColor ?? avatarColorForGroup(group.id),
  }, async changes => {
    if (!user || await requireUserId() !== user.id) return;
    await updateGroupIdentity(group.id, { name: changes.name, avatar: changes.avatar, avatarColor: changes.color });
    void Promise.resolve(refresh()).catch(() => undefined);
  });

  return (
    <View>
      <View style={[styles.bigTeamAvatar, { backgroundColor: draft.color }]}>
        <HitherText typeRole="emoji" style={styles.bigTeamEmoji}>{draft.avatar}</HitherText>
      </View>
      {isLeader ? <AvatarColors color={draft.color} onChange={color => change({ color })}
        label={t('profile.avatarColor')} prefix="settings-group" /> : null}
      <HitherTextInput style={[styles.input, styles.groupName]} accessibilityLabel={t('group.nameLabel')}
        value={draft.name} editable={isLeader} onChangeText={name => change({ name })} onBlur={finishName}
        keyboardAppearance="dark" returnKeyType="done" maxLength={60} testID="settings-group-name" />
      {isLeader ? <EmojiCarousel avatar={draft.avatar} color={draft.color} onChange={avatar => change({ avatar })} prefix="settings-group" /> : null}
      {failed ? <Row label={t('profile.saveFailed')} value={t('interaction.retry')} action={() => { void retry(); }} /> : null}
      {showCode || share ? (
        <View style={styles.code}>
          <HitherText typeRole="metric" style={[styles.codeText, numberFont && { fontFamily: numberFont, fontStyle: 'normal', fontWeight: '400' }]}>{showCode ? group.inviteCode : ''}</HitherText>
          {share ? <SheetHeaderAction action="share" onPress={share}
            accessibilityLabel={t('map.shareInviteLink')} testID="settings-team-share" /> : null}
        </View>
      ) : null}
      {coordination ? <Box><Row label={t('coordination.title')} action={coordination} testID="settings-team-coordination" /></Box> : null}
      <Box>
        <Row label={t('group.leave')} action={onLeave} destructive testID="settings-leave" />
        {isLeader && onEnd ? <Row label={language === 'zh' ? '結束群組' : t('map.endGroup')} action={onEnd} destructive divider testID="settings-end-group" /> : null}
      </Box>
    </View>
  );
}

function CoordinationForm({ create, onCancel, onCreated }: { create: UseCoordinationRequestsResult['createRequest']; onCancel: () => void; onCreated: () => void }) {
  const { t } = useTranslation();
  const [subject, setSubject] = useState('');
  const [policy, setPolicy] = useState<CoordinationPolicy>('majority');
  const [busy, setBusy] = useState(false);
  const flight = useRef(false);

  async function submit() {
    if (!subject.trim() || flight.current) return;
    flight.current = true;
    setBusy(true);
    try {
      const result = await create({
        subject: subject.trim(),
        subjectKind: 'itinerary',
        options: [
          { id: 'opt_a', label: t('coordination.optionKeep'), kind: 'keep_current' },
          { id: 'opt_b', label: t('coordination.optionChange'), kind: 'itinerary' },
        ],
        policy,
        defaultOutcome: 'opt_a',
        deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
      });
      if (result) onCreated();
      else Alert.alert(t('coordination.create'), t('subgroup.failed'));
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }

  return (
    <View testID="coordination-create-form">
      <HitherTextInput style={styles.input}
        value={subject} onChangeText={setSubject} maxLength={120}
        placeholder={t('coordination.subjectPlaceholder')} placeholderTextColor={colors.secondary}
        accessibilityLabel={t('coordination.subjectPlaceholder')} keyboardAppearance="dark"
        testID="coordination-subject-input" />
      <View style={[styles.chips, styles.policyChoices]}>
        {(['majority', 'unanimity'] satisfies CoordinationPolicy[]).map(option => (
          <Pressable key={option} style={[styles.chip, policy === option && styles.chipSelected]}
            onPress={() => setPolicy(option)} accessibilityRole="button" accessibilityState={{ selected: policy === option }}>
            <HitherText style={styles.chipLabel}>{t(`coordination.policy.${option}`)}</HitherText>
          </Pressable>
        ))}
      </View>
      <View style={styles.pollActions}>
        <Pressable style={styles.cancel} onPress={onCancel} disabled={busy} accessibilityRole="button">
          <HitherText style={styles.primaryText}>{t('common.cancel')}</HitherText>
        </Pressable>
        <Pressable style={[styles.primary, (busy || !subject.trim()) && styles.disabled]}
          onPress={() => { void submit(); }}
          accessibilityRole="button" accessibilityState={{ busy, disabled: busy || !subject.trim() }}
          disabled={busy || !subject.trim()} testID="coordination-create-submit">
          <HitherText style={styles.primaryText}>{t('coordination.submit')}</HitherText>
        </Pressable>
      </View>
    </View>
  );
}

function Appearance({ openLanguage }: { openLanguage: () => void }) {
  const { t, language } = useTranslation();
  const { themeName, setThemeName, textScale, setTextScale, followSystemTextSize, setFollowSystemTextSize } = usePreferences();
  const themes = [
    { val: 'night', label: t('settings.themeNight') },
    { val: 'day', label: t('settings.themeDay') },
    { val: 'dusk', label: t('settings.themeDusk') },
  ] as const;
  const text = [
    { val: 0.8, label: t('settings.textSizeXs') },
    { val: 0.9, label: t('settings.textSizeSm') },
    { val: 1, label: t('settings.textSizeMd') },
    { val: 1.1, label: t('settings.textSizeLg') },
    { val: 1.2, label: t('settings.textSizeXl') },
  ] as const;
  return (
    <>
      <Box style={styles.noTopMargin}>
        <HitherText style={styles.sectionLabel}>{language === 'zh' ? '主題' : 'Theme'}</HitherText>
        <View style={styles.chips}>
          {themes.map(option => <Pressable key={option.val}
            style={[styles.chip, themeName === option.val && styles.chipSelected]}
            onPress={() => setThemeName(option.val)} accessibilityRole="button"
            accessibilityState={{ selected: themeName === option.val }} testID={`settings-theme-${option.val}`}>
            <HitherText style={styles.chipLabel}>{option.label}</HitherText>
          </Pressable>)}
        </View>
      </Box>
      <Box>
        <HitherText style={styles.sectionLabel}>{t('settings.textSize')}</HitherText>
        <View style={styles.chips}>
          <Pressable style={[styles.chip, followSystemTextSize && styles.chipSelected]}
            accessibilityRole="button" accessibilityState={{ selected: followSystemTextSize }}
            onPress={() => setFollowSystemTextSize()} testID="settings-text-system">
            <HitherText style={styles.chipLabel}>{language === 'zh' ? '跟隨系統' : 'System'}</HitherText>
          </Pressable>
          {text.map(option => {
            const selected = !followSystemTextSize && textScale === option.val;
            return (
              <Pressable key={option.val} style={[styles.chip, selected && styles.chipSelected]}
                onPress={() => setTextScale(option.val)} accessibilityRole="button"
                accessibilityState={{ selected }} testID={`settings-text-${option.val}`}>
                <HitherText style={styles.chipLabel}>{option.label}</HitherText>
              </Pressable>
            );
          })}
        </View>
      </Box>
      <Box><Row label={language === 'zh' ? 'App 內語言' : 'In-app language'} action={openLanguage} testID="settings-app-language" /></Box>
    </>
  );
}

function Advanced({ onFeedback, openSupport, onArchiveAllForTest, onResetTravel }: {
  onResetTravel: () => void;
  onFeedback: () => void;
  openSupport: () => void;
  onArchiveAllForTest: () => void;
}) {
  const { t, language } = useTranslation();
  const { diagnosticUploadEnabled, setDiagnosticUploadEnabled, resetDisplayPreferences } = usePreferences();
  const [resetting, setResetting] = useState(false);
  const resetFlight = useRef(false);
  function confirmReset() {
    if (resetFlight.current) return;
    confirmAction({
      title: t('settings.resetAllPrefs'),
      message: language === 'zh' ? '將外觀、通知和其他顯示偏好恢復為預設值？' : 'Restore appearance, notifications, and other display preferences to their defaults?',
      confirmLabel: t('settings.resetAllPrefs'),
      destructive: true,
    }, () => {
      if (resetFlight.current) return;
      resetFlight.current = true;
      setResetting(true);
      void Promise.all([
        resetDisplayPreferences(),
        setNotificationPreferences(DEFAULT_NOTIFICATION_PREFERENCES),
      ]).catch(() => Alert.alert(t('settings.resetAllPrefs'), t('subgroup.failed')))
        .finally(() => { resetFlight.current = false; setResetting(false); });
    });
  }
  const [saving, setSaving] = useState(false);
  const name = t('settings.diagnosticUpload');
  const change = (next: boolean) => {
    if (saving) return;
    const update = async () => {
      setSaving(true);
      try { await setDiagnosticUploadEnabled(next); }
      catch { Alert.alert(name, t('profile.saveFailed')); }
      finally { setSaving(false); }
    };
    if (next) {
      confirmAction({
        title: t('settings.diagnosticUploadWarningTitle'),
        message: t('settings.diagnosticUploadWarningBody'),
        confirmLabel: t('settings.diagnosticUploadEnable'),
      }, () => { void update(); });
    } else void update();
  };

  return (
    <>
      <Box style={styles.noTopMargin}>
        <View style={styles.row}>
          <View style={styles.settingCopy}>
            <HitherText style={styles.rowLabel}>{name}</HitherText>
            <HitherText style={styles.settingHint}>{t('settings.diagnosticUploadHint')}</HitherText>
          </View>
          <SystemToggle value={diagnosticUploadEnabled} disabled={saving} onValueChange={change} accessibilityLabel={name}
            testID="settings-diagnostic-upload" />
        </View>
        <Row label={t('settings.resetAllPrefs')} action={resetting ? undefined : confirmReset} divider testID="settings-reset-preferences" />
        <Row label={t('settings.resetPrefs')} action={onResetTravel} divider testID="settings-reset-travel-preferences" />
        <Row label={t('settings.sectionSupport')} action={openSupport} divider />
      </Box>
      <Box><Row label={t('feedback.title')} action={onFeedback} testID="settings-feedback-advanced" /></Box>
      {__DEV__ ? (
        <Box><Row label={language === 'zh' ? '全部集合點標記為已完成（測試）' : 'Complete all stops (test)'}
          action={onArchiveAllForTest} testID="settings-archive" /></Box>
      ) : null}
    </>
  );
}

function MapJourneyPreferences({ activity, onOpenStore }: { activity: HomeSettingsProps['liveActivitySettings']; onOpenStore: () => void }) {
  const { t } = useTranslation();
  const { colors: palette } = useTheme();
  const {
    obliqueLocate, setObliqueLocate,
    gatherCardDefaultExpanded, setGatherCardDefaultExpanded,
    gatherCardTitleMarquee, setGatherCardTitleMarquee,
    gatherCardMarqueeSpeed, setGatherCardMarqueeSpeed,
  } = usePreferences();
  const settings = [
    { label: t('settings.obliqueLocate'), hint: t('settings.obliqueLocateHint'),
      value: obliqueLocate, change: setObliqueLocate, id: 'oblique-locate' },
    { label: t('settings.gatherCardDefaultExpanded'), hint: t('settings.homeItineraryDefaultExpandedHint'),
      value: gatherCardDefaultExpanded, change: setGatherCardDefaultExpanded, id: 'gather-expanded' },
    { label: t('settings.gatherCardTitleMarquee'), hint: t('settings.gatherCardTitleMarqueeHint'),
      value: gatherCardTitleMarquee, change: setGatherCardTitleMarquee, id: 'gather-marquee' },
  ];
  return <Box style={styles.noTopMargin}>
    {activity ? <View style={styles.row}>
      <View style={styles.settingCopy}>
        <HitherText style={styles.rowLabel}>{t('settings.liveActivity')}</HitherText>
        <HitherText style={styles.settingHint}>{t(activity.unavailable ? 'settings.liveActivityUnavailable' : activity.unlocked ? 'settings.liveActivityHint' : 'settings.liveActivityLocked')}</HitherText>
        {!activity.unlocked ? <Pressable onPress={onOpenStore} accessibilityRole="button"><HitherText style={[styles.rowLabel, { color: colors.accent }]}>{t('settings.liveActivityActivate')}</HitherText></Pressable> : null}
      </View>
      <SystemToggle value={activity.enabled && activity.unlocked} onValueChange={activity.onChange} accessibilityLabel={t('settings.liveActivity')} testID="settings-live-activity" />
    </View> : null}
    {settings.map(({ label, hint, value, change, id }, index) => (
      <View key={id} style={[styles.row, index > 0 && styles.divider]}>
        <View style={styles.settingCopy}>
          <HitherText style={styles.rowLabel}>{label}</HitherText>
          <HitherText style={styles.settingHint}>{hint}</HitherText>
        </View>
        <SystemToggle {...{ value, accessibilityLabel: label }} testID={`settings-${id}`} onValueChange={change} />
      </View>
    ))}
    {gatherCardTitleMarquee ? (
      <View style={[styles.speedSetting, styles.divider]}>
        <HitherText style={styles.rowLabel}>{t('settings.gatherCardMarqueeSpeed')}</HitherText>
        <PrefSlider value={gatherCardMarqueeSpeed} min={MARQUEE_SPEED_MIN} max={MARQUEE_SPEED_MAX}
          onChange={setGatherCardMarqueeSpeed} accent={palette.accent} accessibilityLabel={t('settings.gatherCardMarqueeSpeed')} />
      </View>
    ) : null}
  </Box>;
}

function AppLanguage() {
  const { language } = useTranslation();
  const { setLanguage, followSystemLanguage } = usePreferences();
  return <Box style={styles.noTopMargin}>
    <Row label="中文" action={() => setLanguage('zh')} icon={language === 'zh' ? 'checkmark' : undefined} testID="settings-language-zh" />
    <Row label="English" action={() => setLanguage('en')} icon={language === 'en' ? 'checkmark' : undefined} divider testID="settings-language-en" />
    <Row label={language === 'zh' ? '跟隨系統' : 'Follow system'} action={() => { void followSystemLanguage(); }} divider testID="settings-language-system" />
  </Box>;
}

function Support({ visible, onFeedback }: { visible: boolean; onFeedback: () => void }) {
  const { t } = useTranslation();
  const { appVersion, showOtaApply, applyingOta, handleApplyOta, otaSummary, check } = useSettingsUpdate(visible);
  return <>
    {check}
    <Box style={styles.noTopMargin}>
      <HitherText style={styles.sectionLabel}>{t('settings.aboutHither')}</HitherText>
      <Row label={t('settings.version', { version: appVersion })} />
      <Row label={t('settings.otaLabel', { detail: otaSummary })} divider />
      {showOtaApply ? <Pressable style={[styles.primary, styles.updateAction, applyingOta && styles.disabled]}
        accessibilityRole="button" disabled={applyingOta} onPress={() => void handleApplyOta()} testID="settings-apply-ota">
        <HitherText style={styles.primaryText}>{t(applyingOta ? 'settings.applyingOta' : 'settings.applyOta')}</HitherText>
      </Pressable> : null}
    </Box>
    <Box><Row label={t('feedback.title')} action={onFeedback} testID="settings-feedback" /></Box>
  </>;
}

const styles = StyleSheet.create({
  teamsLoadingOverlay: { ...StyleSheet.absoluteFill, zIndex: 81, alignItems: 'center', justifyContent: 'center' },
  fillPage: { flex: 1, paddingTop: 12 },
  box: { backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 18, paddingHorizontal: 16, marginTop: 14 },
  noTopMargin: { marginTop: 0 },
  row: { minHeight: 58, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)' },
  rowLabel: { color: colors.white, fontSize: APP_TEXT_SIZE.body, fontWeight: '600' },
  fillRow: { flex: 1, minWidth: 0 },
  rowValue: { color: colors.secondary, fontSize: APP_TEXT_SIZE.caption, flexShrink: 1 },
  settingCopy: { flex: 1, minWidth: 0, gap: 5 },
  settingHint: { color: colors.secondary, fontSize: APP_TEXT_SIZE.caption },
  speedSetting: { paddingVertical: 10, gap: 6 },
  updateAction: { marginBottom: 12 },
  destructive: { color: colors.destructive },
  profileHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 4, paddingTop: 2, paddingBottom: 16 },
  profileAvatar: { boxShadow: '0 4px 0 rgba(0,0,0,0.28)', width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  profileDot: { position: 'absolute', right: 0, bottom: 0, width: 16, height: 16, borderRadius: 8, borderWidth: 3, borderColor: '#26302E' },
  profileEmoji: { fontSize: 36 },
  profileName: { flex: 1, color: colors.white, fontSize: APP_TEXT_SIZE.title, fontWeight: '800' },
  bigTeamAvatar: { alignSelf: 'center', marginTop: 6, marginBottom: 11, width: 96, height: 96, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  bigTeamEmoji: { fontSize: 54 },
  input: { minHeight: 48, borderRadius: 16, color: colors.white, backgroundColor: 'rgba(255,255,255,0.09)', paddingHorizontal: 12, fontSize: APP_TEXT_SIZE.caption },
  groupName: { marginTop: 14, textAlign: 'center', fontWeight: '600', fontSize: APP_TEXT_SIZE.body },
  code: { minHeight: 68, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.07)', marginTop: 14 },
  codeText: { fontSize: APP_TEXT_SIZE.heading, fontWeight: '800', fontStyle: 'italic', letterSpacing: 4, color: colors.white },
  sectionLabel: { fontSize: APP_TEXT_SIZE.caption, fontWeight: '600', color: colors.white, paddingTop: 12, paddingBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 12 },
  chip: { minHeight: 44, borderRadius: 22, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'transparent' },
  chipSelected: { backgroundColor: 'rgba(255,255,255,0.15)', borderColor: 'rgba(255,255,255,0.66)' },
  chipLabel: { color: colors.white, fontSize: APP_TEXT_SIZE.caption, fontWeight: '600' },
  policyChoices: { marginTop: 12, paddingBottom: 0 },
  pollActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  primary: { flex: 1, minHeight: 48, borderRadius: 24, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  cancel: { flex: 1, minHeight: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: colors.white, fontSize: APP_TEXT_SIZE.caption, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
