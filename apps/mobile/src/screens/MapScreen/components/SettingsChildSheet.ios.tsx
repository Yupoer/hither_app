import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  BottomSheet,
  Button,
  Group,
  HStack,
  Host,
  Image,
  RNHostView,
  Spacer,
  Text as SwiftText,
  VStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonStyle,
  buttonBorderShape,
  frame,
  font,
  glassEffect,
  labelStyle,
  padding,
  presentationDetents,
  presentationDragIndicator,
} from '@expo/ui/swift-ui/modifiers';
import { liquidGlass } from '../../../native';
import {
  MAP_SHEET_CLOSE_HIT_SIZE,
  MAP_SHEET_CLOSE_ICON_SIZE,
  MAP_SHEET_CLOSE_VISUAL_SIZE,
} from '../../../components/mapSheetChrome';
import SettingsSheetPanel, { type SettingsSheetPanelProps } from './SettingsSheetPanel';

const STAGE_ONE_RATIO = 0.52;
const STAGE_TWO_RATIO = 0.8;

type SettingsChildSheetProps = SettingsSheetPanelProps;

/** Main settings uses RN for exact edge-to-edge geometry; child pages stay native. */
export default function SettingsChildSheet(props: SettingsChildSheetProps) {
  if (props.singleStage) return <SettingsSheetPanel {...props} />;
  return <NativeSettingsChildSheet {...props} />;
}

/** iOS child settings sheets remain system SwiftUI sheets. */
function NativeSettingsChildSheet({
  visible,
  onClose,
  onDismissComplete,
  action = 'close',
  doneLabel = action === 'close' ? 'close' : 'commit',
  onCommit,
  title,
  children,
  initialStage = 0,
  stageTwoRatio = STAGE_TWO_RATIO,
  wrapContentInScrollView = true,
}: SettingsChildSheetProps) {
  const nativeChildren = React.Children.toArray(children);
  const rootContent = nativeChildren[0] ?? <View />;
  const nestedSheets = nativeChildren.slice(1);
  const stageOneDetent = useMemo(() => ({ fraction: STAGE_ONE_RATIO }), []);
  const stageTwoDetent = useMemo(() => ({ fraction: stageTwoRatio }), [stageTwoRatio]);
  const isCloseAction = action === 'close';
  const actionSlotSize = isCloseAction ? MAP_SHEET_CLOSE_HIT_SIZE : 60;
  const closeStartedRef = useRef(false);
  const dismissCompleteRef = useRef(false);
  const onDismissCompleteRef = useRef(onDismissComplete);
  onDismissCompleteRef.current = onDismissComplete;
  useEffect(() => {
    if (visible) {
      closeStartedRef.current = false;
      dismissCompleteRef.current = false;
    }
  }, [visible]);
  const closeOnce = useCallback(() => {
    if (closeStartedRef.current) return;
    closeStartedRef.current = true;
    onClose();
  }, [onClose]);
  const handlePresentedChange = useCallback((presented: boolean) => {
    // Native BottomSheet can report its initial non-presented state while a
    // hidden child host is mounting. Only a visible sheet dismissal closes the
    // owning settings page.
    if (!presented && visible) closeOnce();
  }, [closeOnce, visible]);
  const handleDismiss = useCallback(() => {
    if (visible) closeOnce();
    if (dismissCompleteRef.current) return;
    dismissCompleteRef.current = true;
    onDismissCompleteRef.current?.();
  }, [closeOnce, visible]);

  return (
    <Host
      style={styles.host}
      // Settings sheets stay mounted for native presentation transitions. A
      // hidden full-screen Host must not become a touch shield over the map.
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <BottomSheet
        isPresented={visible}
        onIsPresentedChange={handlePresentedChange}
        onDismiss={handleDismiss}
      >
        <Group
          key={visible ? `settings-presented-${initialStage}` : 'settings-hidden'}
          modifiers={[
            presentationDetents(
              [stageOneDetent, stageTwoDetent],
              { selection: initialStage === 1 ? stageTwoDetent : stageOneDetent },
            ),
            presentationDragIndicator('visible'),
            frame({ minWidth: 0, maxWidth: Infinity, minHeight: 0, maxHeight: Infinity }),
            padding({ bottom: 0 }),
          ]}
        >
          <VStack
            spacing={0}
            alignment="center"
            modifiers={[frame({ minWidth: 0, maxWidth: Infinity, minHeight: 0, maxHeight: Infinity })]}
          >
            <HStack
              spacing={0}
              alignment="center"
              modifiers={[
                padding({ top: 16, leading: 16, trailing: 16 }),
                frame({ minWidth: 0, maxWidth: 10000 }),
              ]}
            >
              <Spacer modifiers={[frame({ width: actionSlotSize, height: actionSlotSize })]} />
              <SwiftText
                modifiers={[
                  frame({ minWidth: 0, maxWidth: Infinity, minHeight: actionSlotSize, maxHeight: actionSlotSize, alignment: 'center' }),
                  font({ size: 17, weight: 'bold' }),
                ]}
              >
                {title}
              </SwiftText>
              <Button
                role={action === 'commit' ? 'default' : 'cancel'}
                onPress={action === 'commit' ? onCommit : closeOnce}
                modifiers={[
                  buttonStyle(liquidGlass.isLiquidGlassAvailable() ? 'plain' : 'bordered'),
                  buttonBorderShape('circle'),
                  ...(isCloseAction
                    ? [
                      frame({ width: MAP_SHEET_CLOSE_VISUAL_SIZE, height: MAP_SHEET_CLOSE_VISUAL_SIZE }),
                      ...(liquidGlass.isLiquidGlassAvailable()
                        ? [glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'circle' })]
                        : []),
                      frame({ width: MAP_SHEET_CLOSE_HIT_SIZE, height: MAP_SHEET_CLOSE_HIT_SIZE }),
                    ]
                    : [
                      frame({ width: 60, height: 60 }),
                      ...(liquidGlass.isLiquidGlassAvailable()
                        ? [glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'circle' })]
                        : []),
                    ]),
                  labelStyle('iconOnly'),
                  accessibilityLabel(doneLabel),
                ]}
              >
                <Image
                  systemName={action === 'commit' ? 'checkmark' : 'xmark'}
                  modifiers={[frame({
                    width: isCloseAction ? MAP_SHEET_CLOSE_ICON_SIZE : 28,
                    height: isCloseAction ? MAP_SHEET_CLOSE_ICON_SIZE : 28,
                  })]}
                />
              </Button>
            </HStack>
            <RNHostView matchContents={false}>
              <View style={styles.sheetBody}>
                {wrapContentInScrollView ? (
                  <ScrollView
                    style={styles.scroll}
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                  >
                    {initialStage === 1 ? rootContent : children}
                  </ScrollView>
                ) : (
                  <View style={styles.contentFill}>{initialStage === 1 ? rootContent : children}</View>
                )}
                {initialStage === 1 && nestedSheets.length > 0 ? (
                  <View pointerEvents="box-none" style={styles.nestedLayer}>
                    {nestedSheets}
                  </View>
                ) : null}
              </View>
            </RNHostView>
          </VStack>
        </Group>
      </BottomSheet>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  sheetBody: {
    flex: 1,
    width: '100%',
    backgroundColor: 'transparent',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  contentFill: {
    flex: 1,
  },
  nestedLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: 2,
  },
});
