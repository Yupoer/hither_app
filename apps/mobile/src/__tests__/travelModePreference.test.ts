import React from 'react';
import { act, create } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PreferencesProvider, usePreferences } from '../state/PreferencesContext';
import { useCarouselSelection } from '../screens/MapScreen/hooks/useCarouselSelection';
import type { TravelMode } from '../utils/geo';

const mockStorage = new Map<string, string>();
let mockRead: ((keys: readonly string[]) => Promise<[string, string | null][]>) | undefined;
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true, default: {
    multiGet: jest.fn((keys: string[]) => mockRead ? mockRead(keys)
      : Promise.resolve(keys.map(key => [key, mockStorage.get(key) ?? null]))),
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockStorage.delete(key); }),
  },
}));
jest.mock('../state/diagnosticConsent', () => ({
  getDiagnosticConsentEnabled: async () => false, isDiagnosticConsentEnabled: () => false,
  setDiagnosticConsentEnabled: async () => {},
}));
jest.mock('../utils/activityLog', () => ({ logEvent: jest.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let preferences: ReturnType<typeof usePreferences>;
let selection: ReturnType<typeof useCarouselSelection>;
const carouselRef = { current: null };
const mapRef = { current: null };
function Harness() {
  const currentPreferences = usePreferences();
  const currentSelection = useCarouselSelection({ destinations: [], windowWidth: 390, carouselRef, mapRef });
  React.useLayoutEffect(() => {
    preferences = currentPreferences;
    selection = currentSelection;
  }, [currentPreferences, currentSelection]);
  return null;
}
function app(show = true) {
  return React.createElement(PreferencesProvider, null, show ? React.createElement(Harness) : null);
}
beforeEach(() => { mockStorage.clear(); mockRead = undefined; jest.clearAllMocks(); });

it.each<TravelMode>(['walk', 'drive', 'transit', 'bicycle'])('persists %s through screen remount and cold provider restart', async mode => {
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(app()); });
  expect(preferences.ready).toBe(true);
  await act(async () => selection.setTravelMode(mode));
  expect(AsyncStorage.setItem).toHaveBeenCalledWith('pref.travelMode', mode);
  await act(async () => tree.update(app(false)));
  await act(async () => tree.update(app()));
  expect(selection.travelMode).toBe(mode);
  await act(async () => tree.unmount());
  await act(async () => { tree = create(app()); });
  expect(preferences.ready).toBe(true);
  expect(selection.travelMode).toBe(mode);
  await act(async () => tree.unmount());
});

it.each([null, 'bike', 'flying', 'BICYCLE', ''])('defaults unknown legacy stored mode %p to walk', async stored => {
  if (stored != null) mockStorage.set('pref.travelMode', stored);
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(app()); });
  expect(preferences.ready).toBe(true);
  expect(selection.travelMode).toBe('walk');
  // Loading a default must not overwrite storage or trigger a spurious choice.
  expect(AsyncStorage.setItem).not.toHaveBeenCalledWith('pref.travelMode', expect.anything());
  await act(async () => tree.unmount());
});

it('keeps user choice when a delayed hydration returns an older stored mode', async () => {
  let resolve!: (rows: [string, string | null][]) => void;
  let capturedKeys: readonly string[] = [];
  mockRead = keys => { capturedKeys = keys; return new Promise(done => { resolve = done; }); };
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(app()); });
  expect(preferences.ready).toBe(false);
  await act(async () => selection.setTravelMode('bicycle'));
  expect(selection.travelMode).toBe('bicycle');
  await act(async () => { resolve(capturedKeys.map(key => [key, key === 'pref.travelMode' ? 'drive' : null])); });
  expect(preferences.ready).toBe(true);
  expect(selection.travelMode).toBe('bicycle');
  expect(mockStorage.get('pref.travelMode')).toBe('bicycle');
  await act(async () => preferences.setLanguage('en'));
  await act(async () => tree.update(app()));
  expect(selection.travelMode).toBe('bicycle');
  await act(async () => tree.unmount());
});

it('restores an untouched stored choice after async hydration', async () => {
  let resolve!: (rows: [string, string | null][]) => void;
  let keys: readonly string[] = [];
  mockRead = incoming => { keys = incoming; return new Promise(done => { resolve = done; }); };
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(app()); });
  expect(selection.travelMode).toBe('walk');
  await act(async () => { resolve(keys.map(key => [key, key === 'pref.travelMode' ? 'transit' : null])); });
  expect(selection.travelMode).toBe('transit');
  await act(async () => tree.unmount());
});
