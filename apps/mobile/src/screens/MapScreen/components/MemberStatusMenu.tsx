import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { NativeMenuHost, type NativeMenuItem } from '../../../native/menu';

export type MemberStatusMenuProps = {
  items: NativeMenuItem[];
  onSelect: (id: string) => void;
  accessibilityLabel: string;
  label: string;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

export default function MemberStatusMenu({ items, onSelect, accessibilityLabel, style, children }: MemberStatusMenuProps) {
  return <NativeMenuHost {...{ items, onSelect, accessibilityLabel, style }} testID="map-presence">{children}</NativeMenuHost>;
}
