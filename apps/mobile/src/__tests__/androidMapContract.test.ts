import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, '../components/GroupMap.tsx'), 'utf8');

describe('Android map contract', () => {
  it('selects Google provider only on Android and preserves every shared overlay', () => {
    expect(source).toContain("Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined");
    expect(source).toContain('<DestinationMarker');
    expect(source).toContain('<MemberMarker');
    expect(source).toContain('<PendingPlaceMarker');
    expect(source).toContain('<Polyline');
  });

  it('does not fork the whole map into GroupMap.android.tsx', () => {
    expect(source).toContain('onLongPressCoordinate');
    // Shared component handles long-press; no separate Android map screen file required.
    const fs = require('node:fs') as typeof import('node:fs');
    expect(fs.existsSync(join(__dirname, '../components/GroupMap.android.tsx'))).toBe(false);
  });
});
