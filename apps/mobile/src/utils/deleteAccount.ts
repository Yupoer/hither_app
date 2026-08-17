import { Alert } from 'react-native';
import { confirmAction } from './confirm';
import { runUiAction } from './uiAction';
import { logEvent } from './activityLog';
import type { Translator } from '../i18n';

export function confirmDeleteAccount({
  t,
  actionId,
  screen,
  deleteAccount,
  onDeleted,
}: {
  t: Translator['t'];
  actionId: string;
  screen: string;
  deleteAccount: () => Promise<void>;
  onDeleted: () => void;
}): void {
  confirmAction(
    {
      title: t('account.deleteTitle'),
      message: t('account.deleteMsg'),
      confirmLabel: t('account.deleteConfirm'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    },
    () => {
      void runUiAction(
        actionId,
        async (token) => {
          try {
            await deleteAccount();
            if (!token.isCurrent()) return;
            logEvent('account_deleted');
            onDeleted();
          } catch (error) {
            if (token.isCurrent()) {
              Alert.alert(t('account.deleteTitle'), t('account.deleteFailed'));
            }
            throw error;
          }
        },
        { screen },
      );
    },
  );
}
