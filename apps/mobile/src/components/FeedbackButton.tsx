import React, { useState } from 'react';
import { Pressable, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { captureScreen } from 'react-native-view-shot';
import FeedbackSheet from './FeedbackSheet';
import { useTranslation } from '../i18n';
import { glass } from '../glass';

/**
 * Small "report a problem" entry point. Captures the CURRENT screen the
 * instant it's pressed (before the feedback sheet opens over it), so the
 * screenshot shows what the user actually saw, not the feedback form.
 */
export default function FeedbackButton({
  contextTag,
  style,
}: {
  contextTag: 'map' | 'itinerary' | 'kml' | 'settings';
  style?: ViewStyle;
}) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [screenshotUri, setScreenshotUri] = useState<string | null>(null);

  async function open() {
    let uri: string | null = null;
    try {
      uri = await captureScreen({ format: 'jpg', quality: 0.6, result: 'tmpfile' });
    } catch {
      uri = null;
    }
    setScreenshotUri(uri);
    setVisible(true);
  }

  return (
    <>
      <Pressable
        style={[styles.button, style]}
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={t('feedback.title')}
      >
        <Ionicons name="warning-outline" size={17} color={glass.textSecondary} />
      </Pressable>
      <FeedbackSheet
        visible={visible}
        onClose={() => setVisible(false)}
        contextTag={contextTag}
        screenshotUri={screenshotUri}
      />
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: glass.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hairline,
  },
});
