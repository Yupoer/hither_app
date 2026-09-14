jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null) }));
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureLocationAccess, setLocationAccessContext, setLocationSharingConsent, isLocationAccessCurrent } from '../state/locationPrivacy';
import { memberMotionDuration } from '../utils/memberMotion';
import { createMotionState, reduceMotionState, locationPolicy } from '../utils/locationPolicy';

test('cold background cannot read; stop and team change invalidate in-flight reads immediately', async () => {
  setLocationAccessContext('a', true);
  expect(await captureLocationAccess()).toBeNull();
  setLocationAccessContext('a', true, true);
  const ticket = (await captureLocationAccess())!;
  expect(ticket).not.toBeNull();
  setLocationSharingConsent(false);
  expect(ticket.signal.aborted).toBe(true);
  expect(isLocationAccessCurrent(ticket)).toBe(false);
  expect(await captureLocationAccess()).toBeNull();
  setLocationAccessContext('b', true, true);
  expect(await captureLocationAccess('a')).toBeNull();
  (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('false');
  expect(await captureLocationAccess()).toBeNull();
  (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('storage unavailable'));
  expect(await captureLocationAccess()).toBeNull();
});

test('display transitions follow sample time and snap on resume, stale samples, reduced motion, and jumps', () => {
  const a = { coordinates: { latitude:25, longitude:121 }, sampledAt: 100_000 };
  const b = { coordinates: { latitude:25.0001, longitude:121 }, sampledAt: 108_000 };
  expect(memberMotionDuration(a,b,108_000,true)).toBe(8_000);
  expect(memberMotionDuration(null,b,108_000,true)).toBe(0);
  expect(memberMotionDuration(a,b,108_000,false)).toBe(0);
  expect(memberMotionDuration(b,a,108_000,true)).toBe(0);
  expect(memberMotionDuration(a,b,200_000,true)).toBe(0);
  expect(memberMotionDuration(a,{...b,coordinates:{latitude:35,longitude:121}},108_000,true)).toBe(0);
  expect(a.coordinates.latitude).toBe(25);
});

test('short consecutive walking fixes accumulate rather than looking stationary forever', () => {
  const policy = locationPolicy(false, 'journey');
  let state = createMotionState();
  for(let step=0;step<100;step++) state=reduceMotionState(state,
    {latitude:25+step/111_000,longitude:121},step*5_000,policy,5);
  expect(state.cadence).toBe('moving');
  expect(state.lastSignificantMoveAtMs).toBeGreaterThan(400_000);
});
