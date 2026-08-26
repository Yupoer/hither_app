const mockConfirmAction = jest.fn();
const mockRunUiAction = jest.fn();
const mockLogEvent = jest.fn();
const mockAlert = jest.fn();

jest.mock('../utils/confirm', () => ({
  confirmAction: (...args: unknown[]) => mockConfirmAction(...args),
}));
jest.mock('../utils/uiAction', () => ({
  runUiAction: (...args: unknown[]) => mockRunUiAction(...args),
}));
jest.mock('../utils/activityLog', () => ({
  logEvent: (...args: unknown[]) => mockLogEvent(...args),
}));
jest.mock('react-native', () => ({
  Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
  Platform: { OS: 'ios' },
}));

import { confirmDeleteAccount } from '../utils/deleteAccount';
import { translate } from '../i18n';

describe('confirmDeleteAccount', () => {
  const t = (key: Parameters<typeof translate>[1]) => translate('en', key);

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfirmAction.mockImplementation((_opts, onConfirm) => {
      onConfirm();
    });
    mockRunUiAction.mockImplementation(async (_id, body, options) => {
      options?.onBusyChange?.(true);
      try {
        await body({ isCurrent: () => true });
      } catch {
        // production runUiAction records ui_action_error and does not rethrow
      } finally {
        options?.onBusyChange?.(false);
      }
    });
  });

  it('asks once then runs the high-risk action and resets on success', async () => {
    const deleteAccount = jest.fn().mockResolvedValue(undefined);
    const onDeleted = jest.fn();
    const onBusyChange = jest.fn();

    confirmDeleteAccount({
      t,
      actionId: 'account.delete',
      screen: 'Account',
      deleteAccount,
      onDeleted,
      onBusyChange,
    });

    expect(mockConfirmAction).toHaveBeenCalledWith(
      expect.objectContaining({
        title: t('account.deleteTitle'),
        message: t('account.deleteMsg'),
        confirmLabel: t('account.deleteConfirm'),
        destructive: true,
      }),
      expect.any(Function),
    );

    await mockRunUiAction.mock.results[0]?.value;

    expect(mockRunUiAction).toHaveBeenCalledWith(
      'account.delete',
      expect.any(Function),
      expect.objectContaining({ screen: 'Account' }),
    );
    expect(deleteAccount).toHaveBeenCalled();
    expect(mockLogEvent).toHaveBeenCalledWith('account_deleted');
    expect(onDeleted).toHaveBeenCalled();
    expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('surfaces account.deleteFailed and keeps the session when RPC throws', async () => {
    const deleteAccount = jest.fn().mockRejectedValue(new Error('rpc failed'));
    const onDeleted = jest.fn();

    confirmDeleteAccount({
      t,
      actionId: 'role_select.delete_account',
      screen: 'RoleSelect',
      deleteAccount,
      onDeleted,
    });

    await mockRunUiAction.mock.results[0]?.value;

    expect(onDeleted).not.toHaveBeenCalled();
    expect(mockAlert).toHaveBeenCalledWith(t('account.deleteTitle'), t('account.deleteFailed'));
  });
});
