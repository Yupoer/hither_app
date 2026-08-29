import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const tabsIos = readFileSync(join(root, 'screens/MapScreen/components/SheetPaneTabs.ios.tsx'), 'utf8');
const tabsNative = readFileSync(
  join(__dirname, '../../modules/hither-sheet-pane-tabs/ios/HitherSheetPaneTabsModule.swift'),
  'utf8',
);
const settingsIos = readFileSync(join(root, 'screens/MapScreen/components/SettingsChildSheet.ios.tsx'), 'utf8');
const settingsPanel = readFileSync(join(root, 'screens/MapScreen/components/SettingsSheetPanel.tsx'), 'utf8');
const settings = readFileSync(join(root, 'screens/MapScreen/components/SettingsOverlay.tsx'), 'utf8');
const bottomSheet = readFileSync(join(root, 'components/BottomSheet.tsx'), 'utf8');
const overlaySheet = readFileSync(join(root, 'components/OverlaySheet.tsx'), 'utf8');
const nativeGlassButtonIos = readFileSync(join(root, 'components/NativeGlassButton.ios.tsx'), 'utf8');
const paywallSheet = readFileSync(join(root, 'components/PaywallSheet.tsx'), 'utf8');
const premiumBanner = readFileSync(join(root, 'components/PremiumBanner.tsx'), 'utf8');
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
    expect(settingsIos).toContain('SettingsSheetPanel');
    expect(settingsIos).toContain('if (props.singleStage) return <SettingsSheetPanel {...props} />');
    expect(settingsPanel).toContain('singleStage');
    expect(settingsPanel).toContain('[Math.round(height * stageTwoRatio)]');
    expect(settingsPanel).toContain('SETTINGS_CLOSE_SIZE = 60');
    expect(settingsPanel).toContain('dismissOnDownFromIndex={0}');
    expect(settingsPanel).toContain('edgeToEdgeAtLast={edgeToEdgeAtLast}');
    expect(settingsPanel).toContain('dismissTranslateY={sheetTranslateY}');
    expect(settingsPanel).toContain('dismissRequested={visible}');
    expect(settingsIos).toContain('fraction: STAGE_ONE_RATIO');
    expect(settingsIos).toContain('fraction: stageTwoRatio');
    expect(settingsIos).toContain('presentationDetents(');
    expect(settingsIos).toContain('[stageOneDetent, stageTwoDetent]');
    expect(settingsIos).toContain('selection: initialStage === 1 ? stageTwoDetent : stageOneDetent');
    expect(settingsIos).not.toContain('presentationDetents([detent]');
    expect(settingsIos).toContain('closeStartedRef');
    expect(settingsIos).toContain('if (!presented && visible)');
    expect(settingsIos).not.toContain('chevron-back');
    expect(settingsIos).toContain('paddingTop: 12');
    expect(settingsIos).toContain("buttonBorderShape('circle')");
    expect(settingsIos).not.toContain("controlSize('extraLarge')");
    expect(settingsIos).toContain('<Image');
    expect(settingsIos).toContain('frame({ width: 60, height: 60 })');
    expect(settingsIos).toContain('frame({ width: 28, height: 28 })');
    expect(settingsIos).not.toContain('frame({ width: 78, height: 78 })');
    expect(settingsIos).toContain("action === 'commit' ? 'checkmark' : 'xmark'");
    expect(settingsIos).toContain('<VStack');
    expect(settingsIos.indexOf('</HStack>')).toBeLessThan(settingsIos.indexOf('<RNHostView'));
    expect(settingsIos).toContain('wrapContentInScrollView');
    expect(settingsIos).toContain('nestedLayer');
    expect(settingsIos).not.toContain('colorScheme="dark"');
    expect(settingsIos).toContain("pointerEvents={visible ? 'auto' : 'none'}");
    expect(settings).toContain("page === 'account'");
    expect(settings).toContain('<AccountSheetContent');
    expect(settings).toContain('wrapContentInScrollView={false}');
    expect(settings).toContain('singleStage');
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
    expect(bottomSheet).toContain("glass.sheetOpaque : undefined");
    expect(bottomSheet).toContain('surfaceOpacity={surfaceOpacity}');
    expect(bottomSheet).not.toContain('tintColor="transparent"');
  });

  it('uses the Stage 2 native material for the gathering-point reorder overlay only', () => {
    expect(overlaySheet).toContain("material?: 'default' | 'mapSheet'");
    expect(overlaySheet).toContain("material === 'mapSheet'");
    expect(overlaySheet).toContain('glass.sheet');
    const routeOverlay = mapScreen.slice(
      mapScreen.indexOf("visible={overlay === 'route'}"),
      mapScreen.indexOf('<GroupFeatureTourOverlay', mapScreen.indexOf("visible={overlay === 'route'}")),
    );
    expect(routeOverlay).toContain('material="mapSheet"');
  });

  it('keeps native close controls circular and icon-only', () => {
    expect(nativeGlassButtonIos).toContain('buttonBorderShape(shape)');
    expect(nativeGlassButtonIos).toContain('controlSize(controlSizeValue)');
    expect(nativeGlassButtonIos).toContain('<Image');
    expect(nativeGlassButtonIos).toContain("labelStyle('iconOnly' as const)");
    expect(overlaySheet).toContain('doneSystemImage');
    expect(overlaySheet).not.toContain('NativeGlassButton');
    expect(overlaySheet).toContain('<Pressable');
    expect(overlaySheet).toContain('<Ionicons name={headerIcon} size={28}');
    expect(overlaySheet).toContain('width: 60');
    expect(overlaySheet).toContain('height: 60');
    expect(overlaySheet).toContain('minWidth: 60');
    expect(paywallSheet).toContain('systemImage="xmark"');
    expect(mapScreen).toContain('doneSystemImage="xmark"');
    expect(overlaySheet).toContain("onDone ? 'checkmark' : 'xmark'");
  });

  it('uses native glass controls for map chrome and limits haptics to Premium', () => {
    expect(mapScreen).toContain('group?.avatar');
    expect(mapScreen).toContain('<MapRecenterControl');
    expect(mapScreen).toContain('testID="members-location-sharing"');
    expect(premiumBanner).toContain('lightTap();');
    expect(settings).not.toMatch(/(?:lightTap|mediumTap|selectionTick|rigidTap|alertBuzz)\s*\(/);
  });

  it('keeps tools and add-place controls at their requested dimensions', () => {
    expect(mapScreen).toContain('testID="tools-enter-passive"');
    expect(mapScreen).toContain('height: 162');
    expect(mapScreen).toContain("width: '100%'");
    expect(mapScreen).toContain('styles.confirmControl');
    expect(mapScreen).toContain('width: 60');
    expect(mapScreen).toContain('height: 60');
    expect(mapScreen).toContain('paddingTop: 10');
    expect(mapScreen).toContain('paddingBottom: 10');
    expect(mapScreen).not.toContain('height={96}');
    expect(mapScreen).toContain('marginTop: 6');
  });
});
