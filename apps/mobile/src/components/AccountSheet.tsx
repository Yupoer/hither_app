import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import OverlaySheet from './OverlaySheet';
import { useSession } from '../state/SessionContext';
import { redeemPromoCode } from '../api/client';
import { glass, accentMix } from '../glass';
import { useTranslation, type TranslationKey } from '../i18n';
import { runUiAction } from '../utils/uiAction';
import { isAnonymousAccessExpired } from '../anonymousAccess';

export default function AccountSheet({
  visible,
  onClose,
  accent,
}: {
  visible: boolean;
  onClose: () => void;
  accent: string;
}) {
  const insets = useSafeAreaInsets();
  const {
    user,
    isPro,
    isAnonymous,
    membership,
    tripEntitlement,
    refreshProfile,
    refreshEntitlement,
    upgradeToEmailAccount,
    linkWithGoogle,
    linkWithApple,
  } = useSession();
  const { t } = useTranslation();

  const premiumExpiresAt = tripEntitlement?.expiresAt ?? null;
  const premiumSourceRaw = tripEntitlement?.source ?? null;
  const premiumSourceLabel = (() => {
    if (!premiumSourceRaw) return null;
    const key = `account.premiumSource.${premiumSourceRaw}` as TranslationKey;
    const mapped = t(key);
    return mapped && mapped !== key ? mapped : premiumSourceRaw;
  })();
  const premiumRemainingLabel = (() => {
    if (!isPro) return null;
    if (!premiumExpiresAt) return t('account.premiumLifetime');
    const ms = Date.parse(premiumExpiresAt) - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) return t('account.premiumExpired');
    const hours = Math.ceil(ms / 3_600_000);
    if (hours < 48) return t('account.premiumRemainingHours', { hours });
    const days = Math.ceil(hours / 24);
    return t('account.premiumRemainingDays', { days });
  })();
  
  const [promoCode, setPromoCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [upgradeEmail, setUpgradeEmail] = useState('');
  const [upgradePassword, setUpgradePassword] = useState('');
  const [upgradeBusy, setUpgradeBusy] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    void AppleAuthentication.isAvailableAsync().then(setAppleAvailable);
  }, []);

  // Re-hydrate anonymous_expires_at when the sheet opens so the date is shown
  // after the first join (server stamps on membership insert).
  useEffect(() => {
    if (visible && isAnonymous) {
      void refreshProfile().catch(() => undefined);
    }
  }, [visible, isAnonymous, refreshProfile]);

  // Compute registered days
  const registeredDays = user?.createdAt
    ? Math.max(0, Math.floor((Date.now() - new Date(user.createdAt).getTime()) / 86400000))
    : 0;

  let providerText = t('account.providerEmail');
  if (user?.provider === 'google') providerText = t('account.providerGoogle');
  if (user?.provider === 'anonymous') providerText = t('account.providerAnonymous');
  if (user?.provider === 'apple') providerText = t('account.providerApple');

  function redeemErrorMessage(code: string): string {
    switch (code) {
      case 'already_used':
        return t('paywall.redeem.alreadyUsed');
      case 'expired':
        return t('paywall.redeem.expired');
      case 'invalid':
        return t('paywall.redeem.invalid');
      case 'not_applicable':
        return t('paywall.redeem.notApplicable');
      case 'duplicate':
        return t('paywall.redeem.duplicate');
      case 'not_authenticated':
        return t('paywall.redeem.notAuthenticated');
      default:
        return t('paywall.redeem.failed');
    }
  }

  async function handleRedeem() {
    const code = promoCode.trim();
    if (!code) return;
    await runUiAction(
      'account.redeem',
      async (token) => {
        try {
          // Same server entitlement model — no separate Early Access state.
          const result = await redeemPromoCode(code, membership?.group.id ?? null);
          if (!token.isCurrent()) return;
          await refreshProfile();
          if (!token.isCurrent()) return;
          await refreshEntitlement(membership?.group.id);
          if (!token.isCurrent()) return;
          Alert.alert(t('paywall.redeem.successTitle'), t('paywall.redeem.successBody', { plan: result.plan_name }));
          setPromoCode('');
        } catch (e: unknown) {
          if (token.isCurrent()) {
            const codeKey =
              e && typeof e === 'object' && 'code' in e && typeof (e as { code?: string }).code === 'string'
                ? (e as { code: string }).code
                : e instanceof Error
                  ? e.message
                  : 'unknown';
            Alert.alert(t('paywall.redeem.failedTitle'), redeemErrorMessage(codeKey));
          }
          throw e;
        }
      },
      {
        screen: 'Account',
        suppressBanner: true,
        onBusyChange: setRedeeming,
        onError: (kind) => {
          if (kind === 'timeout') {
            Alert.alert(t('paywall.redeem.failedTitle'), t('interaction.timeout'));
          }
        },
      },
    );
  }

  async function handleUpgrade() {
    if (!/\S+@\S+\.\S+/.test(upgradeEmail.trim()) || upgradePassword.length < 6 || upgradeBusy) return;
    await runUiAction(
      'account.upgrade_email',
      async (token) => {
        try {
          await upgradeToEmailAccount(upgradeEmail.trim(), upgradePassword);
          if (!token.isCurrent()) return;
          Alert.alert(t('account.section'), t('account.upgradeSent'));
          setUpgradeEmail('');
          setUpgradePassword('');
        } catch (e) {
          if (token.isCurrent()) {
            Alert.alert(
              t('account.section'),
              e instanceof Error ? e.message : t('account.upgradeSent'),
            );
          }
          throw e;
        }
      },
      {
        screen: 'Account',
        suppressBanner: true,
        onBusyChange: setUpgradeBusy,
        onError: (kind) => {
          if (kind === 'timeout') {
            Alert.alert(t('account.section'), t('interaction.timeout'));
          }
        },
      },
    );
  }

  async function handleLink(provider: 'google' | 'apple') {
    if (upgradeBusy) return;
    await runUiAction(
      provider === 'google' ? 'account.link_google' : 'account.link_apple',
      async (token) => {
        try {
          const linked = provider === 'google' ? await linkWithGoogle() : await linkWithApple();
          if (!token.isCurrent()) return;
          if (linked) {
            Alert.alert(
              t('account.section'),
              provider === 'google' ? t('login.google') : t('login.apple'),
            );
          }
        } catch (e) {
          if (token.isCurrent()) {
            Alert.alert(
              provider === 'google' ? t('login.google') : t('login.apple'),
              e instanceof Error ? e.message : t('login.signInFailed'),
            );
          }
          throw e;
        }
      },
      {
        screen: 'Account',
        suppressBanner: true,
        onBusyChange: setUpgradeBusy,
        onError: (kind) => {
          if (kind === 'timeout') {
            Alert.alert(
              provider === 'google' ? t('login.google') : t('login.apple'),
              t('interaction.timeout'),
            );
          }
        },
      },
    );
  }

  return (
    <OverlaySheet
      visible={visible}
      onClose={onClose}
      title={t('settings.account')}
      accent={accent}
      doneLabel={t('map.done')}
      edgeToEdge
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 20 }]}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.sectionLabel}>{t('account.premiumSection')}</Text>
          <View style={styles.card} testID="account-premium-status">
            <View style={styles.row}>
              <Text style={styles.rowLabel}>{t('account.premiumTeam')}</Text>
              <Text style={styles.rowValue} numberOfLines={1}>
                {membership?.group.name ?? t('account.premiumNoTeam')}
              </Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.row}>
              <Text style={styles.rowLabel}>{t('account.premiumStatus')}</Text>
              <Text style={styles.rowValue}>
                {isPro ? t('account.premiumActive') : t('account.premiumFree')}
              </Text>
            </View>
            {isPro && premiumSourceLabel ? (
              <>
                <View style={styles.divider} />
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>{t('account.premiumSource')}</Text>
                  <Text style={styles.rowValue}>{premiumSourceLabel}</Text>
                </View>
              </>
            ) : null}
            {isPro && premiumExpiresAt ? (
              <>
                <View style={styles.divider} />
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>{t('account.premiumExpires')}</Text>
                  <Text style={styles.rowValue}>
                    {new Date(premiumExpiresAt).toLocaleString()}
                  </Text>
                </View>
              </>
            ) : null}
            {premiumRemainingLabel ? (
              <>
                <View style={styles.divider} />
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>{t('account.premiumRemaining')}</Text>
                  <Text style={styles.rowValue}>{premiumRemainingLabel}</Text>
                </View>
              </>
            ) : null}
          </View>

          {/* Registration Info */}
          <Text style={styles.sectionLabel}>{t('account.regSection')}</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>{t('account.regMethod')}</Text>
              <Text style={styles.rowValue}>{providerText}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.row}>
              <Text style={styles.rowLabel}>{t('account.registeredEmail')}</Text>
              <Text style={styles.rowValue} numberOfLines={1}>
                {user?.email || t('account.unlinked')}
              </Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.row}>
              <Text style={styles.rowLabel}>{t('account.regDays')}</Text>
              <Text style={styles.rowValue}>{t('account.regDaysValue', { n: registeredDays })}</Text>
            </View>
          </View>

          {isAnonymous && (
            <>
              <Text style={styles.sectionLabel}>{t('account.upgradeButton')}</Text>
              <View style={styles.card}>
                <Text style={styles.promoHint}>
                  {user?.anonymousExpiresAt
                    ? isAnonymousAccessExpired(user.anonymousExpiresAt)
                      ? t('anon.expired')
                      : t('anon.expiryUntil', {
                          date: new Date(user.anonymousExpiresAt).toLocaleDateString(),
                        })
                    : t('anon.expiryWarning')}
                </Text>
                <View style={styles.socialRow}>
                  <Pressable
                    style={({ pressed }) => [styles.socialButton, pressed && styles.pressed, upgradeBusy && styles.disabledButton]}
                    onPress={() => void handleLink('google')}
                    disabled={upgradeBusy}
                    accessibilityRole="button"
                    accessibilityLabel={t('login.google')}
                  >
                    <Ionicons name="logo-google" size={20} color="#fff" />
                    <Text style={styles.socialText}>{t('login.google')}</Text>
                  </Pressable>
                  {appleAvailable ? (
                    <Pressable
                      style={({ pressed }) => [styles.socialButton, pressed && styles.pressed, upgradeBusy && styles.disabledButton]}
                      onPress={() => void handleLink('apple')}
                      disabled={upgradeBusy}
                      accessibilityRole="button"
                      accessibilityLabel={t('login.apple')}
                    >
                      <Ionicons name="logo-apple" size={20} color="#fff" />
                      <Text style={styles.socialText}>{t('login.apple')}</Text>
                    </Pressable>
                  ) : null}
                </View>
                <TextInput
                  style={styles.accountInput}
                  value={upgradeEmail}
                  onChangeText={setUpgradeEmail}
                  placeholder="you@example.com"
                  placeholderTextColor={glass.textTertiary}
                  keyboardAppearance="dark"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                />
                <TextInput
                  style={[styles.accountInput, styles.accountPasswordInput]}
                  value={upgradePassword}
                  onChangeText={setUpgradePassword}
                  placeholder={t('account.password')}
                  placeholderTextColor={glass.textTertiary}
                  keyboardAppearance="dark"
                  autoCapitalize="none"
                  secureTextEntry
                />
                <Pressable
                  style={({ pressed }) => [
                    styles.upgradeButton,
                    { backgroundColor: accentMix(accent, pressed ? 28 : 20) },
                    (!/\S+@\S+\.\S+/.test(upgradeEmail.trim()) || upgradePassword.length < 6 || upgradeBusy) && styles.disabledButton,
                  ]}
                  onPress={() => void handleUpgrade()}
                  disabled={!/\S+@\S+\.\S+/.test(upgradeEmail.trim()) || upgradePassword.length < 6 || upgradeBusy}
                  accessibilityRole="button"
                >
                  {upgradeBusy ? (
                    <ActivityIndicator color={accent} />
                  ) : (
                    <Text style={[styles.redeemText, { color: accent }]}>{t('account.submit')}</Text>
                  )}
                </Pressable>
              </View>
            </>
          )}

          {/* Subscription Info */}
          <Text style={styles.sectionLabel}>{t('account.subSection')}</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>{t('account.currentPlan')}</Text>
              <Text style={[styles.rowValue, isPro && { color: accent }]}>
                {isPro ? (user?.proPlan || 'Pro') : t('account.planFree')}
              </Text>
            </View>
            {isPro && user?.proPurchasedAt && (
              <>
                <View style={styles.divider} />
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>{t('account.purchasedAt')}</Text>
                  <Text style={styles.rowValue}>
                    {new Date(user.proPurchasedAt).toLocaleDateString()}
                  </Text>
                </View>
              </>
            )}
            {isPro && user?.proExpiresAt && (
              <>
                <View style={styles.divider} />
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>{t('account.expiresAt')}</Text>
                  <Text style={styles.rowValue}>
                    {new Date(user.proExpiresAt).toLocaleDateString()}
                  </Text>
                </View>
              </>
            )}
          </View>

          {/* Promo Code — same server entitlement model (no Early Access state) */}
          <Text style={styles.sectionLabel}>{t('account.redeemSection')}</Text>
          <View style={styles.card}>
            <Text style={styles.promoHint}>
              {t('account.redeemHint')}
            </Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                placeholder={t('account.redeemPlaceholder')}
                placeholderTextColor={glass.textTertiary}
                keyboardAppearance="dark"
                value={promoCode}
                onChangeText={setPromoCode}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <Pressable
                style={({ pressed }) => [
                  styles.redeemButton,
                  { backgroundColor: accentMix(accent, pressed ? 20 : 30) },
                ]}
                onPress={handleRedeem}
                disabled={redeeming || !promoCode.trim()}
              >
                {redeeming ? (
                  <ActivityIndicator color={accent} size="small" />
                ) : (
                  <Text style={[styles.redeemText, { color: accent }]}>{t('account.redeemCta')}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </OverlaySheet>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingTop: 12,
    paddingHorizontal: 16,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: glass.textSecondary,
    marginBottom: 8,
    marginTop: 20,
    marginLeft: 8,
  },
  card: {
    backgroundColor: glass.card,
    borderRadius: 16,
    padding: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  rowLabel: {
    fontSize: 16,
    color: '#fff',
  },
  rowValue: {
    fontSize: 16,
    color: glass.textSecondary,
    fontWeight: '500',
    flexShrink: 1,
    marginLeft: 12,
  },
  divider: {
    height: 1,
    backgroundColor: glass.hairlineStrong,
    marginVertical: 10,
  },
  promoHint: {
    fontSize: 14,
    color: glass.textSecondary,
    marginBottom: 16,
    lineHeight: 20,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    height: 44,
    backgroundColor: glass.fill,
    borderRadius: 10,
    paddingHorizontal: 12,
    color: '#fff',
    fontSize: 16,
    borderWidth: 1,
    borderColor: glass.hairlineStrong,
  },
  accountInput: {
    height: 44,
    backgroundColor: glass.fill,
    borderRadius: 10,
    paddingHorizontal: 12,
    color: '#fff',
    fontSize: 16,
    borderWidth: 1,
    borderColor: glass.hairlineStrong,
    marginBottom: 10,
  },
  accountPasswordInput: { marginBottom: 14 },
  upgradeButton: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledButton: { opacity: 0.4 },
  pressed: { opacity: 0.8 },
  socialRow: {
    gap: 10,
    marginBottom: 14,
  },
  socialButton: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: glass.fill,
    borderWidth: 1,
    borderColor: glass.hairlineStrong,
  },
  socialText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  redeemButton: {
    marginLeft: 12,
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  redeemText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
