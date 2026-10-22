import React, { useCallback, useRef } from 'react';
import { Pressable } from 'react-native';
import { rigidTap } from '../../../utils/haptics';

export function GatheringCardPressable({
  onToggle,
  accessibilityLabel,
  accessibilityHint,
  children,
}: {
  onToggle: () => void;
  accessibilityLabel: string;
  accessibilityHint: string;
  children: React.ReactNode;
}) {
  // Guard against double-fire (expand then instant collapse) from a single gesture.
  const lastPressAtRef = useRef(0);
  const handlePress = useCallback(() => {
    const now = Date.now();
    if (now - lastPressAtRef.current < 300) return;
    lastPressAtRef.current = now;
    rigidTap();
    onToggle();
  }, [onToggle]);

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      {children}
    </Pressable>
  );
}
