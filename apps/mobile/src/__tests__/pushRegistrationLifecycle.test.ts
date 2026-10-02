import React from 'react';
const mockSave = jest.fn();
const mockPermission = jest.fn();
const mockToken = jest.fn();
let mockActor: string | null = 'account-a';
const mockPlatform = { OS: 'ios' };
jest.mock('react-native', () => ({ Platform: mockPlatform }));
jest.mock('../state/SessionContext', () => ({ useSession: () => ({ user: mockActor ? { id: mockActor } : null }) }));
jest.mock('../native', () => ({ notifications: { requestPermission: (...args: unknown[]) => mockPermission(...args), getDevicePushToken: (...args: unknown[]) => mockToken(...args) } }));
jest.mock('../api/client', () => ({ savePushToken: (...args: unknown[]) => mockSave(...args) }));
import { usePushRegistration } from '../state/usePushRegistration';
const { act, create } = require('react-test-renderer') as typeof import('react-test-renderer');
function Harness() { usePushRegistration(); return null; }
describe('push registration account lifecycle', () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks(); mockActor = 'account-a'; mockPlatform.OS = 'ios';
    mockPermission.mockResolvedValue(true); mockToken.mockResolvedValue('native-token'); mockSave.mockResolvedValue(undefined);
  });
  it('registers each signed-in account with an explicit actor and the native platform', async () => {
    let tree!: import('react-test-renderer').ReactTestRenderer;
    await act(async () => { tree = create(React.createElement(Harness)); });
    expect(mockSave).toHaveBeenCalledWith('native-token', 'ios', 'account-a');
    mockActor = 'account-b'; mockPlatform.OS = 'android';
    await act(async () => { tree.update(React.createElement(Harness)); });
    expect(mockSave).toHaveBeenCalledWith('native-token', 'android', 'account-b');
    await act(async () => { tree.unmount(); });
  });
  it('does not register a token whose permission request completed after account transition', async () => {
    let allow!: () => void;
    mockPermission.mockImplementationOnce(() => new Promise<void>(resolve => { allow = resolve; }));
    let tree!: import('react-test-renderer').ReactTestRenderer;
    await act(async () => { tree = create(React.createElement(Harness)); });
    mockActor = null;
    await act(async () => { tree.update(React.createElement(Harness)); });
    await act(async () => { allow(); });
    expect(mockSave).not.toHaveBeenCalled();
    await act(async () => { tree.unmount(); });
  });
  it('keeps failed native registration nonfatal without writing a capability', async () => {
    mockPermission.mockRejectedValue(new Error('permission API unavailable'));
    let tree!: import('react-test-renderer').ReactTestRenderer;
    await act(async () => { tree = create(React.createElement(Harness)); });
    expect(mockToken).not.toHaveBeenCalled(); expect(mockSave).not.toHaveBeenCalled();
    await act(async () => { tree.unmount(); });
  });
});
