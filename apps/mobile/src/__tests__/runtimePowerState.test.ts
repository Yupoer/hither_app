import { getRuntimePowerState, subscribeRuntimePowerState, updateRuntimePowerState } from '../state/runtimePowerState';
it('shares existing power samples without duplicate notifications or erasing heat on unavailable capability', () => {
  const listener = jest.fn();
  const unsubscribe = subscribeRuntimePowerState(listener);
  updateRuntimePowerState({ lowPowerMode: true, thermalState: 'serious' });
  updateRuntimePowerState({ lowPowerMode: true, thermalState: 'serious' });
  updateRuntimePowerState(null);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(getRuntimePowerState()).toEqual({ lowPowerMode: true, thermalState: 'serious' });
  unsubscribe();
  updateRuntimePowerState({ lowPowerMode: false, thermalState: 'nominal' });
  expect(listener).toHaveBeenCalledTimes(1);
});
