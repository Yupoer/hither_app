import { APP_TEXT_SIZE } from '../../../theme/typeScale';
import React from 'react';
import { View, StyleSheet } from 'react-native';
import Pressable from '../../../components/MotionPressable';
import { HitherText, HitherTextInput } from '../../../components/HitherText';
import { AVATAR_EMOJI, HOME_AVATAR_COLORS, displayMemberAvatar } from '../../../constants/avatars';
import { useSession } from '../../../state/SessionContext';
import { useTranslation } from '../../../i18n';
import { glass } from '../../../glass';
import { selectionTick } from '../../../utils/haptics';
import { logError } from '../../../utils/activityLog';
import { AvatarColors, EmojiCarousel } from './IdentityPicker';
import { useIdentityEditor } from './useIdentityEditor';
import { requireUserId } from '../../../api/services/_helpers';

export function ProfileEditor({ refresh, statusColor }: {
  refresh: () => void;
  statusColor?: string;
}) {
  const { t, language } = useTranslation();
  const { user, updateProfile } = useSession();
  const avatar = displayMemberAvatar(user?.avatar, user?.id ?? '', user?.avatarColor);
  const { draft, failed, retry, change, finishName } = useIdentityEditor(`profile:${user?.id}`, {
    name: user?.name ?? '',
    avatar: avatar.emoji,
    color: avatar.color ?? HOME_AVATAR_COLORS[0],
  }, async changes => {
    try {
      if (!user || await requireUserId() !== user.id) return;
      await updateProfile({
        nickname: changes.name,
        avatar: changes.avatar,
        avatarColor: changes.color,
      });
    } catch (error) {
      logError('profile_save_failed', error);
      throw error;
    }
    void Promise.resolve(refresh()).catch(() => undefined);
  });

  return (
    <View style={editorStyles.body}>
      <View style={[editorStyles.avatar, { backgroundColor: draft.color, shadowColor: draft.color }]}>
        <HitherText typeRole="emoji" style={editorStyles.avatarEmoji}>{draft.avatar}</HitherText>
        {statusColor ? <View style={[editorStyles.dot, { backgroundColor: statusColor }]} /> : null}
      </View>
      <HitherTextInput typeRole="title"
        style={editorStyles.name}
        testID="profile-name"
        accessibilityLabel={t('settings.nickname')}
        value={draft.name}
        onChangeText={name => change({ name })}
        onBlur={finishName}
        maxLength={24}
        placeholder={t('auth.namePlaceholder')}
        placeholderTextColor={glass.textTertiary}
        keyboardAppearance="dark"
        returnKeyType="done"
      />
      <EmojiCarousel avatar={draft.avatar} color={draft.color} onChange={next => change({ avatar: next })} prefix="profile" />
      <AvatarColors color={draft.color} onChange={color => change({ color })} label={t('profile.avatarColor')} prefix="profile" />
      <Pressable style={editorStyles.random} accessibilityRole="button" testID="profile-random"
        onPress={() => {
          selectionTick();
          const avatars = AVATAR_EMOJI.filter(value => value !== draft.avatar);
          const colors = HOME_AVATAR_COLORS.filter(value => value !== draft.color);
          change({
            avatar: avatars[Math.floor(Math.random() * avatars.length)],
            color: colors[Math.floor(Math.random() * colors.length)],
          });
        }}>
        <HitherText style={editorStyles.randomText}>{language === 'zh' ? '🎲 隨機' : '🎲 Random'}</HitherText>
      </Pressable>
      {failed ? (
        <Pressable style={editorStyles.random} accessibilityRole="button" onPress={() => { void retry(); }}>
          <HitherText style={editorStyles.error}>{t('profile.saveFailed')} · {t('interaction.retry')}</HitherText>
        </Pressable>
      ) : null}
    </View>
  );
}

const editorStyles = StyleSheet.create({
  body: { alignItems: 'center', paddingTop: 10, paddingBottom: 24 },
  avatar: { width: 132, height: 132, borderRadius: 66, alignItems: 'center', justifyContent: 'center', shadowOffset: { width: 0, height: 18 }, shadowRadius: 22, shadowOpacity: 0.55 },
  avatarEmoji: { fontSize: 74 },
  dot: { width: 26, height: 26, borderRadius: 13, borderWidth: 4, borderColor: '#26302E', position: 'absolute', bottom: 5, right: 5 },
  name: { alignSelf: 'stretch', height: 56, color: '#fff', textAlign: 'center', fontSize: APP_TEXT_SIZE.heading, fontWeight: '800', marginTop: 14, paddingVertical: 0 },
  random: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 18, borderRadius: 22, marginTop: 10, backgroundColor: 'rgba(255,255,255,0.10)' },
  randomText: { color: '#fff', fontSize: APP_TEXT_SIZE.caption, fontWeight: '600' },
  error: { color: '#FF9B9B', fontSize: APP_TEXT_SIZE.caption },
});
