import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useNearMeeting } from '../state/useNearMeeting';

let mockVisible = true;
jest.mock('../state/foregroundUi', () => ({ useVisibleUi: () => mockVisible }));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

const START = Date.parse('2026-11-14T05:00:00.000Z');
const at = (minutes: number) => new Date(START + minutes * 60_000).toISOString();
let renderer: ReactTestRenderer | undefined;
let renders = 0;
function Probe(_props: { nearMeeting: boolean }) { return null; }
function Harness({ meetAt, enabled = true }: { meetAt?: string; enabled?: boolean }) {
  renders++;
  const { nearMeeting, lifecycle } = useNearMeeting(meetAt, enabled);
  return React.createElement(React.Fragment, null, lifecycle, React.createElement(Probe, { nearMeeting }));
}
function render(meetAt?: string, enabled = true) {
  act(() => {
    const element = React.createElement(Harness, { meetAt, enabled });
    if (renderer) renderer.update(element);
    else renderer = create(element);
  });
}
function near() {
  if (!renderer) throw new Error('Harness is not mounted');
  return renderer.root.findByType(Probe).props.nearMeeting;
}
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(START); mockVisible = true; renders = 0; });
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; expect(jest.getTimerCount()).toBe(0); jest.useRealTimers(); });

it('updates only when the fifteen-minute window opens and expires, including the exact deadline', () => {
  render(at(60));
  const initialRenders = renders;
  act(() => jest.advanceTimersByTime(45 * 60_000 - 1));
  expect(near()).toBe(false);
  expect(renders).toBe(initialRenders);
  act(() => jest.advanceTimersByTime(1));
  expect(near()).toBe(true);
  const windowRenders = renders;
  act(() => jest.advanceTimersByTime(15 * 60_000));
  expect(near()).toBe(true);
  expect(renders).toBe(windowRenders);
  act(() => jest.advanceTimersByTime(1));
  expect(near()).toBe(false);
});

it('releases its timer in background and immediately reconciles wall time on resume', () => {
  render(at(10));
  expect(near()).toBe(true);
  mockVisible = false;
  render(at(10));
  expect(jest.getTimerCount()).toBe(0);
  act(() => jest.advanceTimersByTime(30 * 60_000));
  mockVisible = true;
  render(at(10));
  expect(near()).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
});

it('replaces a changed meeting deadline and drops invalid or disabled schedules', () => {
  render(at(10));
  render(at(90));
  expect(near()).toBe(false);
  act(() => jest.advanceTimersByTime(11 * 60_000));
  expect(near()).toBe(false);
  render('invalid');
  expect(near()).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
  render(at(90), false);
  expect(jest.getTimerCount()).toBe(0);
});

it('supports distant meetings without overflowing the platform timer limit', () => {
  render(at(60 * 24 * 60));
  const initialRenders = renders;
  act(() => jest.advanceTimersByTime(2_147_483_647));
  expect(near()).toBe(false);
  expect(renders).toBe(initialRenders);
  expect(jest.getTimerCount()).toBe(1);
});
