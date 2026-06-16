import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Map'>;

/**
 * Live map of group members and the next destination (lantern / gathering
 * point concept from the design). Skeleton only — no map SDK yet.
 */
export default function MapScreen(_props: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>地圖</Text>
      <Text style={styles.subtitle}>成員位置與下一個目的地（skeleton）</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 28, fontWeight: '700' },
  subtitle: { fontSize: 16, color: '#666' },
});
