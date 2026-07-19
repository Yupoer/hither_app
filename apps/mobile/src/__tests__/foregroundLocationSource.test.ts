import { createForegroundLocationSource } from '../screens/MapScreen/foregroundLocationSource';

describe('foreground location source ownership', () => {
  it('uses the MapKit sample without starting a second foreground watcher', async () => {
    const watchLocation = jest.fn();
    const onSample = jest.fn();
    const sample = {
      coordinates: { latitude: 25.033, longitude: 121.5654 },
      accuracy: 8,
      timestamp: 1_789_000_000_000,
    };

    const source = createForegroundLocationSource({
      nativeMapAvailable: true,
      watchLocation,
      onSample,
    });
    source.acceptMapSample(sample);

    expect(onSample).toHaveBeenCalledWith(sample);
    expect(watchLocation).not.toHaveBeenCalled();
  });

  it('starts the Expo watcher only when native map location is unavailable', async () => {
    const unsub = jest.fn();
    const watchLocation = jest.fn(async () => unsub);
    const onSample = jest.fn();
    const source = createForegroundLocationSource({
      nativeMapAvailable: false,
      watchLocation,
      onSample,
    });

    await source.start();
    expect(watchLocation).toHaveBeenCalledTimes(1);
    source.stop();
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});
