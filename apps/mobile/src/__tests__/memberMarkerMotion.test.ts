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
  let coordinate: ReturnType<typeof useMemberMarkerMotion>['coordinate'];
  function Harness({ sample, animate = true }: { sample: MemberMotionSample; animate?: boolean }) {
    const ref = useRef({ animateMarkerToCoordinate: command });
    const motion = useMemberMarkerMotion(ref, sample, animate);
    coordinate = motion.coordinate;
    return motion.lifecycle;
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
    return useMemberMarkerMotion(ref, sample, animate).lifecycle;
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

it('keeps equal-value samples idle and cleans the old marker ref before attaching a replacement', async () => {
  const oldCommand = jest.fn(); const newCommand = jest.fn();
  const oldRef = { current: { animateMarkerToCoordinate: oldCommand } };
  const newRef = { current: { animateMarkerToCoordinate: newCommand } };
  function Harness({ sample, markerRef }: { sample: MemberMotionSample; markerRef: typeof oldRef }) {
    return useMemberMarkerMotion(markerRef, sample, true).lifecycle;
  }
  let tree: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(Harness, { sample: first, markerRef: oldRef })); });
  await act(async () => { tree.update(React.createElement(Harness, { sample: second, markerRef: oldRef })); });
  const commands = oldCommand.mock.calls.length;
  await act(async () => { tree.update(React.createElement(Harness,
    { sample: { ...second, coordinates: { ...second.coordinates } }, markerRef: oldRef })); });
  expect(oldCommand).toHaveBeenCalledTimes(commands);
  await act(async () => { tree.update(React.createElement(Harness, { sample: second, markerRef: newRef })); });
  expect(oldCommand).toHaveBeenCalledTimes(commands + 1);
  expect(oldCommand).toHaveBeenLastCalledWith(second.coordinates, 0);
  expect(newCommand).not.toHaveBeenCalled();
  await act(async () => { tree.update(React.createElement(Harness, { sample: third, markerRef: newRef })); });
  expect(newCommand).toHaveBeenLastCalledWith(third.coordinates, 6000);
  await act(async () => { tree.unmount(); });
  expect(newCommand).toHaveBeenLastCalledWith(third.coordinates, 0);
});

it('never issues native movement from a suspended uncommitted sample', async () => {
  const command = jest.fn();
  const markerRef = { current: { animateMarkerToCoordinate: command } };
  const pending = new Promise<void>(() => {});
  function Harness({ sample, suspend }: { sample: MemberMotionSample; suspend: boolean }) {
    const motion = useMemberMarkerMotion(markerRef, sample, true);
    if (suspend) throw pending;
    return motion.lifecycle;
  }
  const element = (sample: MemberMotionSample, suspend: boolean) => React.createElement(React.Suspense,
    { fallback: null }, React.createElement(Harness, { sample, suspend }));
  let tree: ReturnType<typeof create>;
  await act(async () => { tree = create(element(first, false)); });
  await act(async () => { tree.update(element(second, true)); });
  expect(command).toHaveBeenCalledTimes(1);
  expect(command).toHaveBeenLastCalledWith(first.coordinates, 0);
  await act(async () => { tree.update(element(third, false)); });
  expect(command).toHaveBeenLastCalledWith(third.coordinates, 10000);
  await act(async () => { tree.unmount(); });
});

it('preserves the accepted endpoint during Strict replay and snaps once more on unmount', async () => {
  const command = jest.fn();
  const markerRef = { current: { animateMarkerToCoordinate: command } };
  function Harness() { return useMemberMarkerMotion(markerRef, second, true).lifecycle; }
  let tree: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(React.StrictMode, null, React.createElement(Harness))); });
  expect(command).toHaveBeenCalledTimes(2);
  expect(command).toHaveBeenLastCalledWith(second.coordinates, 0);
  await act(async () => { tree.unmount(); });
  expect(command).toHaveBeenCalledTimes(3);
  expect(command).toHaveBeenLastCalledWith(second.coordinates, 0);
});
