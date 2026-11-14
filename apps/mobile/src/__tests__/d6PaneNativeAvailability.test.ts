let mockPlatform = 'ios';
let mockModule: { supportsNativePane?: boolean } | null = null;
const mockRequireView = jest.fn((name: string, view?: string) => `${name}.${view ?? 'default'}`);
jest.mock('react-native', () => ({ Platform: { get OS() { return mockPlatform; } } }));
jest.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: () => mockModule,
  requireNativeViewManager: (name: string, view?: string) => mockRequireView(name, view),
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true, default: { createAnimatedComponent: (component: unknown) => component },
}));

function load() {
  let api: typeof import('../native/d6Pane') | undefined;
  jest.isolateModules(() => { api = jest.requireActual<typeof import('../native/d6Pane')>('../native/d6Pane'); });
  if (!api) throw new Error('Native pane binding did not load');
  return api;
}
beforeEach(() => { mockPlatform = 'ios'; mockModule = null; jest.clearAllMocks(); });

it('uses the existing panel renderer on older iOS binaries without requesting an unavailable view', () => {
  for (const module of [null, {}, { supportsNativePane: false }]) {
    mockModule = module;
    const api = load();
    expect(api.nativeD6PaneAvailable).toBe(false);
    expect(api.NativeD6PaneView).toBeNull();
    expect(api.NativeD6GradientView).toBeNull();
    expect(api.NativeD6SurfaceView).toBeNull();
  }
  expect(mockRequireView).not.toHaveBeenCalled();
});

it('uses the existing panel renderer on Android even if an iOS capability is present', () => {
  mockPlatform = 'android'; mockModule = { supportsNativePane: true };
  expect(load().nativeD6PaneAvailable).toBe(false);
  expect(mockRequireView).not.toHaveBeenCalled();
});

it('exposes the native panel and gradient only when the installed iOS binary supports both', () => {
  mockModule = { supportsNativePane: true };
  const api = load();
  expect(api.nativeD6PaneAvailable).toBe(true);
  expect(api.NativeD6PaneView).toBe('HitherMetrics.default');
  expect(api.NativeD6GradientView).toBe('HitherMetrics.PaneGradient');
  expect(api.NativeD6SurfaceView).toBe('HitherMetrics.PaneSurface');
  expect(mockRequireView.mock.calls).toEqual([['HitherMetrics', undefined], ['HitherMetrics', 'PaneGradient'], ['HitherMetrics', 'PaneSurface']]);
});
