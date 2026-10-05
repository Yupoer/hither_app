import React from 'react';
let mockUser: { id: string } | null = { id: 'account-a' };
let mockNavigate: (route: string) => void;
let mockBack: () => void;
let mockHistory: string[] = [];
let mockAvailable: string[] = [];
function MockNavigator({ initialRouteName, children }: { initialRouteName: string; children: React.ReactNode }) {
  const [history, setHistory] = React.useState([initialRouteName]);
  React.useLayoutEffect(() => {
    mockHistory = history;
    mockAvailable = React.Children.toArray(children).filter(React.isValidElement).map(child => (child.props as { name: string }).name).filter(Boolean);
    mockNavigate = route => { if (mockAvailable.includes(route)) setHistory(previous => [...previous, route]); };
    mockBack = () => setHistory(previous => previous.length > 1 ? previous.slice(0, -1) : previous);
  }, [children, history]);
  return null;
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
    let renderer: { update: (node: React.ReactNode) => void; unmount: () => void };
    mockUser = { id: 'account-a' };
    await act(async () => { renderer = create(React.createElement(RootNavigator)); });
    await act(async () => { mockNavigate('Map'); mockNavigate('MyTeams'); });
    expect(mockHistory).toEqual(['RoleSelect', 'Map', 'MyTeams']);
    mockUser = null;
    await act(async () => { renderer.update(React.createElement(RootNavigator)); });
    expect(mockHistory).toEqual(['Login']); expect(mockAvailable).not.toContain('Map'); expect(mockAvailable).not.toContain('MyTeams');
    await act(async () => { mockNavigate('Map'); mockBack(); });
    expect(mockHistory).toEqual(['Login']);
    mockUser = { id: 'account-b' };
    await act(async () => { renderer.update(React.createElement(RootNavigator)); });
    expect(mockHistory).toEqual(['RoleSelect']);
    await act(async () => { renderer.unmount(); }); spy.mockRestore();
  });
});
