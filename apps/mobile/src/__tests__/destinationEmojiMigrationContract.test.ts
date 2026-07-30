import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(
    __dirname,
    '../../../../supabase/migrations/20260730000000_destination_emoji_color_arrival_notify.sql',
  ),
  'utf8',
);

describe('destination emoji SQL trust boundary (Spec3 / CR)', () => {
  it('replaces length-only check with shape constraint', () => {
    expect(migration).toContain('itinerary_items_emoji_shape');
    expect(migration).toContain('char_length(emoji) between 1 and 32');
    // Must reject pure letter / CJK runs — not length alone.
    expect(migration).toContain("emoji !~ '^[A-Za-z0-9[:space:]]+$'");
    expect(migration).toContain('一-龥');
    expect(migration).toContain('À-Ö');
    // Drop old length-only name if re-created
    expect(migration).toContain('drop constraint if exists itinerary_items_emoji_len');
  });

  it('documents app trust boundary for full emoji property', () => {
    expect(migration.toLowerCase()).toMatch(/trust boundary|extended_pictographic|client/);
  });
});
