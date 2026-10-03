import React, { useRef } from 'react';
import { useMemberMarkerMotion } from '../components/useMemberMarkerMotion';
import type { MemberMotionSample } from '../utils/memberMotion';
const { create, act } = require('react-test-renderer');

const first = { coordinates: { latitude: 35, longitude: 139 }, sampledAt: 100_000 };
const second = { coordinates: { latitude: 35.0001, longitude: 139 }, sampledAt: 106_000 };
const third = { coordinates: { latitude: 35.0002, longitude: 139 }, sampledAt: 112_000 };

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  jest.useFakeTimers();
  jest.setSystemTime(112_000);
});
afterEach(() => jest.useRealTimers());

it('never moves the coordinate prop to the endpoint before issuing the native command', async () => {
  const command = jest.fn();
  let coordinate: ReturnType<typeof useMemberMarkerMotion>;
  function Harness({ sample, animate = true }: { sample: MemberMotionSample; animate?: boolean }) {
    const ref = useRef({ animateMarkerToCoordinate: command });
    coordinate = useMemberMarkerMotion(ref, sample, animate);
    return null;
  }
  let tree: any;
  await act(async () => { tree = create(React.createElement(Harness, { sample: first })); });
  const initial = coordinate!;
  await act(async () => { tree.update(React.createElement(Harness, { sample: second })); });
  expect(coordinate!).toBe(initial);
  expect(command).toHaveBeenLastCalledWith(second.coordinates, 6000);
  await act(async () => { tree.update(React.createElement(Harness, { sample: third })); });
  expect(coordinate!).toBe(initial);
  expect(command).toHaveBeenLastCalledWith(third.coordinates, 6000);

  const count = command.mock.calls.length;
  // Replays, equal timestamps with conflicting coords, and old samples cannot move either owner.
  for (const sample of [second, { ...first, sampledAt: third.sampledAt }, third]) {
    await act(async () => { tree.update(React.createElement(Harness, { sample })); });
  }
  expect(coordinate!).toBe(initial);
  expect(command).toHaveBeenCalledTimes(count);
  // Thermal / background snap accepts only the newest true endpoint, even if props regressed.
  await act(async () => { tree.update(React.createElement(Harness, { sample: first, animate: false })); });
  expect(command).toHaveBeenLastCalledWith(third.coordinates, 0);
  await act(async () => { tree.unmount(); });
});

it('rejects invalid coordinates and keeps trusted samples monotonic through background and resume', async () => {
  const command = jest.fn();
  function Harness({ sample, animate }: { sample: MemberMotionSample; animate: boolean }) {
    const ref = useRef({ animateMarkerToCoordinate: command });
    useMemberMarkerMotion(ref, sample, animate);
    return null;
  }
  let tree: any;
  await act(async () => { tree = create(React.createElement(Harness, { sample: second, animate: false })); });
  await act(async () => { tree.update(React.createElement(Harness, { sample: first, animate: false })); });
  expect(command).toHaveBeenCalledTimes(1);
  await act(async () => { tree.update(React.createElement(Harness, { sample: { ...third, coordinates: { latitude: NaN, longitude: 139 } }, animate: false })); });
  expect(command).toHaveBeenCalledTimes(1);
  await act(async () => { tree.update(React.createElement(Harness, { sample: third, animate: true })); });
  expect(command).toHaveBeenLastCalledWith(third.coordinates, 0);
  await act(async () => { tree.unmount(); });
});
