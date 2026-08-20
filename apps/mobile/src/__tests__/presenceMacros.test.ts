import { DEFAULT_NOTIFICATION_PREFERENCES } from '../types';
import {
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
});
