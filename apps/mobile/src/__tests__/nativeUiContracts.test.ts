import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAP_SHEET_ACTION_HIT_SIZE,
  MAP_SHEET_ACTION_ICON_SIZE,
  MAP_SHEET_ACTION_VISUAL_SIZE,
  MAP_SHEET_CORNER_RADIUS,
} from '../components/mapSheetChrome';

const root = join(__dirname, '..');
const tabsIos = readFileSync(join(root, 'screens/MapScreen/components/SheetPaneTabs.ios.tsx'), 'utf8');
const tabsNative = readFileSync(
  join(__dirname, '../../modules/hither-sheet-pane-tabs/ios/HitherSheetPaneTabsModule.swift'),
  'utf8',
);
const settingsIos = readFileSync(join(root, 'screens/MapScreen/components/SettingsChildSheet.ios.tsx'), 'utf8');
const sheetPresentationIos = readFileSync(join(root, 'components/SheetPresentation.ios.tsx'), 'utf8');
const settingsPanel = readFileSync(join(root, 'screens/MapScreen/components/SettingsSheetPanel.tsx'), 'utf8');
const settings = readFileSync(join(root, 'screens/MapScreen/components/SettingsOverlay.tsx'), 'utf8');
const bottomSheet = readFileSync(join(root, 'components/BottomSheet.tsx'), 'utf8');
const overlaySheet = readFileSync(join(root, 'components/OverlaySheet.tsx'), 'utf8');
const nativeGlassButtonIos = readFileSync(join(root, 'components/NativeGlassButton.ios.tsx'), 'utf8');
const paywallSheet = readFileSync(join(root, 'components/PaywallSheet.tsx'), 'utf8');
const sheetHeaderAction = readFileSync(join(root, 'components/SheetHeaderAction.ios.tsx'), 'utf8');
const sheetHeaderActionContent = readFileSync(join(root, 'components/SheetHeaderActionContent.ios.tsx'), 'utf8');
const premiumBanner = readFileSync(join(root, 'components/PremiumBanner.tsx'), 'utf8');
const app = readFileSync(join(__dirname, '../../App.tsx'), 'utf8');
const mapScreen = readFileSync(join(root, 'screens/MapScreen.tsx'), 'utf8');
const toolsPane = readFileSync(join(root, 'screens/MapScreen/components/ToolsPane.tsx'), 'utf8');
const membersPane = readFileSync(join(root, 'screens/MapScreen/components/MembersPane.tsx'), 'utf8');
const memberInboxSheet = readFileSync(join(root, 'screens/MapScreen/components/MemberInboxSheet.tsx'), 'utf8');
const inviteMembersOverlay = readFileSync(join(root, 'screens/MapScreen/components/InviteMembersOverlay.tsx'), 'utf8');
const routeEditorSheet = readFileSync(join(root, 'screens/MapScreen/components/RouteEditorSheet.tsx'), 'utf8');
const addPlaceCard = readFileSync(join(root, 'screens/MapScreen/components/AddPlaceConfirmCard.tsx'), 'utf8');
const mapStyles = readFileSync(join(root, 'screens/MapScreen/styles.ts'), 'utf8');
const inviteSheetIos = readFileSync(join(root, 'screens/MapScreen/components/InviteMembersSheet.ios.tsx'), 'utf8');
const inviteSheet = readFileSync(join(root, 'screens/MapScreen/components/InviteMembersSheet.tsx'), 'utf8');

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

  it('presents iOS settings through SwiftUI, including single-stage settings', () => {
    expect(settingsIos).toContain("from '../../../components/SheetPresentation'");
    expect(settingsIos).toContain('<SheetPresentation');
    expect(settingsIos).not.toContain('<SettingsSheetPanel');
    expect(sheetPresentationIos).toContain("from '@expo/ui/swift-ui'");
    expect(sheetPresentationIos).toContain('<BottomSheet');
  });

  it('keeps avatar choices within a centered grid and horizontally scrolls colors', () => {
    expect(settings).toContain('<ScrollView');
    expect(settings).toContain('horizontal');
    expect(settings).toContain('maxWidth: 300');
    expect(settings).toContain('alignSelf: \'center\'');
  });

  it('leaves map glass to one native material surface', () => {
    expect(bottomSheet).toContain("glass.sheetOpaque : undefined");
    expect(bottomSheet).toContain('useSwiftUIGlassSurface');
    expect(bottomSheet).not.toContain('surfaceOpacity');
    expect(bottomSheet).not.toContain('tintColor="transparent"');
  });

  it('uses the Stage 2 native material for the gathering-point reorder overlay only', () => {
    expect(overlaySheet).toContain("material?: 'default' | 'mapSheet'");
    expect(overlaySheet).toContain("material === 'mapSheet'");
    expect(overlaySheet).toContain('glass.sheet');
    const routeOverlay = routeEditorSheet.slice(routeEditorSheet.indexOf("visible={overlay === 'route'}"));
    expect(routeOverlay).toContain('material="mapSheet"');
  });

  it('keeps native close controls circular and icon-only', () => {
    expect(nativeGlassButtonIos).toContain('buttonBorderShape(shape)');
    // The requested SwiftUI control size is an explicit override. The derived
    // value remains a geometry hint for icon sizing, not a forced modifier.
    expect(nativeGlassButtonIos).toContain('const controlSizeValue = requestedControlSize');
    expect(nativeGlassButtonIos).toContain(
      '...(requestedControlSize ? [controlSize(requestedControlSize)] : [])',
    );
    expect(nativeGlassButtonIos).not.toContain('controlSize(controlSizeValue)');
    expect(nativeGlassButtonIos).toContain('const iconOnly = Boolean(!label)');
    expect(nativeGlassButtonIos).toContain('<Image');
    expect(nativeGlassButtonIos).not.toContain("labelStyle('iconOnly' as const)");
    expect(overlaySheet).toContain('doneSystemImage');
    expect(overlaySheet).not.toContain('NativeGlassButton');
    expect(overlaySheet).toContain('<Pressable');
    expect(overlaySheet).toContain('<SheetHeaderAction');
    expect(sheetHeaderAction).toContain('SheetHeaderActionContent');
    expect(settingsIos).toContain('<SheetHeaderAction');
    expect(sheetHeaderActionContent).toContain("buttonBorderShape('circle')");
    expect(sheetHeaderActionContent).toContain('MAP_SHEET_ACTION_VISUAL_SIZE');
    expect(sheetHeaderActionContent).toContain('MAP_SHEET_ACTION_HIT_SIZE');
    expect(sheetHeaderActionContent).toContain('MAP_SHEET_ACTION_ICON_SIZE');
    expect(overlaySheet).toContain('paddingHorizontal: SHEET_CORNER_ACTION_INSET');
    expect(overlaySheet).toContain('headerActionSlot');
    expect(settingsPanel).toContain('width: MAP_SHEET_ACTION_HIT_SIZE');
    expect({
      visual: MAP_SHEET_ACTION_VISUAL_SIZE,
      hit: MAP_SHEET_ACTION_HIT_SIZE,
      icon: MAP_SHEET_ACTION_ICON_SIZE,
      cornerRadius: MAP_SHEET_CORNER_RADIUS,
    }).toEqual({ visual: 44, hit: 44, icon: 17, cornerRadius: 32 });
    expect(paywallSheet).toContain('action="close"');
    expect(routeEditorSheet).toContain('doneSystemImage="checkmark"');
    expect(overlaySheet).toContain("onDone ? 'checkmark' : 'xmark'");
  });

  it('uses the native settings sheet for iOS invites and the overlay for Android', () => {
    expect(inviteMembersOverlay).toContain('<InviteMembersSheet');
    expect(inviteSheetIos).toContain('<SettingsChildSheet');
    expect(inviteSheet).toContain('<OverlaySheet');
  });

  it('uses native glass controls for map chrome and limits haptics to Premium', () => {
    expect(mapScreen).toContain('group?.avatar');
    expect(mapScreen).toContain('<MapRecenterControl');
    expect(membersPane).toContain('testID="members-location-sharing"');
    expect(premiumBanner).toContain('lightTap();');
    expect(settings).not.toMatch(/(?:lightTap|mediumTap|selectionTick|rigidTap|alertBuzz)\s*\(/);
  });

  it('keeps tools and add-place controls at their requested dimensions', () => {
    expect(toolsPane).toContain('testID="tools-enter-passive"');
    expect(mapStyles).toContain('PASSIVE_ENTER_HEIGHT = 65');
    expect(mapStyles).toContain('height: PASSIVE_ENTER_HEIGHT');
    expect(mapStyles).toContain('borderRadius: PASSIVE_ENTER_HEIGHT / 2');
    expect(mapStyles).toContain("width: '100%'");
    expect(addPlaceCard).toContain('styles.confirmControl');
    expect(mapStyles).toContain('width: 60');
    expect(mapStyles).toContain('height: 60');
    expect(mapStyles).toContain('paddingTop: 10');
    expect(memberInboxSheet).toContain('paddingBottom: 10');
    expect(mapScreen).not.toContain('height={96}');
    expect(mapStyles).toContain('marginTop: 6');
  });

  it('forces dark mode at the RN and SwiftUI boundaries', () => {
    expect(app).toContain("Appearance.setColorScheme('dark')");
    expect(sheetPresentationIos).toContain('colorScheme="dark"');
    expect(nativeGlassButtonIos).toContain('colorScheme="dark"');
    expect(sheetHeaderAction).toContain('<Host');
    expect(sheetHeaderAction).toContain('colorScheme="dark"');
  });
});
