import {
  ARRIVED_SPLIT_MS,
  COUNTDOWN_WIDTH_FACTOR,
  GATHER_CMD_MIN_HIT_PT,
  layoutGatherCommandWidths,
} from '../utils/gatherCommandLayout';

describe('layoutGatherCommandWidths (#148)', () => {
  it('orders controls as nav → arrived → countdown → transport', () => {
    const layout = layoutGatherCommandWidths({
      rowWidth: 340,
      baseGap: 8,
      squareSize: 48,
      countdownBaseWidth: 72,
      showNav: true,
      showArrived: true,
      narrow: false,
    });
    expect(layout.order).toEqual(['nav', 'arrived', 'countdown', 'transport']);
  });

  it('keeps arrived and transport as fixed squares', () => {
    const layout = layoutGatherCommandWidths({
      rowWidth: 340,
      baseGap: 8,
      squareSize: 48,
      countdownBaseWidth: 72,
      showNav: true,
      showArrived: true,
      narrow: false,
    });
    expect(layout.squareSize).toBe(48);
  });

  it('expands countdown to 1.5× baseline on normal width', () => {
    const base = 72;
    const layout = layoutGatherCommandWidths({
      rowWidth: 360,
      baseGap: 8,
      squareSize: 48,
      countdownBaseWidth: base,
      showNav: true,
      showArrived: true,
      narrow: false,
    });
    expect(layout.countdownWidth).toBeCloseTo(base * COUNTDOWN_WIDTH_FACTOR);
  });

  it('takes extra countdown width from the nav region', () => {
    const withoutArrived = layoutGatherCommandWidths({
      rowWidth: 360,
      baseGap: 8,
      squareSize: 48,
      countdownBaseWidth: 72,
      showNav: true,
      showArrived: false,
      narrow: false,
    });
    const withArrived = layoutGatherCommandWidths({
      rowWidth: 360,
      baseGap: 8,
      squareSize: 48,
      countdownBaseWidth: 72,
      showNav: true,
      showArrived: true,
      narrow: false,
    });
    // Countdown width stays stable; nav absorbs the arrived square.
    expect(withArrived.countdownWidth).toBe(withoutArrived.countdownWidth);
    expect(withArrived.navWidth!).toBeLessThan(withoutArrived.navWidth!);
  });

  it('never drops hit targets below 48pt', () => {
    const layout = layoutGatherCommandWidths({
      rowWidth: 280,
      baseGap: 10,
      squareSize: 44,
      countdownBaseWidth: 60,
      showNav: true,
      showArrived: true,
      narrow: true,
    });
    expect(layout.squareSize).toBeGreaterThanOrEqual(GATHER_CMD_MIN_HIT_PT);
    expect(layout.countdownWidth).toBeGreaterThanOrEqual(GATHER_CMD_MIN_HIT_PT);
    expect(layout.navWidth!).toBeGreaterThanOrEqual(GATHER_CMD_MIN_HIT_PT);
    expect(layout.gap).toBeLessThanOrEqual(6);
  });

  it('uses 220–300ms split timing constant', () => {
    expect(ARRIVED_SPLIT_MS).toBeGreaterThanOrEqual(220);
    expect(ARRIVED_SPLIT_MS).toBeLessThanOrEqual(300);
  });
});
