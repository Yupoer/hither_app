import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Auth'>;

/**
 * Sign-in / sign-up entry point. Skeleton only — no auth logic yet.
 */
export default function AuthScreen(_props: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Hither</Text>
      <Text style={styles.subtitle}>登入 / 註冊（skeleton）</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 32, fontWeight: '700' },
  subtitle: { fontSize: 16, color: '#666' },
});
