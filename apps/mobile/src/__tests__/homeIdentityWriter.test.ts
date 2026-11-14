import { createIdentityWriter } from '../screens/MapScreen/components/useIdentityEditor';
import { displayMemberAvatar, HOME_AVATAR_COLORS } from '../constants/avatars';

function deferred() {
  let resolve = () => undefined;
  const promise = new Promise<void>(done => {
    resolve = () => { done(); return undefined; };
  });
  return { promise, resolve };
}

async function settle() {
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
}

describe('home identity autosave', () => {
  afterEach(() => jest.useRealTimers());

  it('debounces nickname changes and saves the last edit on dismissal', async () => {
    jest.useFakeTimers();
    const save = jest.fn().mockResolvedValue(undefined);
    const writer = createIdentityWriter({ scope: expect.getState().currentTestName ?? 'profile-test', save, onError: jest.fn() });
    writer.enqueue({ name: 'A' }, 350);
    jest.advanceTimersByTime(100);
    writer.enqueue({ name: 'Ada' }, 350);
    jest.advanceTimersByTime(120);
    expect(save).not.toHaveBeenCalled();
    await writer.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ name: 'Ada' });
  });

  it('does not save a stale nickname when the user erases the field', async () => {
    jest.useFakeTimers();
    const save = jest.fn().mockResolvedValue(undefined);
    const writer = createIdentityWriter({ scope: expect.getState().currentTestName ?? 'profile-test', save, onError: jest.fn() });
    writer.enqueue({ name: 'A' }, 350);
    writer.clearName();
    writer.enqueue({ avatar: '🦊' });
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ avatar: '🦊' });
  });

  it('sends later avatar and color after the current write settles', async () => {
    const first = deferred();
    const save = jest.fn().mockResolvedValue(undefined).mockReturnValueOnce(first.promise);
    const writer = createIdentityWriter({ scope: expect.getState().currentTestName ?? 'profile-test', save, onError: jest.fn() });
    writer.enqueue({ avatar: '🐑' });
    writer.enqueue({ avatar: '🦊' });
    writer.enqueue({ color: HOME_AVATAR_COLORS[0] });
    expect(save.mock.calls).toEqual([[{ avatar: '🐑' }]]);
    first.resolve();
    await settle();
    expect(save.mock.calls).toEqual([[{ avatar: '🐑' }], [{ avatar: '🦊', color: HOME_AVATAR_COLORS[0] }]]);
  });

  it('settles pending changes before a reopened editor writes the same profile', async () => {
    const first = deferred();
    const persisted: Array<Record<string, string>> = [];
    const last = deferred();
    const save = async (changes: Record<string, string>) => {
      if (changes.avatar === '🐑') await first.promise;
      persisted.push(changes);
      if (changes.avatar === '🦊') last.resolve();
    };
    const initial = createIdentityWriter({ scope: expect.getState().currentTestName ?? 'profile-test', save, onError: jest.fn() });
    initial.enqueue({ avatar: '🐑' });
    initial.enqueue({ avatar: '🐰' });
    initial.close();
    const reopened = createIdentityWriter({ scope: expect.getState().currentTestName ?? 'profile-test', save, onError: jest.fn() });
    reopened.enqueue({ avatar: '🦊' });

    first.resolve();
    await last.promise;
    expect(persisted).toEqual([{ avatar: '🐑' }, { avatar: '🐰' }, { avatar: '🦊' }]);
  });

  it('retries a failed patch with any newer values for the edited fields', async () => {
    const save = jest.fn().mockResolvedValue(undefined).mockRejectedValueOnce(new Error('offline'));
    const onError = jest.fn();
    const writer = createIdentityWriter({ scope: 'retry-profile', save, onError });
    writer.enqueue({ avatar: '🐑', color: HOME_AVATAR_COLORS[0] });
    await settle();
    expect(onError).toHaveBeenCalledTimes(1);
    writer.enqueue({ avatar: '🦊' });
    await settle();
    expect(save).toHaveBeenLastCalledWith({ avatar: '🦊', color: HOME_AVATAR_COLORS[0] });
  });

  it('reads new and legacy avatar colors from stored member profiles', () => {
    expect(displayMemberAvatar('🦊', 'actor-1', '#E0634A')).toEqual({ emoji: '🦊', color: '#E0634A' });
    expect(displayMemberAvatar('🦊', 'actor-1', '#E8543F')).toEqual({ emoji: '🦊', color: '#E8543F' });
  });
});
