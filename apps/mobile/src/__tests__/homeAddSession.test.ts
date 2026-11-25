import React from 'react';
import { act, create } from 'react-test-renderer';
import { useHomeAddSession } from '../screens/MapScreen/hooks/useHomeAddSession';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const draft = { day: 2, stay: false, placement: { kind: 'last' } as const };

function mount() {
  const flow: { current?: ReturnType<typeof useHomeAddSession> } = {};
  function Harness() {
    flow.current = useHomeAddSession();
    return null;
  }
  act(() => { create(React.createElement(Harness)); });
  return () => flow.current!;
}

describe('useHomeAddSession', () => {
  it('ends the session when a swipe reports presentation change and dismissal before re-rendering', () => {
    const flow = mount();
    act(() => flow().open(draft));
    let finished: ReturnType<ReturnType<typeof useHomeAddSession>['finishDismiss']> = null;
    act(() => {
      const handlers = flow();
      handlers.dismiss('close');
      finished = handlers.finishDismiss();
    });
    expect(finished).toBe('close');
    expect(flow().session).toBeNull();
  });

  it('marks a close as leaving until the sheet finishes and ignores dismissals nobody requested', () => {
    const flow = mount();
    act(() => flow().open(draft));
    act(() => { expect(flow().finishDismiss()).toBeNull(); });
    expect(flow().session).toMatchObject({ day: 2 });
    expect(flow().session?.dismissal).toBeUndefined();
    act(() => flow().dismiss('close'));
    expect(flow().session?.dismissal).toBe('close');
    act(() => { expect(flow().finishDismiss()).toBe('close'); });
    expect(flow().session).toBeNull();
  });

  it('starts a session requested during a close only after the old sheet is gone', () => {
    const flow = mount();
    act(() => flow().open(draft));
    const first = flow().session!.id;
    act(() => flow().dismiss('close'));
    act(() => flow().open({ day: 3, stay: true, placement: { kind: 'first' } }));
    expect(flow().session).toMatchObject({ id: first, dismissal: 'close' });
    act(() => { flow().finishDismiss(); });
    expect(flow().session).toMatchObject({ day: 3, stay: true, placement: { kind: 'first' } });
    expect(flow().session?.dismissal).toBeUndefined();
    expect(flow().session!.id).not.toBe(first);
  });

  it('keeps the session after a store dismissal so it can resume behind the store', () => {
    const flow = mount();
    act(() => flow().open(draft));
    act(() => flow().dismiss('store'));
    act(() => flow().update(current => ({ ...current, day: 5 })));
    expect(flow().session).toMatchObject({ day: 2, dismissal: 'store' });
    act(() => { expect(flow().finishDismiss()).toBe('store'); });
    expect(flow().session).toMatchObject({ day: 2 });
    expect(flow().session?.dismissal).toBeUndefined();
  });
});
