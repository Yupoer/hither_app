import {
  accountPreferencesFromSlots,
  commandTypesWithCustomSlot,
  CUSTOM_QUICK_COMMAND_SLOTS,
  normalizeCustomQuickCommand,
  normalizeCustomQuickCommands,
  quickCommandGridItems,
} from '../types';

describe('custom quick command preferences', () => {
  it('normalizes a saved command and trims its fields', () => {
    expect(
      normalizeCustomQuickCommand({ label: ' 集合一下 ', message: ' 請回來 ' }),
    ).toEqual({ label: '集合一下', message: '請回來' });
  });

  it('rejects incomplete or malformed saved commands', () => {
    expect(normalizeCustomQuickCommand({ label: '集合一下', message: ' ' })).toBeNull();
    expect(normalizeCustomQuickCommand(null)).toBeNull();
    expect(normalizeCustomQuickCommand('集合一下')).toBeNull();
  });

  it('replaces the last role-specific shortcut with the custom slot', () => {
    expect(commandTypesWithCustomSlot(['gather', 'hurry_up'])).toEqual([
      'gather',
      'custom',
    ]);
  });

  it('gives followers three custom slots (plus fixed requests)', () => {
    const items = quickCommandGridItems(false);
    const customs = items.filter((i) => i.kind === 'custom');
    expect(customs).toHaveLength(CUSTOM_QUICK_COMMAND_SLOTS);
    expect(CUSTOM_QUICK_COMMAND_SLOTS).toBe(3);
    expect(customs.map((c) => (c.kind === 'custom' ? c.slot : -1))).toEqual([0, 1, 2]);
  });

  it('migrates legacy single quickCommand into slot 0', () => {
    expect(
      normalizeCustomQuickCommands({
        quickCommand: { label: '集合', message: '回來' },
      }),
    ).toEqual([
      { label: '集合', message: '回來' },
      null,
      null,
    ]);
  });

  it('reads multi-slot quickCommands array', () => {
    expect(
      normalizeCustomQuickCommands({
        quickCommands: [
          { label: 'A', message: 'a' },
          null,
          { label: 'C', message: 'c' },
        ],
      }),
    ).toEqual([
      { label: 'A', message: 'a' },
      null,
      { label: 'C', message: 'c' },
    ]);
  });

  it('serializes slots for profile write including legacy key', () => {
    expect(
      accountPreferencesFromSlots([
        { label: 'A', message: 'a' },
        null,
        { label: 'C', message: 'c' },
      ]),
    ).toEqual({
      quickCommands: [
        { label: 'A', message: 'a' },
        null,
        { label: 'C', message: 'c' },
      ],
      quickCommand: { label: 'A', message: 'a' },
    });
  });
});
