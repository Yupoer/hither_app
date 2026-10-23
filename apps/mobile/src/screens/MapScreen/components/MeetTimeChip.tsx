import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import MeetCountdown from '../../../components/MeetCountdown';
import { glass } from '../../../glass';

/**
 * Meet-time chip on the gather card. Owns due/live caption switching so the
 * parent carousel does not re-render 1×/s — only this chip ticks.
 * Due: top "{time} 集合", bottom "集合時間". Live: top "N 分鐘", bottom "集合倒數".
 */
export const MeetTimeChip = React.memo(function MeetTimeChip({
  meetAtIso,
  meetRedMinutes,
  accent,
  chromeTight,
  chromeCompact,
  expanded,
  styles,
  canEdit,
  a11yLabel,
  onPress,
  formatMinutes,
  formatDue,
  captionLive,
  captionDue,
}: {
  meetAtIso: string | null | undefined;
  meetRedMinutes: number;
  accent: string;
  chromeTight: boolean;
  chromeCompact: boolean;
  expanded: boolean;
  styles: any;
  canEdit: boolean;
  a11yLabel: string;
  onPress: () => void;
  formatMinutes: (minutes: number) => string;
  formatDue: (time: string) => string;
  captionLive: string;
  captionDue: string;
}) {
  const [due, setDue] = useState(() => {
    if (!meetAtIso) return false;
    const t = new Date(meetAtIso).getTime();
    return Number.isFinite(t) && t <= Date.now();
  });
  const onDueChange = useCallback((next: boolean) => {
    setDue(next);
  }, []);
  const labelStyle = chromeTight
    ? styles.meetBtnLabelTight
    : chromeCompact
      ? styles.meetBtnLabelCompact
      : styles.meetBtnLabel;

  return (
    <Pressable
      style={[styles.meetBtn, expanded ? styles.meetBtnExpanded : null]}
      onPress={(event) => {
        event.stopPropagation();
        onPress();
      }}
      disabled={!canEdit}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
    >
      <View style={styles.meetBtnStack}>
        <View style={styles.meetBtnTimeRow}>
          <Ionicons
            name="time-outline"
            size={chromeTight ? 14 : chromeCompact ? 15 : 16}
            color={meetAtIso ? accent : glass.textSecondary}
          />
          {meetAtIso ? (
            <MeetCountdown
              meetAtIso={meetAtIso}
              redWithinMin={meetRedMinutes}
              redColor={glass.danger}
              variant="minutes"
              formatMinutes={formatMinutes}
              formatDue={formatDue}
              onDueChange={onDueChange}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              baseStyle={[labelStyle, { color: accent }]}
            />
          ) : (
            <Text
              style={labelStyle}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              ——
            </Text>
          )}
        </View>
        <Text
          style={styles.meetBtnCaption}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {meetAtIso && due ? captionDue : captionLive}
        </Text>
      </View>
    </Pressable>
  );
});
