import { Alert, Platform } from 'react-native';

/**
 * Cross-platform confirmation dialog.
 *
 * `Alert.alert` is iOS/Android only — it is a silent no-op under
 * react-native-web, which means any "are you sure?" gate built on it never
 * resolves on web (the confirm callback never fires). That broke destructive
 * actions like leaving a group in the web preview. This helper routes to the
 * browser's native `window.confirm` on web and to `Alert.alert` on devices, so
 * the same call works everywhere.
 */
export interface ConfirmOptions {
  title: string;
  message?: string;
  /** Label for the confirming button (native only; web uses OK/Cancel). */
  confirmLabel?: string;
  /** Label for the cancel button (native only). */
  cancelLabel?: string;
  /** Style the confirm button as destructive on iOS. */
  destructive?: boolean;
}

export function confirmAction(
  options: ConfirmOptions,
  onConfirm: () => void,
): void {
  const { title, message, confirmLabel = '確定', cancelLabel = '取消', destructive } =
    options;

  if (Platform.OS === 'web') {
    const text = message ? `${title}\n\n${message}` : title;
    // In a non-browser web context (SSR/tests) `window` may be absent; fall
    // back to proceeding rather than silently swallowing the action.
    const confirmed =
      typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(text)
        : true;
    if (confirmed) {
      onConfirm();
    }
    return;
  }

  Alert.alert(title, message, [
    { text: cancelLabel, style: 'cancel' },
    {
      text: confirmLabel,
      style: destructive ? 'destructive' : 'default',
      onPress: onConfirm,
    },
  ]);
}
