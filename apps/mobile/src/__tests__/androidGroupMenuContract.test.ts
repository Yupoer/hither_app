import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');

describe('Android group menu contract', () => {
  it('keeps Android Alert within the three-button platform limit with visible cancel', () => {
    const openIdx = source.indexOf('const openGroupMenu');
    const elseIdx = source.indexOf('} else {', openIdx);
    const androidBranch = source.slice(
      elseIdx,
      source.indexOf('\n    }', elseIdx),
    );
    expect(androidBranch).toContain("t('map.overlaySettings')");
    expect(androidBranch).toContain("t('group.leave')");
    expect(androidBranch).toContain("t('common.cancel')");
    expect(androidBranch).not.toContain("t('map.backToHome')");
    expect(androidBranch).toContain('cancelable: true');
  });
});
