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
  ZStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonStyle,
  buttonBorderShape,
  frame,
  font,
  padding,
  presentationDetents,
  presentationDragIndicator,
} from '@expo/ui/swift-ui/modifiers';
import { liquidGlass } from '../../../native';

const STAGE_ONE_RATIO = 0.52;
const STAGE_TWO_RATIO = 0.8;

/** iOS settings sheets are system SwiftUI sheets; Android keeps the JS fallback. */
export default function SettingsChildSheet({
  visible,
  onClose,
  onDismissComplete,
  title,
  children,
  initialStage = 0,
  stageTwoRatio = STAGE_TWO_RATIO,
  wrapContentInScrollView = true,
}: {
  visible: boolean;
  onClose: () => void;
  onDismissComplete?: () => void;
  onBack?: () => void;
  title: string;
  children: React.ReactNode;
  zIndex?: number;
  initialStage?: 0 | 1;
  stageTwoRatio?: number;
  edgeToEdgeAtLast?: boolean;
  wrapContentInScrollView?: boolean;
}) {
  const nativeChildren = React.Children.toArray(children);
  const rootContent = nativeChildren[0] ?? <View />;
  const nestedSheets = nativeChildren.slice(1);
  const detent = useMemo(
    () => ({ fraction: initialStage === 1 ? stageTwoRatio : STAGE_ONE_RATIO }),
    [initialStage, stageTwoRatio],
  );
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
          modifiers={[
            presentationDetents([detent], { selection: detent }),
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
                frame({ minWidth: 0, maxWidth: 10000, minHeight: 64, maxHeight: 64 }),
              ]}
            >
              <Spacer modifiers={[frame({ width: 44, height: 44 })]} />
              <SwiftText
                modifiers={[
                  frame({ minWidth: 0, maxWidth: Infinity, minHeight: 48, maxHeight: 48, alignment: 'center' }),
                  font({ size: 17, weight: 'bold' }),
                ]}
              >
                {title}
              </SwiftText>
              <Button
                role="cancel"
                onPress={closeOnce}
                modifiers={[
                  buttonStyle(liquidGlass.isLiquidGlassAvailable() ? 'glass' : 'bordered'),
                  buttonBorderShape('circle'),
                  frame({ width: 44, height: 44 }),
                  accessibilityLabel('close'),
                ]}
              >
                <ZStack modifiers={[frame({ width: 36, height: 36 })]}>
                  <Image systemName="xmark" size={22} />
                </ZStack>
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
