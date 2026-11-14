import { APP_TEXT_SIZE } from '../../../theme/typeScale';
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { AppText as Text } from '../../../components/AppText';

export function MemberInboxBadge({ count, style, testID, accessibilityLabel }: {
  count: number;
  style: StyleProp<ViewStyle>;
  testID: string;
  accessibilityLabel?: string;
}) {
  return (
    <View
      pointerEvents="none"
      accessible={accessibilityLabel !== undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={accessibilityLabel === undefined}
      importantForAccessibility={accessibilityLabel === undefined ? 'no-hide-descendants' : 'yes'}
      style={[styles.badge, style]}
      testID={testID}
    >
      <Text allowFontScaling={false} style={styles.count}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    minWidth: 18,
    height: 18,
    paddingHorizontal: 3,
    borderRadius: 9,
    backgroundColor: '#B8293D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: { fontSize: APP_TEXT_SIZE.caption, fontWeight: '700', color: '#fff' },
});
