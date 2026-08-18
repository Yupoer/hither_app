/**
 * Attached native menu host. iOS is UIButton.menu + showsMenuAsPrimaryAction.
 * Android is an anchored PopupMenu. Missing in Expo Go — callers must leave
 * the trigger visible and must not fall back to ActionSheet / Alert / JS popup.
 */
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';

export type NativeMenuItem = {
  id: string;
  title: string;
};

const HitherMenu = requireOptionalNativeModule('HitherMenu');

let NativeMenuView: React.ComponentType<{
  items: NativeMenuItem[];
  onSelect?: (event: { nativeEvent?: { id?: string } }) => void;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}> | null = null;

if (HitherMenu) {
  try {
    NativeMenuView = requireNativeViewManager('HitherMenu');
  } catch {
    NativeMenuView = null;
  }
}

export function isNativeMenuAvailable(): boolean {
  return NativeMenuView != null;
}

export function NativeMenuHost({
  items,
  onSelect,
  style,
  children,
  accessibilityLabel,
}: {
  items: NativeMenuItem[];
  onSelect: (id: string) => void;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  accessibilityLabel?: string;
}): React.ReactElement {
  if (!NativeMenuView) {
    return React.createElement(
      View,
      {
        style,
        accessibilityRole: 'button',
        accessibilityLabel,
        accessibilityState: { disabled: true },
      },
      children,
    );
  }
  return React.createElement(
    NativeMenuView,
    {
      items,
      onSelect: (event: { nativeEvent?: { id?: string } }) => {
        const id = event?.nativeEvent?.id;
        if (id) onSelect(id);
      },
      style,
    },
    children,
  );
}
