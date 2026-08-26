import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const tabsIos = readFileSync(join(root, 'screens/MapScreen/components/SheetPaneTabs.ios.tsx'), 'utf8');
const tabsNative = readFileSync(
  join(__dirname, '../../modules/hither-sheet-pane-tabs/ios/HitherSheetPaneTabsModule.swift'),
  'utf8',
);
const settingsIos = readFileSync(join(root, 'screens/MapScreen/components/SettingsChildSheet.ios.tsx'), 'utf8');
const settings = readFileSync(join(root, 'screens/MapScreen/components/SettingsOverlay.tsx'), 'utf8');
const bottomSheet = readFileSync(join(root, 'components/BottomSheet.tsx'), 'utf8');
const overlaySheet = readFileSync(join(root, 'components/OverlaySheet.tsx'), 'utf8');
const mapScreen = readFileSync(join(root, 'screens/MapScreen.tsx'), 'utf8');

describe('iOS native UI contracts', () => {
  it('uses the minimum native bridge for the iOS Liquid Glass selector', () => {
    expect(tabsIos).toContain("requireNativeView<NativeSheetPaneTabsProps>('HitherSheetPaneTabs')");
    expect(tabsIos).not.toContain('requireNativeViewManager');
    expect(tabsIos).toContain('HitherSheetPaneTabs');
    expect(tabsIos).toContain('labels={labels}');
    expect(tabsIos).toContain('selectedIndex={selectedIndex}');
    expect(tabsIos).toContain('onSelectionChange={handleSelectionChange}');
    expect(tabsNative).toContain('ExpoSwiftUI.WithHostingView');
    expect(tabsNative).toContain('GlassEffectContainer');
    expect(tabsNative).toContain('.glassEffect(.clear');
    expect(tabsNative).toContain('.regular.interactive()');
    expect(tabsNative).toContain('.glassEffectID("sheet-pane-track"');
    expect(tabsNative).toContain('.glassEffectID("sheet-pane-indicator"');
    expect(tabsNative).toContain('.offset(x: indicatorOffset(for: width))');
    expect(tabsNative.indexOf('.regular.interactive()')).toBeLessThan(
      tabsNative.indexOf('.offset(x: indicatorOffset(for: width))'),
    );
    expect(tabsNative).toContain('DragGesture(minimumDistance: 8');
    expect(tabsNative).toContain('abs(value.translation.width) > abs(value.translation.height)');
    expect(tabsNative).toContain('clampedCenter(value.location.x, width: width)');
    expect(tabsNative).toContain('emitSelectionIfNeeded(target)');
    const dragChangedBlock = tabsNative.slice(
      tabsNative.indexOf('.onChanged'),
      tabsNative.indexOf('.onEnded'),
    );
    expect(dragChangedBlock).not.toContain('onSelectionChange');
    expect(dragChangedBlock).not.toContain('emitSelectionIfNeeded');
    expect(tabsNative).not.toContain('UIVisualEffectView');
    expect(tabsNative).not.toContain('BlurView');
    expect(tabsNative).not.toContain('rgba');
    expect(tabsNative).not.toContain('gradient');
    expect(tabsNative).not.toContain('shadow');
    expect(tabsNative).not.toContain('strokeBorder');
    expect(tabsNative).not.toContain('.tint(');
    expect(tabsNative).not.toContain('buttonStyle');
    expect(tabsNative).not.toContain('Button(');
    expect(tabsNative).toContain('person.2.fill');
    expect(tabsNative).toContain('map.fill');
    expect(tabsNative).toContain('wrench.and.screwdriver.fill');
    expect(tabsNative).toContain('bag.fill');
    expect(tabsNative).not.toContain('Text(');
    expect(tabsNative).not.toContain('VStack(');
    expect(tabsNative).toContain('.font(.system(size: 23, weight: .semibold))');
    expect(tabsNative).toContain('.opacity(index == highlightedIndex ? 1 : 0.65)');
    expect(tabsNative).toContain('previewIndex(for: width)');
    expect(tabsNative).toContain('sheetPaneIndicatorWidthRatio: CGFloat = 0.88');
    expect(tabsNative).toContain('sheetPaneSelectorHeight: CGFloat = 54');
    expect(tabsNative).toContain('sheetPaneIndicatorHeight: CGFloat = 46');
    expect(tabsNative).toContain('Capsule()');
    expect(tabsNative).toContain('ultraThinMaterial');
  });

  it('uses native detents and one guarded close path for settings sheets', () => {
    expect(settingsIos).toContain("from '@expo/ui/swift-ui'");
    expect(settingsIos).toContain('BottomSheet');
    expect(settingsIos).toContain('fraction: initialStage === 1 ? stageTwoRatio : STAGE_ONE_RATIO');
    expect(settingsIos).toContain('closeStartedRef');
    expect(settingsIos).toContain('if (!presented && visible)');
    expect(settingsIos).not.toContain('chevron-back');
    expect(settingsIos).toContain('paddingTop: 12');
    expect(settingsIos).not.toContain('glassEffect({ glass: { variant: \'clear\' }');
    expect(settingsIos).toContain('frame({ width: 44, height: 44 })');
    expect(settingsIos).toContain('frame({ width: 36, height: 36 })');
    expect(settingsIos).toContain('size={22}');
    expect(settingsIos).toContain('<VStack');
    expect(settingsIos.indexOf('</HStack>')).toBeLessThan(settingsIos.indexOf('<RNHostView'));
    expect(settingsIos).toContain('wrapContentInScrollView');
    expect(settingsIos).toContain('nestedLayer');
    expect(settingsIos).not.toContain('colorScheme="dark"');
    expect(settingsIos).toContain("pointerEvents={visible ? 'auto' : 'none'}");
    expect(settings).toContain("page === 'account'");
    expect(settings).toContain('<AccountSheetContent');
    expect(settings).toContain('wrapContentInScrollView={false}');
    expect(settings).toContain('stageTwoRatio={0.9}');
    expect(settings).toContain('stageTwoRatio={0.8}');
  });

  it('keeps avatar choices within a centered grid and horizontally scrolls colors', () => {
    expect(settings).toContain('<ScrollView');
    expect(settings).toContain('horizontal');
    expect(settings).toContain('width: 300');
    expect(settings).toContain('alignSelf: \'center\'');
  });

  it('leaves map glass to one native material surface', () => {
    expect(bottomSheet).toContain("tintColor={Platform.OS === 'android' ? glass.sheetOpaque : undefined}");
    expect(bottomSheet).not.toContain('tintColor="transparent"');
  });

  it('uses the Stage 2 native material for the gathering-point reorder overlay only', () => {
    expect(overlaySheet).toContain("material?: 'default' | 'mapSheet'");
    expect(overlaySheet).toContain("material === 'mapSheet' && Platform.OS === 'ios'");
    const routeOverlay = mapScreen.slice(
      mapScreen.indexOf("visible={overlay === 'route'}"),
      mapScreen.indexOf('<GroupFeatureTourOverlay', mapScreen.indexOf("visible={overlay === 'route'}")),
    );
    expect(routeOverlay).toContain('material="mapSheet"');
  });
});
