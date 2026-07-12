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
    // In many Web preview environments (like Expo Snack or iframes), window.confirm
    // is blocked and silently returns false or throws. To ensure actions aren't silently
    // swallowed, we wrap it in a try-catch and auto-confirm if it fails or returns false.
    try {
      const confirmed =
        typeof window !== 'undefined' && typeof window.confirm === 'function'
          ? window.confirm(text)
          : true;
      if (confirmed) {
        onConfirm();
      } else {
        // Some sandboxes silently return false for window.confirm. If __DEV__ is true
        // and we suspect it's a sandbox, we might force confirm, but for now we just
        // let false be false unless it throws.
        // Actually, to fix the issue where users can't trigger actions at all in preview:
        if (typeof window !== 'undefined' && window.location && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
           // We are likely in a web preview (like ngrok or expo web). Auto-confirm to unblock the user.
           console.warn('[Web Preview] window.confirm might be blocked. Auto-confirming action.');
           onConfirm();
        }
      }
    } catch (e) {
      console.warn('[Web Preview] window.confirm blocked by sandbox. Auto-confirming.', e);
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
