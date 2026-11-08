import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

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
  count: { fontSize: 11, fontWeight: '700', color: '#fff' },
});
