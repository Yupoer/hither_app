import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from '../i18n';
import { lightTap } from '../utils/haptics';

export default React.memo(function PremiumBanner({
  onPress,
  testID,
  showHint = true,
}: {
  onPress: () => void;
  testID?: string;
  showHint?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={() => {
        lightTap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={t('paywall.cta')}
      testID={testID}
      style={styles.banner}
    >
      <LinearGradient
        colors={['#183c66', '#296096']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.copy}>
        <Text style={styles.title}>{t('paywall.title')}</Text>
        {showHint ? <Text style={styles.hint}>{t('settings.subscribeBannerHint')}</Text> : null}
      </View>
      <View style={styles.arrow}>
        <Text style={styles.arrowText}>→</Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  banner: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(55,182,255,0.3)',
    padding: 14,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 108,
  },
  copy: { flex: 1, gap: 5, justifyContent: 'center' },
  title: { fontSize: 17, lineHeight: 21, fontWeight: '800', color: '#FFFFFF' },
  hint: { fontSize: 13, lineHeight: 18, color: 'rgba(255,255,255,0.8)' },
  arrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  arrowText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
