import React, { useState } from 'react';
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
import OverlaySheet from './OverlaySheet';
import { useSession } from '../state/SessionContext';
import { redeemPromoCode } from '../api/client';
import { glass, accentMix } from '../glass';

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
  const { user, isPro, refreshProfile } = useSession();
  
  const [promoCode, setPromoCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);

  // Compute registered days
  const registeredDays = user?.createdAt
    ? Math.max(0, Math.floor((Date.now() - new Date(user.createdAt).getTime()) / 86400000))
    : 0;

  let providerText = 'Email 註冊';
  if (user?.provider === 'google') providerText = 'Google 註冊';
  if (user?.provider === 'anonymous') providerText = '匿名帳號';

  async function handleRedeem() {
    const code = promoCode.trim();
    if (!code) return;
    setRedeeming(true);
    try {
      const result = await redeemPromoCode(code);
      await refreshProfile();
      Alert.alert('升級成功', `您已成功開通：${result.plan_name}`);
      setPromoCode('');
    } catch (e: any) {
      Alert.alert('兌換失敗', e.message);
    } finally {
      setRedeeming(false);
    }
  }

  return (
    <OverlaySheet
      visible={visible}
      onClose={onClose}
      title="帳號設定"
      accent={accent}
      doneLabel="完成"
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
          {/* Registration Info */}
          <Text style={styles.sectionLabel}>註冊資訊</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>註冊方式</Text>
              <Text style={styles.rowValue}>{providerText}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.row}>
              <Text style={styles.rowLabel}>已註冊天數</Text>
              <Text style={styles.rowValue}>{registeredDays} 天</Text>
            </View>
          </View>

          {/* Subscription Info */}
          <Text style={styles.sectionLabel}>訂閱狀態</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>目前方案</Text>
              <Text style={[styles.rowValue, isPro && { color: accent }]}>
                {isPro ? (user?.proPlan || 'Pro') : '免費版 (Free)'}
              </Text>
            </View>
            {isPro && user?.proPurchasedAt && (
              <>
                <View style={styles.divider} />
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>購買日期</Text>
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
                  <Text style={styles.rowLabel}>到期日期</Text>
                  <Text style={styles.rowValue}>
                    {new Date(user.proExpiresAt).toLocaleDateString()}
                  </Text>
                </View>
              </>
            )}
          </View>

          {/* Promo Code */}
          <Text style={styles.sectionLabel}>升級序號兌換</Text>
          <View style={styles.card}>
            <Text style={styles.promoHint}>
              如果您有升級序號，請在此輸入以兌換 Pro 權限。（註：匿名帳號無法升級）
            </Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                placeholder="請輸入序號"
                placeholderTextColor={glass.textTertiary}
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
                  <Text style={[styles.redeemText, { color: accent }]}>兌換</Text>
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
