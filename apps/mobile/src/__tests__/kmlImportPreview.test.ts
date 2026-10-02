import React from 'react';
import { act, create } from 'react-test-renderer';

jest.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', ScrollView: 'ScrollView',
  Text: 'Text', View: 'View', StyleSheet: { create: (styles: unknown) => styles },
}));
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file://fixture.kml' }] })),
}));
jest.mock('../screens/MapScreen/components/SettingsChildSheet', () => 'Sheet');
jest.mock('../i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../state/PreferencesContext', () => ({ useTheme: () => ({ colors: { accent: 'blue' } }) }));
jest.mock('../glass', () => ({ glass: {}, accentMix: () => 'blue' }));
jest.mock('../native', () => ({ kmlIo: { createDefaultKmlLoadIo: jest.fn() } }));
jest.mock('../state/diagnostics', () => ({ diagnostics: { write: jest.fn() } }));
jest.mock('../utils/kmlLoad', () => ({
  loadKmlKmzFromAsset: jest.fn(async () => ({
    kind: 'success', items: Array.from({ length: 101 }, (_, i) => ({ name: `Point ${i}`, latitude: 25, longitude: 121 })),
  })),
}));

import KmlImportSheet from '../components/KmlImportSheet';

it('previews and submits only 100 Premium points with a batch notice and no upgrade prompt', async () => {
  jest.useFakeTimers();
  const onImport = jest.fn(async (_items: Array<{ name: string }>) => undefined);
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(React.createElement(KmlImportSheet, {
      visible: true, onClose: jest.fn(), currentCount: 0, isPro: true,
      onImport, onUpgrade: jest.fn(),
    }));
  });
  await act(async () => { await tree.root.findByType('Pressable' as never).props.onPress(); });
  expect(JSON.stringify(tree.toJSON())).toContain('kml.batchLimit');
  expect(JSON.stringify(tree.toJSON())).not.toContain('kml.lockedNote');
  await act(async () => { await tree.root.findByType('Pressable' as never).props.onPress(); });
  expect(onImport).toHaveBeenCalledTimes(1);
  expect(onImport.mock.calls[0][0]).toHaveLength(100);
  expect(onImport.mock.calls[0][0][99].name).toBe('Point 99');
  await act(async () => tree.unmount());
  jest.clearAllTimers();
  jest.useRealTimers();
});
