import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GATHER_CMD_MIN_HIT_PT,
  layoutGatherCommandWidths,
} from '../utils/gatherCommandLayout';

const map = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');
const layout = readFileSync(join(__dirname, '../utils/gatherCommandLayout.ts'), 'utf8');

describe('responsive gather card tokens (#176)', () => {
  it('enforces 44pt min hit targets and Start fills Arrived slot', () => {
    expect(GATHER_CMD_MIN_HIT_PT).toBe(44);
    const l = layoutGatherCommandWidths({
      rowWidth: 300,
      baseGap: 8,
      squareSize: 48,
      countdownBaseWidth: 64,
      showNav: true,
      showArrived: false,
      narrow: true,
    });
    expect(l.navWidth!).toBeGreaterThanOrEqual(GATHER_CMD_MIN_HIT_PT);
    expect(l.order).toEqual(['nav', 'arrived', 'countdown', 'transport']);
  });

  it('does not branch on device model strings', () => {
    expect(map).not.toMatch(/iPhone\s*17/i);
    expect(map).not.toMatch(/deviceModel|Device\.modelName/);
    expect(layout).not.toMatch(/iPhone|deviceModel/);
  });

  it('Start is not forced square when Arrived is absent', () => {
    expect(map).toContain('navIconOnly = chromeTight && showArrivalControl');
  });
});
