import React, { useState } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MAP_FLOATING_EDGE_INSET, MAP_SHEET_CORNER_RADIUS, SHEET_CORNER_ACTION_INSET } from '../../../components/mapSheetChrome';
import { useMountEffect } from '../../../hooks/useMountEffect';
import { useTranslation } from '../../../i18n';
import { HITHER_ACCENT } from '../../../theme/brand';
import { D6Surface } from './D6HomeChrome';
import { QuickCommandGrid } from './QuickCommandGrid';

type D6CommandsSheetProps = Pick<React.ComponentProps<typeof QuickCommandGrid>,
  'groupId' | 'isLeader' | 'requestStartDestinationId' | 'onCommandSent' | 'onClose'> & {
  open: boolean;
  progress: Animated.Value;
  reduceMotion: boolean;
  onDismiss: () => void;
};

function CommandsMotion({ open, progress, reduceMotion, onExit }: Pick<D6CommandsSheetProps,
  'open' | 'progress' | 'reduceMotion'> & { onExit: () => void }) {
  useMountEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: reduceMotion ? 0 : 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    animation.start(({ finished }) => { if (finished && !open) onExit(); });
    return () => animation.stop();
  });
  return null;
}

export function D6CommandsSheet({ open, progress, reduceMotion, onDismiss, ...commands }: D6CommandsSheetProps) {
  const { t } = useTranslation();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [shown, setShown] = useState(false);
  const [cardHeight, setCardHeight] = useState(0);
  const [exited, setExited] = useState(false);
  const marginBottom = Math.max(24, insets.bottom - 8);
  const interactive = open && shown && cardHeight > 0;
  // Moving the layout keeps the SwiftUI controls’ accessibility frames aligned with the card.
  const cardMotion = {
    top: progress.interpolate({ inputRange: [0, 1], outputRange: [cardHeight + marginBottom, 0] }),
    opacity: progress.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 1, 1] }),
  };

  useMountEffect(() => () => progress.setValue(0));

  return (
    <>
      <Modal transparent visible={!exited} presentationStyle="overFullScreen" animationType="none"
        onShow={() => setShown(true)} onRequestClose={commands.onClose} onDismiss={onDismiss}>
        <KeyboardAvoidingView behavior="padding" style={styles.layer}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')}
            testID="d6-command-dismiss" style={StyleSheet.absoluteFill} onPress={commands.onClose} />
          <Animated.View accessibilityViewIsModal accessibilityElementsHidden={!interactive}
            pointerEvents={interactive ? 'auto' : 'none'}
            style={[styles.card, { marginBottom, maxHeight: height - insets.top - 60 }, cardMotion]}>
            <View testID="d6-command-card" onLayout={event => setCardHeight(event.nativeEvent.layout.height)} style={styles.content}>
              <D6Surface radius={MAP_SHEET_CORNER_RADIUS} thick />
              <QuickCommandGrid {...commands} accent={HITHER_ACCENT} onAccent="#fff" />
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>
      {shown && !exited && (!open || interactive) ? <CommandsMotion
        key={`${open}:${reduceMotion}`}
        open={open}
        progress={progress}
        reduceMotion={reduceMotion}
        onExit={() => setExited(true)}
      /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  layer: { flex: 1, justifyContent: 'flex-end' },
  card: { marginHorizontal: MAP_FLOATING_EDGE_INSET },
  content: { flexShrink: 1, padding: SHEET_CORNER_ACTION_INSET },
});
