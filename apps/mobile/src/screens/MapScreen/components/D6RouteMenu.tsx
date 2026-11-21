import React from 'react';
import SheetHeaderAction from '../../../components/SheetHeaderAction';

export type D6RouteMenuItem = {
  title: string;
  testID: string;
  onPress: () => void;
};

export type D6RouteMenuProps = {
  label: string;
  items: readonly D6RouteMenuItem[];
  onOpenFallback: () => void;
};

export default function D6RouteMenu({ label, onOpenFallback }: D6RouteMenuProps) {
  return <SheetHeaderAction action="more" accessibilityLabel={label} testID="d6-route-options" onPress={onOpenFallback} />;
}
