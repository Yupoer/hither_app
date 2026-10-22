import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { CustomQuickCommand } from '../types';
import CoordinateDestinationSheet from '../components/CoordinateDestinationSheet';
import CustomQuickCommandSheet from '../components/CustomQuickCommandSheet';
import FeedbackSheet from '../components/FeedbackSheet';

let mockCommands: CustomQuickCommand[] = [{ label: 'One', message: 'First' }, { label: 'Two', message: 'Second' }];
const mockSubmitFeedback = jest.fn();
jest.mock('react-native', () => ({
  Modal: 'Modal', View: 'View', Text: 'Text', TextInput: 'Input', Pressable: 'Button', ScrollView: 'Scroll',
  Alert: { alert: jest.fn() }, StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('../native', () => ({ liquidGlass: { GlassView: 'Glass' } }));
jest.mock('../state/PreferencesContext', () => ({ useTheme: () => ({ colors: { accent: '#ffcc00' } }) }));
jest.mock('../state/SessionContext', () => ({ useSession: () => ({ customQuickCommands: mockCommands, setCustomQuickCommand: jest.fn() }) }));
jest.mock('../i18n', () => ({ useTranslation: () => ({ t: (key: string) => key, language: 'en' }) }));
jest.mock('../components/OverlaySheet', () => 'Sheet');
jest.mock('../components/WaveLoading', () => 'Spinner');
jest.mock('../screens/MapScreen/components/SettingsChildSheet', () => 'SettingsSheet');
jest.mock('../api/feedback', () => ({ submitFeedback: (...args: unknown[]) => mockSubmitFeedback(...args) }));
jest.mock('../utils/activityLog', () => ({ logEvent: jest.fn(), logError: jest.fn() }));
jest.mock('../utils/uiAction', () => ({ runUiAction: (_name: string, task: (token: { isCurrent: () => boolean }) => Promise<void>) => task({ isCurrent: () => true }) }));

let view: ReactTestRenderer;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mockCommands = [{ label: 'One', message: 'First' }, { label: 'Two', message: 'Second' }];
  mockSubmitFeedback.mockResolvedValue(undefined);
});
afterEach(() => { act(() => view?.unmount()); jest.useRealTimers(); });

it('resets coordinates on Object.is identity changes while preserving native inputs and same-reference drafts', () => {
  const a = { latitude: 25, longitude: 121 };
  const base = { visible: true, initialCoordinates: a, onClose: jest.fn(), onSubmit: jest.fn() };
  const render = (props = base) => React.createElement(CoordinateDestinationSheet, props);
  act(() => { view = create(render()); });
  const nativeInput = view.root.findAllByType('Input' as never)[0];
  expect(view.root.findAllByType('Input' as never).map(node => node.props.value)).toEqual(['', '25', '121']);
  act(() => { nativeInput.props.onChangeText('draft'); });
  act(() => { view.update(render({ ...base, onClose: jest.fn() })); });
  expect(nativeInput.props.value).toBe('draft');
  act(() => { view.update(render({ ...base, initialCoordinates: { ...a } })); });
  expect(nativeInput.props.value).toBe('');
  expect(view.root.findAllByType('Input' as never)[0]).toBe(nativeInput);
  act(() => { nativeInput.props.onChangeText('B draft'); });
  act(() => { view.update(render()); });
  expect(nativeInput.props.value).toBe('');
  act(() => { nativeInput.props.onChangeText('hidden draft'); view.update(render({ ...base, visible: false })); });
  expect(nativeInput.props.value).toBe('hidden draft');
  act(() => { view.update(render()); });
  expect(nativeInput.props.value).toBe('');
});

it('resets only quick-command fields for new arrays, slot changes and reopen without remounting scroll or inputs', () => {
  const base = { visible: true, slot: 0, onClose: jest.fn() };
  const render = (props = base) => React.createElement(CustomQuickCommandSheet, props);
  act(() => { view = create(render()); });
  const scroll = view.root.findByType('Scroll' as never);
  const input = view.root.findAllByType('Input' as never)[0];
  act(() => { input.props.onChangeText('draft'); });
  act(() => { view.update(render({ ...base, onClose: jest.fn() })); });
  expect(input.props.value).toBe('draft');
  mockCommands = [...mockCommands];
  act(() => { view.update(render()); });
  expect(input.props.value).toBe('One');
  act(() => { view.update(render({ ...base, slot: 1 })); });
  expect(input.props.value).toBe('Two');
  act(() => { view.update(render()); });
  expect(input.props.value).toBe('One');
  act(() => { input.props.onChangeText('hidden'); view.update(render({ ...base, visible: false })); });
  expect(input.props.value).toBe('hidden');
  act(() => { view.update(render()); });
  expect(input.props.value).toBe('One');
  expect(view.root.findByType('Scroll' as never)).toBe(scroll);
  expect(view.root.findAllByType('Input' as never)[0]).toBe(input);
});

it('clears coordinate validation and pending state only on the original visible input identity transition', async () => {
  const coordinates = { latitude: 25, longitude: 121 };
  let finish!: () => void;
  const submit = jest.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const props = { visible: true, initialCoordinates: coordinates, onClose: jest.fn(), onSubmit: submit };
  const render = (initialCoordinates = coordinates) => React.createElement(CoordinateDestinationSheet, { ...props, initialCoordinates });
  act(() => { view = create(render()); });
  const send = () => view.root.findAllByType('Button' as never).at(-1)!.props.onPress();
  await act(async () => { send(); });
  expect(JSON.stringify(view.toJSON())).toContain('coord.emptyTitle');
  act(() => { view.update(render({ ...coordinates })); });
  expect(JSON.stringify(view.toJSON())).not.toContain('coord.emptyTitle');
  const currentCoordinates = { ...coordinates };
  act(() => { view.update(render(currentCoordinates)); });
  act(() => { view.root.findAllByType('Input' as never)[0].props.onChangeText('Place'); });
  act(() => { send(); });
  expect(view.root.findAllByType('Input' as never).every(node => node.props.editable === false)).toBe(true);
  act(() => { view.update(render(currentCoordinates)); });
  expect(view.root.findAllByType('Button' as never).at(-1)!.props.disabled).toBe(true);
  act(() => { view.update(render(coordinates)); });
  expect(view.root.findAllByType('Button' as never).at(-1)!.props.disabled).toBe(false);
  await act(async () => { finish(); });
});

it('clears the feedback deferred close on unmount and closes exactly once on the next mount', async () => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
  const close = jest.fn();
  const render = () => React.createElement(FeedbackSheet, { visible: true, onClose: close });
  const send = async () => {
    act(() => { view.root.findByType('Input' as never).props.onChangeText('feedback'); });
    await act(async () => { await view.root.findAllByType('Button' as never).at(-1)!.props.onPress(); });
  };
  act(() => { view = create(render()); });
  await send();
  expect(jest.getTimerCount()).toBe(1);
  act(() => { view.unmount(); });
  expect(jest.getTimerCount()).toBe(0);
  act(() => { jest.advanceTimersByTime(1000); });
  expect(close).not.toHaveBeenCalled();
  act(() => { view = create(render()); });
  await send();
  act(() => { jest.advanceTimersByTime(1000); });
  expect(close).toHaveBeenCalledTimes(1);
});
