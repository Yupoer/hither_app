import { refreshLocations } from '../utils/locationRefresh';

describe('refreshLocations', () => {
  it('uploads this device before reloading the group', async () => {
    const calls: string[] = [];
    const result = await refreshLocations(
      async () => {
        calls.push('own');
        return { latitude: 25, longitude: 121 };
      },
      async () => {
        calls.push('group');
        return true;
      },
    );

    expect(calls).toEqual(['own', 'group']);
    expect(result).toBe('ok');
  });

  it('still reloads the group when this device location fails', async () => {
    const reload = jest.fn(async () => true);

    await expect(
      refreshLocations(async () => {
        throw new Error('gps failed');
      }, reload),
    ).resolves.toBe('location-failed');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reports a group reload failure even after a successful upload', async () => {
    await expect(
      refreshLocations(
        async () => ({ latitude: 25, longitude: 121 }),
        async () => false,
      ),
    ).resolves.toBe('reload-failed');
  });
});
