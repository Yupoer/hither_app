import React, { useState, useEffect, useCallback } from 'react';
import { ScrollView, View, Text, TextInput, Pressable, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import OverlaySheet from '../../../components/OverlaySheet';
import { HitherText } from '../../../components/HitherText';
import { AVATAR_EMOJI, AVATAR_COLORS } from '../../../constants/avatars';
import { useSession } from '../../../state/SessionContext';
import { useTheme } from '../../../state/PreferencesContext';
import { useTranslation } from '../../../i18n';
import { glass, memberColor, accentMix } from '../../../glass';
import { selectionTick } from '../../../utils/haptics';
import { logEvent, logError } from '../../../utils/activityLog';
import {
  buildProfileSaveFields,
  canStartProfileSave,
  hasProfileSaveFields,
  nextProfileSavePhase,
  type ProfileSavePhase,
} from '../../../utils/profileSaveLifecycle';

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
  const [phase, setPhase] = useState<ProfileSavePhase>('draft');

  useEffect(() => {
    if (visible) {
      setProfileName(user?.name ?? '');
      setProfileAvatar(user?.avatar);
      setProfileColor(user?.avatarColor);
      setPhase('draft');
    }
  }, [visible, user]);

  /** Scrim / drag dismiss: discard draft without writing. Block while saving. */
  const handleCancel = useCallback(() => {
    if (phase === 'saving') return;
    onClose();
  }, [phase, onClose]);

  const handleSave = useCallback(async () => {
    if (!canStartProfileSave(phase)) return;

    const fields = buildProfileSaveFields(
      { name: profileName, avatar: profileAvatar, color: profileColor },
      {
        name: user?.name,
        avatar: user?.avatar,
        avatarColor: user?.avatarColor,
      },
    );

    if (!hasProfileSaveFields(fields)) {
      onClose();
      return;
    }

    setPhase((p) => nextProfileSavePhase('start', p));
    logEvent('profile_save', { changed: Object.keys(fields) });
    try {
      await updateProfile(fields);
      // Refresh group projection so teammate list converges on profiles SoT.
      try {
        refresh();
      } catch {
        // refresh is best-effort; own session already committed.
      }
      setPhase('success');
      onClose();
    } catch (e) {
      setPhase((p) => nextProfileSavePhase('error', p));
      logError('profile_save_failed', e);
      Alert.alert(
        t('profile.saveFailed'),
        e instanceof Error ? e.message : undefined,
      );
    }
  }, [phase, profileName, profileAvatar, profileColor, user, updateProfile, refresh, t, onClose]);

  const saving = phase === 'saving';

  return (
    <OverlaySheet
      visible={visible}
      onClose={handleCancel}
      onDone={handleSave}
      title={t('profile.title')}
      accent={accent}
      doneLabel={saving ? t('profile.saving') : t('map.done')}
      edgeToEdge
    >
      <ScrollView contentContainerStyle={styles.profileBody}>
        <View style={styles.profilePreviewRow}>
          <View
            style={[
              styles.profilePreviewAvatar,
              { backgroundColor: profileColor ?? memberColor(user?.id ?? '') },
            ]}
          >
            {profileAvatar ? (
              <HitherText typeRole="emoji" style={styles.profilePreviewEmoji}>{profileAvatar}</HitherText>
            ) : (
              <Text style={styles.profilePreviewInitial}>
                {(profileName || user?.name || '?').slice(0, 1).toUpperCase()}
              </Text>
            )}
          </View>
          {saving ? (
            <ActivityIndicator style={{ marginTop: 8 }} color={accent} />
          ) : null}
        </View>

        {/* Color sits under the preview so the swatches aren't buried under emoji. */}
        <Text style={styles.profileColorLabel}>{t('profile.avatarColor')}</Text>
        <View style={styles.colorRow}>
          {AVATAR_COLORS.map((c) => (
            <Pressable
              key={c}
              disabled={saving}
              onPress={() => { selectionTick(); setProfileColor(c); }}
              accessibilityRole="button"
              accessibilityState={{ selected: profileColor === c, disabled: saving }}
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

        <Text style={styles.profileNickLabel}>{t('settings.nickname')}</Text>
        <View style={styles.profileRow}>
          <TextInput
            style={styles.profileInput}
            value={profileName}
            onChangeText={setProfileName}
            editable={!saving}
            maxLength={24}
            placeholder={t('auth.namePlaceholder')}
            placeholderTextColor={glass.textTertiary}
            keyboardAppearance="dark"
            returnKeyType="done"
            onSubmitEditing={() => { void handleSave(); }}
          />
        </View>

        <Text style={styles.profileSectionLabel}>{t('profile.avatar')}</Text>
        <View style={styles.emojiGrid}>
          {AVATAR_EMOJI.map((e) => (
            <Pressable
              key={e}
              disabled={saving}
              onPress={() => setProfileAvatar(e)}
              accessibilityRole="button"
              accessibilityState={{ selected: profileAvatar === e, disabled: saving }}
              style={[
                styles.emojiCell,
                profileAvatar === e && {
                  borderColor: accent,
                  backgroundColor: accentMix(accent, 18),
                },
              ]}
            >
              <HitherText typeRole="emoji" style={styles.emojiChar}>{e}</HitherText>
            </Pressable>
          ))}
        </View>
        <Text style={styles.overlayHint}>{t('profile.syncHint')}</Text>
      </ScrollView>
    </OverlaySheet>
  );
}
