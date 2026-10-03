import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const mockSearch = jest.fn();
const mockListeners = new Set<(state: string) => void>();
const mockAppState = { currentState: 'active', addEventListener: (_: string, listener: (state: string) => void) => {
  mockListeners.add(listener); return { remove: () => mockListeners.delete(listener) };
} };
jest.mock('react-native', () => ({
  AppState: mockAppState,
  ActivityIndicator: 'Spinner', FlatList: 'List', Pressable: 'Button', Text: 'Text',
  TextInput: 'Input', View: 'View', StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
}));
jest.mock('../native', () => ({ maps: { searchPlaces: (...args: unknown[]) => mockSearch(...args) } }));
jest.mock('../state/PreferencesContext', () => ({ useTheme: () => ({ colors: {} }) }));
jest.mock('../i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../components/CrookIcon', () => 'Icon');
jest.mock('../components/OverlaySheet', () => 'Sheet');
import DestinationSearch from '../components/DestinationSearch';

let view: ReactTestRenderer;
const region = { latitude: 25, longitude: 121, latitudeDelta: 0.08, longitudeDelta: 0.08 };
const props = { visible: true, onClose: jest.fn(), onPick: jest.fn(), biasRegion: region };
const render = (next = props) => React.createElement(DestinationSearch, next);
const input = (query: string) => act(() => view.root.findByType('Input' as never).props.onChangeText(query));
beforeEach(() => {
  jest.useFakeTimers(); mockSearch.mockReset();
  mockAppState.currentState = 'active';
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  act(() => { view = create(render()); });
});
afterEach(() => { act(() => view.unmount()); jest.useRealTimers(); });

it('keeps one search and a fixed centre while GPS updates', async () => {
  mockSearch.mockResolvedValue([]);
  input('內湖 CQ2');
  await act(async () => { jest.advanceTimersByTime(450); });
  act(() => view.update(render({ ...props, biasRegion: { ...region, latitude: 25.001 } })));
  await act(async () => { jest.advanceTimersByTime(10_000); });
  expect(mockSearch).toHaveBeenCalledTimes(1);
  expect(mockSearch).toHaveBeenCalledWith('內湖 CQ2', region, { throwOnError: true });
});

it('invalidates results after clearing or closing and never restarts by itself', async () => {
  let finish!: (results: unknown[]) => void;
  mockSearch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  input('old');
  await act(async () => { jest.advanceTimersByTime(450); });
  input('');
  await act(async () => finish([{ id: 'stale' }]));
  expect(view.root.findByType('List' as never).props.data).toEqual([]);
  input('new');
  await act(async () => { jest.advanceTimersByTime(450); });
  act(() => view.update(render({ ...props, visible: false })));
  await act(async () => { finish([{ id: 'closed' }]); jest.advanceTimersByTime(30_000); });
  expect(view.root.findByType('List' as never).props.data).toEqual([]);
  expect(mockSearch).toHaveBeenCalledTimes(2);
});

it('finishes a stalled request with an error rather than leaving a spinner', async () => {
  mockSearch.mockImplementation(() => new Promise(() => {}));
  input('timeout');
  await act(async () => { jest.advanceTimersByTime(450); });
  await act(async () => { jest.advanceTimersByTime(20_000); });
  expect(view.root.findAllByType('Spinner' as never)).toHaveLength(0);
  expect(JSON.stringify(view.toJSON())).toContain('search.failed');
});

it('cancels a background debounce and resumes the retained query once without replaying searches', async () => {
  mockSearch.mockResolvedValue([]);
  input('retained');
  const transition = (state: string) => act(() => {
    mockAppState.currentState = state;
    for (const listener of mockListeners) listener(state);
  });
  transition('background');
  await act(async () => { jest.advanceTimersByTime(120_000); });
  expect(mockSearch).not.toHaveBeenCalled();
  expect(view.root.findByType('Input' as never).props.value).toBe('retained');
  transition('active'); transition('active');
  await act(async () => { jest.advanceTimersByTime(450); });
  expect(mockSearch).toHaveBeenCalledTimes(1);
});
jest.mock('../components/WaveLoading', () => 'WaveLoading');
