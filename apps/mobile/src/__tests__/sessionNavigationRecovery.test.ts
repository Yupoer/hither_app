import React from 'react';
let mockUser: { id: string } | null = { id: 'account-a' };
type NavigationSnapshot = { history: string[]; available: string[]; navigate: (route: string) => void; back: () => void };
function NavigationProbe(_props: NavigationSnapshot) { return null; }
let renderer: import('react-test-renderer').ReactTestRenderer;
function readNavigator(): { history: string[]; available: string[]; navigate: (route: string) => void; back: () => void } {
  const { history, available, navigate, back } = renderer.root.findByType(NavigationProbe).props;
  return { history, available, navigate, back };
}
function MockNavigator({ initialRouteName, children }: { initialRouteName: string; children: React.ReactNode }) {
  const [history, setHistory] = React.useState([initialRouteName]);
  const available = React.Children.toArray(children).filter(React.isValidElement).map(child => (child.props as { name: string }).name).filter(Boolean);
  return React.createElement(NavigationProbe, { history, available,
    navigate: (route: string) => { if (available.includes(route)) setHistory(previous => [...previous, route]); },
    back: () => setHistory(previous => previous.length > 1 ? previous.slice(0, -1) : previous),
  });
}
jest.mock('@react-navigation/native-stack', () => ({ createNativeStackNavigator: () => ({ Navigator: MockNavigator, Screen: () => null }) }));
jest.mock('../state/SessionContext', () => ({ useSession: () => ({ user: mockUser }) }));
jest.mock('../state/PreferencesContext', () => ({ useTheme: () => ({ colors: {} }) }));
jest.mock('../screens/LoginScreen', () => () => null);
jest.mock('../screens/RoleSelectScreen', () => () => null);
jest.mock('../screens/AuthScreen', () => () => null);
jest.mock('../screens/MapScreen', () => () => null);
jest.mock('../screens/MyTeamsScreen', () => () => null);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { create, act } = require('react-test-renderer');
const RootNavigator = require('../navigation/RootNavigator').default;

describe('protected navigation after terminal session removal', () => {
  it('mounts Login with no protected history and rejects queued Map navigation after logout', async () => {
    const original = console.error;
    const spy = jest.spyOn(console, 'error').mockImplementation((...args) => {
      if (String(args[0]).startsWith('react-test-renderer is deprecated')) return;
      original(...args);
    });
    mockUser = { id: 'account-a' };
    await act(async () => { renderer = create(React.createElement(RootNavigator)); });
    await act(async () => { readNavigator().navigate('Map'); readNavigator().navigate('MyTeams'); });
    expect(readNavigator().history).toEqual(['RoleSelect', 'Map', 'MyTeams']);
    mockUser = null;
    await act(async () => { renderer.update(React.createElement(RootNavigator)); });
    expect(readNavigator().history).toEqual(['Login']); expect(readNavigator().available).not.toContain('Map'); expect(readNavigator().available).not.toContain('MyTeams');
    await act(async () => { readNavigator().navigate('Map'); readNavigator().back(); });
    expect(readNavigator().history).toEqual(['Login']);
    mockUser = { id: 'account-b' };
    await act(async () => { renderer.update(React.createElement(RootNavigator)); });
    expect(readNavigator().history).toEqual(['RoleSelect']);
    await act(async () => { renderer.unmount(); }); spy.mockRestore();
  });
});
