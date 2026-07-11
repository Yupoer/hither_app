import React from 'react';
import { render } from '@testing-library/react-native';
import MapScreen from '../src/screens/MapScreen';

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

describe('MapScreen profiling test', () => {
  it('mounts MapScreen', () => {
    const route = { params: {}, key: '1', name: 'Map' } as any;
    const navigation = {} as any;
    const { toJSON } = render(<MapScreen route={route} navigation={navigation} />);
    expect(toJSON()).toBeTruthy();
  });
});
