import React, { useCallback, useState } from 'react';
import {
  Pressable,
  type PressableProps,
  type GestureResponderEvent,
} from 'react-native';
import { runUiAction, type UiActionOptions, type UiActionToken } from '../utils/uiAction';

export type SafePressableProps = Omit<PressableProps, 'onPress' | 'disabled'> & {
  /** Stable id for single-flight + telemetry (e.g. `map.go_home`). */
  actionId: string;
  screen: string;
  /** Task receives the action token for await-boundary stale checks. */
  onPressAction?: (token: UiActionToken) => void | Promise<void>;
  timeoutMs?: number;
  onActionError?: UiActionOptions['onError'];
  /** When true, disable while the action is in flight. Default true. */
  disableWhileBusy?: boolean;
  disabled?: boolean | null;
  /** Forward busy to parent (e.g. CTA spinner). */
  onBusyChange?: (busy: boolean) => void;
  /** When true, skip global recovery banner (caller shows own UI). */
  suppressBanner?: boolean;
};

/**
 * Pressable that routes presses through `runUiAction` for double-tap safety,
 * timeout, error capture, and busy state. Alert / ActionSheet handlers should
 * call `runUiAction` directly instead of using this wrapper.
 */
export default function SafePressable({
  actionId,
  screen,
  onPressAction,
  timeoutMs,
  onActionError,
  disableWhileBusy = true,
  disabled,
  accessibilityState,
  onBusyChange,
  suppressBanner,
  ...rest
}: SafePressableProps) {
  const [busy, setBusy] = useState(false);

  const handlePress = useCallback(
    (_event: GestureResponderEvent) => {
      if (!onPressAction) return;
      void runUiAction(actionId, (token) => onPressAction(token), {
        screen,
        timeoutMs,
        suppressBanner,
        onBusyChange: (next) => {
          setBusy(next);
          onBusyChange?.(next);
        },
        onError: onActionError,
      });
    },
    [actionId, onActionError, onBusyChange, onPressAction, screen, suppressBanner, timeoutMs],
  );

  const isDisabled = Boolean(disabled) || (disableWhileBusy && busy);

  return (
    <Pressable
      {...rest}
      disabled={isDisabled}
      onPress={handlePress}
      accessibilityState={{
        ...accessibilityState,
        disabled: isDisabled,
        busy: busy || accessibilityState?.busy,
      }}
    />
  );
}
