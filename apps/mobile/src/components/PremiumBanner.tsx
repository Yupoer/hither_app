import { APP_TEXT_SIZE, APP_TEXT_LINE_HEIGHT } from '../theme/typeScale';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText as Text } from './AppText';
import Pressable from './MotionPressable';
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
  title: { fontSize: APP_TEXT_SIZE.body, lineHeight: APP_TEXT_LINE_HEIGHT.body, fontWeight: '800', color: '#FFFFFF' },
  hint: { fontSize: APP_TEXT_SIZE.caption, lineHeight: APP_TEXT_LINE_HEIGHT.caption, color: 'rgba(255,255,255,0.8)' },
  arrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  arrowText: { color: '#fff', fontSize: APP_TEXT_SIZE.caption, fontWeight: '800' },
});
