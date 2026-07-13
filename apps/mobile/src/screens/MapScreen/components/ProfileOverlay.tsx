import React, { useState, useEffect, useCallback } from 'react';
import { ScrollView, View, Text, TextInput, Pressable, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import OverlaySheet from '../../../components/OverlaySheet';
import { AVATAR_EMOJI, AVATAR_COLORS } from '../../../constants/avatars';
import { useSession } from '../../../state/SessionContext';
import { useTheme } from '../../../state/PreferencesContext';
import { useTranslation } from '../../../i18n';
import { glass, memberColor, accentMix } from '../../../glass';
import { selectionTick } from '../../../utils/haptics';
import { logEvent, logError } from '../../../utils/activityLog';

interface ProfileOverlayProps {
  visible: boolean;
  onClose: () => void;
  refresh: () => void;
  styles: any;
}

export function ProfileOverlay({
  visible,
  onClose,
  refresh,
  styles,
}: ProfileOverlayProps) {
  const { t } = useTranslation();
  const { user, updateProfile } = useSession();
  const { colors } = useTheme();
  const accent = colors.accent;

  const [profileName, setProfileName] = useState('');
  const [profileAvatar, setProfileAvatar] = useState<string | undefined>(undefined);
  const [profileColor, setProfileColor] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (visible) {
      setProfileName(user?.name ?? '');
      setProfileAvatar(user?.avatar);
      setProfileColor(user?.avatarColor);
    }
  }, [visible, user]);

  const handleSaveAndClose = useCallback(() => {
    onClose();
    const nickname = profileName.trim();
    const fields: { nickname?: string; avatar?: string; avatarColor?: string } = {};
    if (nickname && nickname !== user?.name) fields.nickname = nickname;
    if (profileAvatar && profileAvatar !== user?.avatar) fields.avatar = profileAvatar;
    if (profileColor && profileColor !== user?.avatarColor) fields.avatarColor = profileColor;
    if (!fields.nickname && !fields.avatar && !fields.avatarColor) return;
    
    logEvent('profile_save', { changed: Object.keys(fields) });
    updateProfile(fields)
      .then(() => refresh())
      .catch((e) => {
        logError('profile_save_failed', e);
        Alert.alert(
          t('profile.saveFailed'),
          e instanceof Error ? e.message : undefined,
        );
      });
  }, [profileName, profileAvatar, profileColor, user, updateProfile, refresh, t, onClose]);

  return (
    <OverlaySheet
      visible={visible}
      onClose={handleSaveAndClose}
      title={t('profile.title')}
      accent={accent}
      doneLabel={t('map.done')}
    >
      <ScrollView contentContainerStyle={styles.overlayBody}>
        <View style={styles.profilePreviewRow}>
          <View
            style={[
              styles.profilePreviewAvatar,
              { backgroundColor: profileColor ?? memberColor(user?.id ?? '') },
            ]}
          >
            {profileAvatar ? (
              <Text style={styles.profilePreviewEmoji}>{profileAvatar}</Text>
            ) : (
              <Text style={styles.profilePreviewInitial}>
                {(profileName || user?.name || '?').slice(0, 1).toUpperCase()}
              </Text>
            )}
          </View>
        </View>

        <Text style={styles.sectionLabel}>{t('settings.nickname')}</Text>
        <View style={styles.profileRow}>
          <TextInput
            style={styles.profileInput}
            value={profileName}
            onChangeText={setProfileName}
            maxLength={24}
            placeholder={t('auth.namePlaceholder')}
            placeholderTextColor={glass.textTertiary}
            returnKeyType="done"
            onSubmitEditing={handleSaveAndClose}
          />
        </View>

        <Text style={styles.profileSectionLabel}>{t('profile.avatar')}</Text>
        <View style={styles.emojiGrid}>
          {AVATAR_EMOJI.map((e) => (
            <Pressable
              key={e}
              onPress={() => setProfileAvatar(e)}
              accessibilityRole="button"
              accessibilityState={{ selected: profileAvatar === e }}
              style={[
                styles.emojiCell,
                profileAvatar === e && {
                  borderColor: accent,
                  backgroundColor: accentMix(accent, 18),
                },
              ]}
            >
              <Text style={styles.emojiChar}>{e}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.profileColorLabel}>{t('profile.avatarColor')}</Text>
        <View style={styles.colorRow}>
          {AVATAR_COLORS.map((c) => (
            <Pressable
              key={c}
              onPress={() => { selectionTick(); setProfileColor(c); }}
              accessibilityRole="button"
              accessibilityState={{ selected: profileColor === c }}
              style={[
                styles.colorSwatch,
                { backgroundColor: c },
                profileColor === c && { borderColor: '#fff' },
              ]}
            >
              {profileColor === c && (
                <Ionicons name="checkmark" size={18} color="#fff" />
              )}
            </Pressable>
          ))}
        </View>
        <Text style={styles.overlayHint}>{t('profile.syncHint')}</Text>
      </ScrollView>
    </OverlaySheet>
  );
}
