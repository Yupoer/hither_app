import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Pressable, TextInput } from 'react-native';
import { QuickCommandGrid } from '../screens/MapScreen/components/QuickCommandGrid';
import type { CustomQuickCommand } from '../types';

const mockSend = jest.fn<Promise<void>, [string, string, string]>();
const mockRequestStart = jest.fn<Promise<void>, [string, string]>();
const mockSave = jest.fn<Promise<void>, [number, CustomQuickCommand]>();
let mockCommands: (CustomQuickCommand | null)[] = [];

jest.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  TextInput: 'TextInput',
  StyleSheet: { create: (styles: object) => styles },
  Text: 'Text',
  View: 'View',
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../components/SheetHeaderAction', () => ({ __esModule: true, default: 'SheetHeaderAction' }));
jest.mock('../api/client', () => ({
  sendCommand: (...args: [string, string, string]) => mockSend(...args),
  requestGatheringStart: (...args: [string, string]) => mockRequestStart(...args),
}));
jest.mock('../state/SessionContext', () => ({
  useSession: () => ({ customQuickCommands: mockCommands, setCustomQuickCommand: mockSave }),
}));
jest.mock('../i18n', () => ({ useTranslation: () => ({ t: (id: string) => id, language: 'en' }) }));
jest.mock('../utils/haptics', () => ({ mediumTap: jest.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('D6 quick commands', () => {
  let renderer: ReactTestRenderer;
  const onClose = jest.fn();
  const onCommandSent = jest.fn();

  function render(isLeader: boolean, requestStartDestinationId?: string) {
    const props = {
      groupId: 'team-1', isLeader, requestStartDestinationId, onClose, onCommandSent,
      accent: '#4C6FFF', onAccent: '#FFFFFF',
    };
    act(() => { renderer = create(React.createElement(QuickCommandGrid, props)); });
  }

  function button(id: string) {
    return renderer.root.findAllByType(Pressable).find(node => node.props.testID === id)!.props;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockSend.mockResolvedValue(undefined);
    mockRequestStart.mockResolvedValue(undefined);
    mockSave.mockResolvedValue(undefined);
    mockCommands = [null, null, null];
  });

  afterEach(() => {
    act(() => renderer.unmount());
    jest.useRealTimers();
  });

  it('offers all nine leader commands and closes 380 ms after the durable command resolves', async () => {
    render(true);
    expect(renderer.root.findAllByType(Pressable).map(node => node.props.testID)).toEqual([
      'quick-command-gather', 'quick-command-find_gathering', 'quick-command-depart',
      'quick-command-rest', 'quick-command-be_careful', 'quick-command-stop',
      'quick-command-hurry_up', 'quick-command-go_left', 'quick-command-go_right', 'd6-command-add',
    ]);
    await act(async () => {
      button('quick-command-go_right').onPress();
      button('quick-command-gather').onPress();
    });
    expect(mockSend.mock.calls).toEqual([['team-1', 'go_right', 'command.go_right']]);
    act(() => jest.advanceTimersByTime(379));
    expect(onClose).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1));
    expect(onCommandSent).toHaveBeenCalledWith('command.go_right');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses member-authorized delivery for a gathering search', async () => {
    render(false);
    expect(renderer.root.findAllByType(Pressable).map(node => node.props.testID)).toEqual([
      'quick-command-need_restroom', 'quick-command-need_break', 'quick-command-need_help',
      'quick-command-found_something', 'quick-command-request_start',
      'quick-command-find_gathering', 'd6-command-add',
    ]);
    await act(async () => { button('quick-command-find_gathering').onPress(); });
    expect(mockSend).toHaveBeenCalledWith('team-1', 'custom', 'command.find_gathering');
  });

  it('uses the existing leader inbox path for a destination-specific start request', async () => {
    render(false, 'destination-1');
    await act(async () => { button('quick-command-request_start').onPress(); });
    expect(mockRequestStart).toHaveBeenCalledWith('team-1', 'destination-1');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('retains the notification text of an older command when its label changes', async () => {
    mockCommands[0] = { label: 'Photo', message: 'A longer notification message' };
    render(true);
    act(() => button('quick-command-custom-0').onLongPress());
    act(() => renderer.root.findByType(TextInput).props.onChangeText('Photos here'));
    const save = renderer.root.findAllByProps({ testID: 'custom-command-save' }).find(node => node.props.action === 'commit');
    await act(async () => save!.props.onPress());
    expect(mockSave).toHaveBeenCalledWith(0, { label: 'Photos here', message: 'A longer notification message' });
    expect(renderer.root.findAllByType(TextInput)).toHaveLength(0);
  });
});
