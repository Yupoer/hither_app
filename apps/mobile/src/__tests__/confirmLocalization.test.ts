/**
 * Confirm defaults must resolve from the active catalog (no English Cancel on zh).
 */
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Alert: { alert: jest.fn() },
}));

import { Alert } from 'react-native';
import { setActiveLanguage } from '../i18n';
import { confirmAction } from '../utils/confirm';

describe('confirmAction localization', () => {
  const alertMock = Alert.alert as jest.Mock;

  beforeEach(() => {
    alertMock.mockClear();
  });

  it('uses zh 確認/取消 when callers omit labels', () => {
    setActiveLanguage('zh');
    confirmAction({ title: '刪除紀錄' }, () => undefined);
    expect(alertMock).toHaveBeenCalled();
    const buttons = alertMock.mock.calls[0][2] as Array<{ text: string; style?: string }>;
    expect(buttons.find((b) => b.style === 'cancel')?.text).toBe('取消');
    expect(buttons.find((b) => b.style !== 'cancel')?.text).toBe('確認');
  });

  it('uses en Confirm/Cancel when language is en', () => {
    setActiveLanguage('en');
    confirmAction({ title: 'Delete history' }, () => undefined);
    const buttons = alertMock.mock.calls[0][2] as Array<{ text: string; style?: string }>;
    expect(buttons.find((b) => b.style === 'cancel')?.text).toBe('Cancel');
    expect(buttons.find((b) => b.style !== 'cancel')?.text).toBe('Confirm');
  });

  it('prefers explicit labels when provided', () => {
    setActiveLanguage('zh');
    confirmAction(
      { title: 'x', confirmLabel: '刪除', cancelLabel: '再想想' },
      () => undefined,
    );
    const buttons = alertMock.mock.calls[0][2] as Array<{ text: string; style?: string }>;
    expect(buttons.find((b) => b.style === 'cancel')?.text).toBe('再想想');
    expect(buttons.find((b) => b.style !== 'cancel')?.text).toBe('刪除');
  });
});
