import { DEFAULT_NOTIFICATION_PREFERENCES } from '../types';
import {
  applyPresenceMacroWrites,
  derivePresenceMacro,
  presenceMacroWrites,
} from '../utils/presenceMacros';

const allOn = { ...DEFAULT_NOTIFICATION_PREFERENCES };
const groupOff = {
  ...DEFAULT_NOTIFICATION_PREFERENCES,
  leaderCommands: false,
  journey: false,
  addGathering: false,
};
const allOff = {
  addGathering: false,
  leaderCommands: false,
  followerRequests: false,
  journey: false,
};

describe('presence macros', () => {
  it('follow turns solo off and group notification categories on; location unchanged', () => {
    const writes = presenceMacroWrites('follow', {
      solo: true,
      locationSharing: false,
      notifications: groupOff,
    });
    expect(writes.solo).toBe(false);
    expect(writes.locationSharing).toBeUndefined();
    expect(writes.notifications).toEqual({
      leaderCommands: true,
      journey: true,
      addGathering: true,
    });
  });

  it('solo turns solo on and group notification categories off; location unchanged', () => {
    const writes = presenceMacroWrites('solo', {
      solo: false,
      locationSharing: true,
      notifications: allOn,
    });
    expect(writes.solo).toBe(true);
    expect(writes.locationSharing).toBeUndefined();
    expect(writes.notifications).toEqual({
      leaderCommands: false,
      journey: false,
      addGathering: false,
    });
  });

  it('stealth turns location off and all notification categories off', () => {
    const writes = presenceMacroWrites('stealth', {
      solo: false,
      locationSharing: true,
      notifications: allOn,
    });
    expect(writes.locationSharing).toBe(false);
    expect(writes.notifications).toEqual(allOff);
  });

  it('skips already-matching controls (location already off → stealth only closes remaining notifs)', () => {
    const writes = presenceMacroWrites('stealth', {
      solo: true,
      locationSharing: false,
      notifications: { ...allOn, addGathering: false },
    });
    expect(writes.locationSharing).toBeUndefined();
    expect(writes.solo).toBeUndefined();
    expect(writes.notifications).toEqual({
      leaderCommands: false,
      followerRequests: false,
      journey: false,
    });
  });

  it('skips no-op follow when already matching', () => {
    const writes = presenceMacroWrites('follow', {
      solo: false,
      locationSharing: true,
      notifications: allOn,
    });
    expect(writes).toEqual({});
  });

  it('derives stealth, then solo, then follow on restart', () => {
    expect(derivePresenceMacro({
      solo: true,
      locationSharing: false,
      notifications: allOff,
    })).toBe('stealth');
    expect(derivePresenceMacro({
      solo: true,
      locationSharing: true,
      notifications: groupOff,
    })).toBe('solo');
    expect(derivePresenceMacro({
      solo: false,
      locationSharing: true,
      notifications: allOn,
    })).toBe('follow');
  });

  it('rolls back notification writes when stealth location confirm is cancelled', async () => {
    const applied: Array<typeof allOn> = [];
    const setSolo = jest.fn(async () => true);
    const applyNotifications = jest.fn(async (next: typeof allOn) => {
      applied.push({ ...next });
    });
    const disableLocationSharing = jest.fn(async () => false);
    const current = { solo: false, locationSharing: true, notifications: allOn };
    const ok = await applyPresenceMacroWrites(
      presenceMacroWrites('stealth', current),
      current,
      { setSolo, applyNotifications, disableLocationSharing },
    );
    expect(ok).toBe(false);
    expect(disableLocationSharing).toHaveBeenCalledTimes(1);
    expect(applied).toEqual([allOff, allOn]);
    expect(setSolo).not.toHaveBeenCalled();
  });

  it('rolls back notification writes when stealth location sync fails', async () => {
    const applyNotifications = jest.fn(async () => undefined);
    const setSolo = jest.fn(async () => true);
    const disableLocationSharing = jest.fn(async () => false);
    const current = { solo: true, locationSharing: true, notifications: allOn };
    const ok = await applyPresenceMacroWrites(
      presenceMacroWrites('stealth', current),
      current,
      { setSolo, applyNotifications, disableLocationSharing },
    );
    expect(ok).toBe(false);
    expect(applyNotifications).toHaveBeenNthCalledWith(1, allOff);
    expect(applyNotifications).toHaveBeenNthCalledWith(2, allOn);
    expect(setSolo).not.toHaveBeenCalled();
  });

  it('rolls back solo and notifications when stealth location confirm is cancelled after a prior solo write', async () => {
    const setSolo = jest.fn(async () => true);
    const applyNotifications = jest.fn(async () => undefined);
    const disableLocationSharing = jest.fn(async () => false);
    const current = { solo: false, locationSharing: true, notifications: allOn };
    const ok = await applyPresenceMacroWrites(
      { solo: true, locationSharing: false, notifications: allOff },
      current,
      { setSolo, applyNotifications, disableLocationSharing },
    );
    expect(ok).toBe(false);
    expect(setSolo).toHaveBeenNthCalledWith(1, true);
    expect(setSolo).toHaveBeenNthCalledWith(2, false);
    expect(applyNotifications).toHaveBeenNthCalledWith(1, allOff);
    expect(applyNotifications).toHaveBeenNthCalledWith(2, allOn);
  });

  it('does not commit stealth when notification apply fails', async () => {
    const setSolo = jest.fn(async () => true);
    const applyNotifications = jest.fn(async () => {
      throw new Error('notif sync failed');
    });
    const disableLocationSharing = jest.fn(async () => true);
    const current = { solo: false, locationSharing: true, notifications: allOn };
    const ok = await applyPresenceMacroWrites(
      presenceMacroWrites('stealth', current),
      current,
      { setSolo, applyNotifications, disableLocationSharing },
    );
    expect(ok).toBe(false);
    expect(disableLocationSharing).not.toHaveBeenCalled();
    expect(applyNotifications).toHaveBeenNthCalledWith(1, allOff);
    expect(applyNotifications).toHaveBeenNthCalledWith(2, allOn);
  });

  it('commits stealth after location sharing is disabled', async () => {
    const applyNotifications = jest.fn(async () => undefined);
    const setSolo = jest.fn(async () => true);
    const disableLocationSharing = jest.fn(async () => true);
    const current = { solo: false, locationSharing: true, notifications: allOn };
    const ok = await applyPresenceMacroWrites(
      presenceMacroWrites('stealth', current),
      current,
      { setSolo, applyNotifications, disableLocationSharing },
    );
    expect(ok).toBe(true);
    expect(applyNotifications).toHaveBeenCalledTimes(1);
    expect(applyNotifications).toHaveBeenCalledWith(allOff);
    expect(disableLocationSharing).toHaveBeenCalledTimes(1);
    expect(setSolo).not.toHaveBeenCalled();
  });
});
