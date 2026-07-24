import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { createGroup, joinGroup } from '../api/client';
import { useSession } from '../state/SessionContext';
import { useTheme } from '../state/PreferencesContext';
import { useTranslation } from '../i18n';
import { accentMix, glass } from '../glass';
import { logEvent, logError } from '../utils/activityLog';
import { runUiAction, type UiActionToken } from '../utils/uiAction';
import SafePressable from '../components/SafePressable';
import { mediumTap } from '../utils/haptics';

type Props = NativeStackScreenProps<RootStackParamList, 'Auth'>;

const CODE_LEN = 6;
const DISPLAY_FONT = 'Fredoka_600SemiBold';

/**
 * Nickname (+ group code for followers) entry. From here the leader creates a
 * group and the follower joins one by code, then both drop straight onto the
 * map — the old separate "Group lobby" screen is gone (design: no lobby).
 *
 * Anonymous Supabase sign-in happens lazily on the first submit; a restored
 * session skips it and just reuses / renames the existing anon user.
 */
export default function AuthScreen({ navigation, route }: Props) {
  const role = route.params?.role ?? 'leader';
  const isLeader = role === 'leader';
  const { signIn, user, updateNickname, setMembership } = useSession();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const accent = colors.accent;
  const styles = useMemo(() => makeStyles(accent), [accent]);

  const [name, setName] = useState(user?.name ?? '');
  const [groupName, setGroupName] = useState('');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState(false);
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<TextInput>(null);
  const groupNameRef = useRef<TextInput>(null);

  const codeReady = isLeader ? groupName.trim().length >= 1 : code.length === CODE_LEN;
  const canSubmit = name.trim().length >= 1 && codeReady && !busy;

  // The group's name is asked separately from the nickname: unlike a
  // nickname (editable later), the group name is set once at creation, so
  // defaulting it to the nickname would permanently weld the two.
  function handleAuthError(e: unknown) {
    logError(isLeader ? 'group_create_failed' : 'group_join_failed', e);
    // Design: a rejected code highlights the code boxes.
    if (!isLeader) setCodeError(true);
    const msg = e instanceof Error ? e.message : t('auth.signInFailed');
    Alert.alert(
      isLeader ? t('group.createFailedTitle') : t('group.joinFailedTitle'),
      msg,
    );
  }

  /** Body for SafePressable — runner supplies token + busy/timeout contract. */
  async function submitAuth(token: UiActionToken) {
    if (!canSubmit && !busy) return;
    const nickname = name.trim();
    try {
      // Ensure we have an anonymous user, then keep the nickname current.
      if (!user) {
        await signIn({ name: nickname });
        if (!token.isCurrent()) return;
      } else if (nickname !== user.name) {
        await updateNickname(nickname);
        if (!token.isCurrent()) return;
      }
      mediumTap();
      const group = isLeader
        ? await createGroup(groupName.trim())
        : await joinGroup(code.trim());
      // Late results must not update membership or navigation.
      if (!token.isCurrent()) return;
      logEvent(isLeader ? 'group_create' : 'group_join');
      setMembership({ group, role });
      navigation.replace('Map', { groupId: group.id });
    } catch (e) {
      // Local Alert for auth UX; rethrow so runUiAction records ui_action_error.
      if (token.isCurrent()) handleAuthError(e);
      throw e;
    }
  }

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <LinearGradient
        colors={['#1f3050', '#0e1622', '#080b12']}
        locations={[0, 0.52, 1]}
        style={styles.fill}
      >
        <View
          style={[
            styles.content,
            { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 28 },
          ]}
        >
            {/* Only render Back when there is somewhere to go — after an
                end-group/sign-out reset this screen can be the stack root, and an
                unconditional goBack() throws "GO_BACK was not handled". */}
            {navigation.canGoBack() && (
              <Pressable
                onPress={() => navigation.goBack()}
                accessibilityRole="button"
                accessibilityLabel="Back"
                style={styles.back}
              >
                <Ionicons name="chevron-back" size={22} color="rgba(255,255,255,0.7)" />
              </Pressable>
            )}

            <Text style={styles.kicker}>
              {isLeader ? t('auth.leaderKicker') : t('auth.followerKicker')}
            </Text>
            <Text style={styles.title}>
              {isLeader ? t('auth.leaderTitle') : t('auth.followerTitle')}
            </Text>
            <Text style={styles.sub}>
              {isLeader ? t('auth.leaderSub') : t('auth.followerSub')}
            </Text>

            <Text style={styles.label}>{t('auth.nameLabel')}</Text>
            <View style={styles.field}>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder={t('auth.namePlaceholder')}
                placeholderTextColor="rgba(235,235,245,0.4)"
                keyboardAppearance="dark"
                autoCapitalize="none"
                autoFocus
                returnKeyType="next"
                onSubmitEditing={() =>
                  isLeader ? groupNameRef.current?.focus() : codeRef.current?.focus()
                }
                accessibilityLabel={t('auth.nameLabel')}
              />
            </View>

            {isLeader && (
              <>
                <Text style={styles.label}>{t('group.nameLabel')}</Text>
                <View style={styles.field}>
                  <TextInput
                    ref={groupNameRef}
                    style={styles.input}
                    value={groupName}
                    onChangeText={setGroupName}
                    placeholder={t('group.namePlaceholder')}
                    placeholderTextColor="rgba(235,235,245,0.4)"
                    keyboardAppearance="dark"
                    autoCapitalize="none"
                    returnKeyType="go"
                    onSubmitEditing={() => {
                      if (!canSubmit) return;
                      void runUiAction(
                        isLeader ? 'auth.create_group' : 'auth.join_group',
                        submitAuth,
                        {
                          screen: 'Auth',
                          suppressBanner: true,
                          onBusyChange: setBusy,
                          onError: (kind) => {
                            if (kind === 'timeout') {
                              Alert.alert(t('group.createFailedTitle'), t('interaction.timeout'));
                            }
                          },
                        },
                      );
                    }}
                    accessibilityLabel={t('group.nameLabel')}
                  />
                </View>
              </>
            )}

            {!isLeader && (
              <>
                <Text style={styles.label}>{t('group.codeLabel')}</Text>
                {/* Design: six character boxes (WND-482) fed by one hidden
                    input; a rejected code highlights the boxes. */}
                <Pressable
                  style={styles.codeBoxes}
                  onPress={() => codeRef.current?.focus()}
                  accessibilityLabel={t('group.codeLabel')}
                >
                  {Array.from({ length: CODE_LEN }, (_, i) => (
                    <React.Fragment key={i}>
                      {i === CODE_LEN / 2 && <Text style={styles.codeDash}>-</Text>}
                      <View
                        style={[
                          styles.codeCell,
                          i === code.length && styles.codeCellActive,
                          codeError && styles.codeCellError,
                        ]}
                      >
                        <Text style={styles.codeChar}>{code[i] ?? ''}</Text>
                      </View>
                    </React.Fragment>
                  ))}
                  <TextInput
                    ref={codeRef}
                    style={styles.codeHidden}
                    value={code}
                    onChangeText={(v) => {
                      setCodeError(false);
                      setCode(
                        v.replace(/[^0-9a-z]/gi, '').toUpperCase().slice(0, CODE_LEN),
                      );
                    }}
                    keyboardAppearance="dark"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    returnKeyType="go"
                    onSubmitEditing={() => {
                      if (!canSubmit) return;
                      void runUiAction(
                        isLeader ? 'auth.create_group' : 'auth.join_group',
                        submitAuth,
                        {
                          screen: 'Auth',
                          suppressBanner: true,
                          onBusyChange: setBusy,
                          onError: (kind) => {
                            if (kind === 'timeout') {
                              Alert.alert(t('group.joinFailedTitle'), t('interaction.timeout'));
                            }
                          },
                        },
                      );
                    }}
                  />
                </Pressable>
              </>
            )}

            <View style={styles.spacer} />

            <SafePressable
              actionId={isLeader ? 'auth.create_group' : 'auth.join_group'}
              screen="Auth"
              onPressAction={submitAuth}
              onBusyChange={setBusy}
              suppressBanner
              onActionError={(kind) => {
                if (kind === 'timeout') {
                  Alert.alert(
                    isLeader ? t('group.createFailedTitle') : t('group.joinFailedTitle'),
                    t('interaction.timeout'),
                  );
                }
              }}
              disabled={!canSubmit}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.cta,
                !canSubmit && styles.ctaDisabled,
                pressed && canSubmit && styles.pressed,
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Text style={styles.ctaText}>
                    {isLeader ? t('auth.leaderCta') : t('auth.followerCta')}
                  </Text>
                  <Ionicons name="arrow-forward" size={18} color="#fff" />
                </>
              )}
            </SafePressable>

            <Text style={styles.footer}>
              {isLeader ? t('auth.leaderFoot') : t('auth.followerFoot')}
            </Text>
          </View>
      </LinearGradient>
    </TouchableWithoutFeedback>
  );
}

const makeStyles = (accent: string) =>
  StyleSheet.create({
    fill: { flex: 1 },
    content: { flex: 1, paddingHorizontal: 24 },
    back: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.08)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.18)',
    },
    kicker: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      color: accent,
      marginTop: 26,
    },
    title: { fontSize: 34, fontWeight: '700', color: '#fff', marginTop: 6 },
    sub: {
      fontSize: 15,
      lineHeight: 21,
      color: 'rgba(235,235,245,0.6)',
      marginTop: 8,
      maxWidth: 300,
    },
    label: {
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.6,
      color: 'rgba(235,235,245,0.45)',
      marginTop: 26,
      marginBottom: 8,
      marginLeft: 4,
    },
    field: {
      height: 58,
      borderRadius: 16,
      justifyContent: 'center',
      paddingHorizontal: 18,
      backgroundColor: 'rgba(255,255,255,0.08)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.2)',
    },
    input: { fontSize: 19, color: '#fff' },
    codeBoxes: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    codeCell: {
      flex: 1,
      height: 58,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.08)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.2)',
    },
    codeCellActive: { borderColor: accent },
    codeCellError: { borderColor: glass.danger },
    codeChar: { fontFamily: DISPLAY_FONT, fontSize: 24, fontWeight: '700', color: '#fff' },
    codeDash: { fontSize: 22, fontWeight: '600', color: 'rgba(235,235,245,0.4)' },
    codeHidden: { position: 'absolute', width: 1, height: 1, opacity: 0 },
    spacer: { flex: 1, minHeight: 24 },
    cta: {
      height: 56,
      borderRadius: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: accent,
    },
    ctaDisabled: { opacity: 0.4 },
    pressed: { opacity: 0.85 },
    ctaText: { fontSize: 17, fontWeight: '600', color: '#fff' },
    footer: {
      textAlign: 'center',
      fontSize: 13,
      color: 'rgba(235,235,245,0.4)',
      marginTop: 14,
    },
  });
