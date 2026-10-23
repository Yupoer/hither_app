import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useFontLayout, useFontScaleBucket } from '../a11y/useFontScaleBucket';

const mockPlatform = { OS: 'ios' };
let mockWindowScale = 1;
let mockPixelScale = 1;
let mockTextScale = 1;
const mockAppListeners = new Set<(state: string) => void>();
const mockDimensionListeners = new Set<() => void>();
const mockBoldListeners = new Set<(enabled: boolean) => void>();
const mockReadBold = jest.fn<Promise<boolean> | undefined, []>();
jest.mock('react-native', () => ({
  Platform: { get OS() { return mockPlatform.OS; } },
  useWindowDimensions: () => ({ fontScale: mockWindowScale }),
  PixelRatio: { getFontScale: () => mockPixelScale },
  AppState: { addEventListener: (_: string, listener: (state: string) => void) => {
    mockAppListeners.add(listener);
    return { remove: () => mockAppListeners.delete(listener) };
  } },
  Dimensions: { addEventListener: (_: string, listener: () => void) => {
    mockDimensionListeners.add(listener);
    return { remove: () => mockDimensionListeners.delete(listener) };
  } },
  AccessibilityInfo: {
    isBoldTextEnabled: () => mockReadBold(),
    isHighTextContrastEnabled: () => mockReadBold(),
    addEventListener: (_: string, listener: (enabled: boolean) => void) => {
      mockBoldListeners.add(listener);
      return { remove: () => mockBoldListeners.delete(listener) };
    },
  },
}));
jest.mock('../state/PreferencesContext', () => ({ usePreferences: () => ({ textScale: mockTextScale }) }));

function Probe() {
  return React.createElement('font-layout', { testID: 'font-layout', value: useFontLayout(), bucket: useFontScaleBucket() });
}

describe('live accessible font layout', () => {
  let tree: ReactTestRenderer;
  const layout = () => tree.root.findByProps({ testID: 'font-layout' }).props.value as ReturnType<typeof useFontLayout>;
  beforeEach(() => {
    mockPlatform.OS = 'ios';
    mockWindowScale = mockPixelScale = mockTextScale = 1;
    mockReadBold.mockReset().mockResolvedValue(false);
  });
  afterEach(async () => {
    await act(async () => tree?.unmount());
    expect(mockAppListeners.size).toBe(0);
    expect(mockDimensionListeners.size).toBe(0);
    expect(mockBoldListeners.size).toBe(0);
  });

  it('updates layout from system settings, app preferences and Bold Text without leaking Strict subscriptions', async () => {
    const render = () => React.createElement(React.StrictMode, null, React.createElement(Probe));
    await act(async () => { tree = create(render()); });
    expect(layout()).toMatchObject({ scale: 1, bucket: 'regular', controlMinH: 48 });
    const listenerCount = mockAppListeners.size;
    mockWindowScale = Number.NaN;
    mockPixelScale = 1.2;
    await act(async () => { for (const listener of mockDimensionListeners) listener(); });
    expect(layout().scale).toBeCloseTo(1.2);
    mockTextScale = 1.2;
    mockWindowScale = 2;
    await act(async () => tree.update(render()));
    expect(layout()).toMatchObject({ scale: 1.5, textScale: 1.2, bucket: 'xl', controlMinH: 72 });
    expect(layout().s(10, 44)).toBe(44);
    expect(tree.root.findByProps({ testID: 'font-layout' }).props.bucket).toBe('xl');
    mockWindowScale = mockTextScale = 1;
    await act(async () => {
      tree.update(render());
      for (const listener of mockBoldListeners) listener(true);
    });
    expect(layout().scale).toBeCloseTo(1.12);
    expect(layout().boldText).toBe(true);
    expect(mockAppListeners.size).toBe(listenerCount);
  });

  it('refreshes Android contrast only on foreground and tolerates an unavailable native probe', async () => {
    mockPlatform.OS = 'android';
    mockPixelScale = mockWindowScale = Number.NaN;
    await act(async () => { tree = create(React.createElement(Probe)); });
    expect(layout().scale).toBe(1);
    const reads = mockReadBold.mock.calls.length;
    await act(async () => { for (const listener of mockAppListeners) listener('background'); });
    expect(mockReadBold).toHaveBeenCalledTimes(reads);
    mockReadBold.mockResolvedValue(true);
    await act(async () => { for (const listener of mockAppListeners) listener('active'); });
    expect(layout().boldText).toBe(true);
    expect(layout().scale).toBeCloseTo(1.12);
    mockReadBold.mockRejectedValue(new Error('native accessibility unavailable'));
    await act(async () => { for (const listener of mockAppListeners) listener('active'); });
    expect(layout().boldText).toBe(true);
    mockReadBold.mockReturnValue(undefined);
    await act(async () => { for (const listener of mockAppListeners) listener('active'); });
    expect(layout().boldText).toBe(true);
  });
});
