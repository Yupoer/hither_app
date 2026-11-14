import { AppState, Settings } from 'react-native';
import { readSystemLanguage, subscribeSystemLanguage } from '../state/systemLanguage.ios';

const mockLanguages: { value: unknown } = { value: ['en-US'] };
const mockChange = new Set<() => void>();
const mockApplication = new Set<(state: string) => void>();
jest.mock('react-native', () => ({
  Settings: {
    get: () => mockLanguages.value,
    watchKeys: jest.fn((_key: string, callback: () => void) => { mockChange.add(callback); return 3; }),
    clearWatch: jest.fn(() => mockChange.clear()),
  },
  AppState: {
    addEventListener: jest.fn((_event: string, callback: (state: string) => void) => {
      mockApplication.add(callback);
      return { remove: () => mockApplication.delete(callback) };
    }),
  },
}));

describe('system language on iOS', () => {
  it('honors the first supported preferred language and accepts regional language tags', () => {
    mockLanguages.value = ['ja-JP', 'zh-Hant-TW', 'en-US'];
    expect(readSystemLanguage()).toBe('zh');
    mockLanguages.value = ['en-GB', 'zh-Hant'];
    expect(readSystemLanguage()).toBe('en');
  });

  it('rechecks language on Settings change or returning to the app and removes its subscriptions', () => {
    const onChange = jest.fn();
    const unsubscribe = subscribeSystemLanguage(onChange);
    expect(Settings.watchKeys).toHaveBeenCalledWith('AppleLanguages', expect.any(Function));
    expect(AppState.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    mockLanguages.value = ['zh-Hant'];
    mockChange.forEach(callback => callback());
    expect(onChange).toHaveBeenLastCalledWith('zh');
    mockLanguages.value = ['en-US'];
    mockApplication.forEach(callback => callback('background'));
    expect(onChange).toHaveBeenCalledTimes(1);
    mockApplication.forEach(callback => callback('active'));
    expect(onChange).toHaveBeenLastCalledWith('en');
    unsubscribe();
    expect(mockChange.size).toBe(0);
    expect(mockApplication.size).toBe(0);
  });
});
