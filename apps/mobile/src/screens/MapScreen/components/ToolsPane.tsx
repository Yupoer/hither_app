import PrefSlider from '../../../components/PrefSlider';
import QuickCommandsCard from '../../../components/QuickCommandsCard';
import SystemToggle from '../../../components/SystemToggle';
import { glass } from '../../../glass';
import { type TranslationKey } from '../../../i18n';
import { ARRIVAL_RADIUS_OPTIONS } from '../../../state/PreferencesContext';
import { mediumTap, lightTap } from '../../../utils/haptics';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { View, Pressable, Text } from 'react-native';
import type { MapStyles } from '../styles';
import type { Palette } from '../../../theme';

export interface ToolsPaneProps {
  accent: string;
  arrivalRadiusM: number;
  dark: Palette;
  groupId: string | null;
  handleToolsLiveActivityChange: (next: boolean) => void;
  isLeader: boolean;
  liveActivityEnabled: boolean;
  liveActivityUnlocked: boolean;
  openCustomQuickCommand: (slot?: number) => void;
  setArrivalRadiusM: (meters: number) => void;
  setOverlay: React.Dispatch<React.SetStateAction<"route" | "settings" | "profile" | "feedback" | "history" | "account" | "custom" | "invite" | "commands" | "arrivalManage" | "arrival" | "ops" | null>>;
  setPassiveCompanionMode: (on: boolean) => void;
  styles: MapStyles;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

export function ToolsPane({
  accent,
  arrivalRadiusM,
  dark,
  groupId,
  handleToolsLiveActivityChange,
  isLeader,
  liveActivityEnabled,
  liveActivityUnlocked,
  openCustomQuickCommand,
  setArrivalRadiusM,
  setOverlay,
  setPassiveCompanionMode,
  styles,
  t,
}: ToolsPaneProps) {
  return (
    <>
      <View style={styles.passiveEnterBlock}>
      <Pressable
        style={({ pressed }) => [
          styles.passiveEnterButton,
          pressed && styles.passiveEnterButtonPressed,
        ]}
        onPress={() => {
          mediumTap();
          setPassiveCompanionMode(true);
        }}
        accessibilityLabel={t('passive.enter')}
        accessibilityRole="button"
        testID="tools-enter-passive"
      >
        <View style={styles.passiveEnterContent} pointerEvents="none">
          <Ionicons name="leaf-outline" size={28} color={glass.textPrimary} />
          <Text style={styles.passiveEnterLabel}>{t('passive.enter')}</Text>
        </View>
      </Pressable>
      </View>
    
      <View style={styles.accuracyRow} testID="tools-live-activity-row">
        <View style={styles.accuracyCopy}>
          <Text style={styles.accuracyLabel}>{t('settings.liveActivity')}</Text>
          <Text style={styles.accuracySubhint}>{t('settings.liveActivityHint')}</Text>
        </View>
        <SystemToggle
          value={liveActivityUnlocked && liveActivityEnabled}
          onValueChange={handleToolsLiveActivityChange}
          accessibilityLabel={t('settings.liveActivity')}
          testID="tools-live-activity-toggle"
        />
      </View>
    
      <Text style={styles.sheetHeading}>{t('arrival.radiusSection')}</Text>
      <View style={styles.accuracyRow}>
        <View style={styles.accuracyCopy}>
          <Text style={styles.accuracyLabel}>
            {t('arrival.radiusValue', { meters: String(arrivalRadiusM) })}
          </Text>
          <Text style={styles.accuracySubhint}>{t('arrival.radiusHint')}</Text>
        </View>
      </View>
      <View style={styles.marqueeSpeedBlock}>
        <PrefSlider
          value={arrivalRadiusM}
          values={ARRIVAL_RADIUS_OPTIONS}
          onChange={setArrivalRadiusM}
          accent={accent}
          accessibilityLabel={t('arrival.radiusSection')}
        />
      </View>
    
      <Text style={styles.sheetHeading}>{t('map.cmdTitle')}</Text>
      {groupId ? (
        <QuickCommandsCard
          groupId={groupId}
          isLeader={!!isLeader}
          colors={dark}
          onConfigureCustom={openCustomQuickCommand}
          variant="preview"
          onOpenAll={() => {
            lightTap();
            setOverlay('commands');
          }}
        />
      ) : null}
    </>
  );
}
