import { commandTypesWithCustomSlot, normalizeCustomQuickCommand } from '../types';

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
});
