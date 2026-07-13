import React from 'react';
import { render } from '@testing-library/react-native';
import MapScreen from '../src/screens/MapScreen';
import { PreferencesProvider } from '../src/state/PreferencesContext';
import { SessionProvider } from '../src/state/SessionContext';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useRoute: () => ({ params: {} }),
}));
jest.mock('expo-font');
jest.mock('expo-asset');
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: function MockDateTimePicker() { return <></>; },
    DateTimePickerAndroid: { open: jest.fn(), dismiss: jest.fn() }
  };
});
jest.mock('expo-clipboard');
jest.mock('react-native-view-shot');
jest.mock('expo-status-bar');
jest.mock('expo-task-manager', () => ({
  isTaskDefined: () => false,
  defineTask: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  return {
    ...actual,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

describe('MapScreen profiling test', () => {
  it('mounts MapScreen', async () => {
    const route = { params: {}, key: '1', name: 'Map' } as any;
    const navigation = {} as any;
    const { toJSON } = await render(
      <PreferencesProvider>
        <SessionProvider>
          <MapScreen route={route} navigation={navigation} />
        </SessionProvider>
      </PreferencesProvider>,
    );
    expect(toJSON()).toBeTruthy();
  });
});
