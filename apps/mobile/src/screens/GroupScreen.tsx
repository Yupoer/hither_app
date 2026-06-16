import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Group'>;

/**
 * Create or join a group, and view group members. Skeleton only.
 */
export default function GroupScreen(_props: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>群組</Text>
      <Text style={styles.subtitle}>建立 / 加入群組（skeleton）</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 28, fontWeight: '700' },
  subtitle: { fontSize: 16, color: '#666' },
});
