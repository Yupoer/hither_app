import React from 'react';
import { act, create } from 'react-test-renderer';
import { TextInput } from 'react-native';
import OverlaySheet from '../components/OverlaySheet';
import { ProfileOverlay } from '../screens/MapScreen/components/ProfileOverlay';

const mockUser = { current: { id: 'u1', name: 'Ada', avatar: 'fox', avatarColor: '#111' } };
jest.mock('react-native', () => ({
  ScrollView: 'ScrollView', View: 'View', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable',
  Alert: { alert: jest.fn() }, StyleSheet: { create: (s: unknown) => s },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('../components/WaveLoading', () => 'WaveLoading');
jest.mock('../components/HitherText', () => ({ HitherText: 'HitherText' }));
jest.mock('../components/OverlaySheet', () => 'OverlaySheet');
jest.mock('../state/SessionContext', () => ({ useSession: () => ({ user: mockUser.current, updateProfile: jest.fn() }) }));
jest.mock('../state/PreferencesContext', () => ({ useTheme: () => ({ colors: { accent: '#fff' } }) }));
jest.mock('../i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../utils/haptics', () => ({ selectionTick: jest.fn() }));
jest.mock('../utils/activityLog', () => ({ logEvent: jest.fn(), logError: jest.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('resets on user object identity while retaining the profile sheet and field owners', async () => {
  const props = { visible: true, onClose: jest.fn(), refresh: jest.fn(), styles: {} };
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(ProfileOverlay, props)); });
  const input = () => tree.root.findByType(TextInput);
  const sheet = tree.root.findByType(OverlaySheet);
  expect(input().props.value).toBe('Ada');
  await act(async () => input().props.onChangeText('draft'));
  await act(async () => tree.update(React.createElement(ProfileOverlay, { ...props })));
  expect(input().props.value).toBe('draft');
  mockUser.current = { ...mockUser.current };
  await act(async () => tree.update(React.createElement(ProfileOverlay, { ...props })));
  expect(input().props.value).toBe('Ada');
  expect(tree.root.findByType(OverlaySheet)).toBe(sheet);
  await act(async () => input().props.onChangeText('hidden draft'));
  await act(async () => tree.update(React.createElement(ProfileOverlay, { ...props, visible: false })));
  expect(input().props.value).toBe('hidden draft');
  await act(async () => tree.update(React.createElement(ProfileOverlay, props)));
  expect(input().props.value).toBe('Ada');
  await act(async () => tree.unmount());
});
