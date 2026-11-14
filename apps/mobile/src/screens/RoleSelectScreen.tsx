import React from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { TeamEntryScreen } from './MyTeamsScreen';

type Props = NativeStackScreenProps<RootStackParamList, 'RoleSelect'>;

export default function RoleSelectScreen({ route, navigation }: Props) {
  return <TeamEntryScreen origin="RoleSelect" params={route.params} navigation={navigation} />;
}
