import { type GroupMapHandle } from '../../../components/GroupMap';
import NativeGlassButton from '../../../components/NativeGlassButton';
import WaveLoading from '../../../components/WaveLoading';
import { type TourTargetId } from '../../../featureTour';
import { glass } from '../../../glass';
import { type TranslationKey } from '../../../i18n';
import { liquidGlass, type PlaceResult } from '../../../native';
import { type Coordinates } from '../../../types';
import { distanceMeters, walkingEtaSeconds, formatDistance } from '../../../utils/geo';
import { lightTap, selectionTick } from '../../../utils/haptics';
import { keyboardAvoidBottomOffset } from '../../../utils/keyboardSurface';
import { shortEta } from '../../../utils/mapFormatters';
import { runUiAction } from '../../../utils/uiAction';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Platform, Pressable, View, TextInput, Keyboard, Text } from 'react-native';
import Animated from 'react-native-reanimated';
import type { MapStyles } from '../styles';
import type { AnimatedStyleHandle } from 'react-native-reanimated/lib/typescript/hook/commonTypes';
import type { EdgeInsets } from 'react-native-safe-area-context';
import type { User } from '../../../types';

export interface AddPlaceConfirmCardProps {
  accent: string;
  addPlaceTourStep: number | null;
  confirmCardReady: boolean;
  confirmCardStyle: AnimatedStyleHandle<{ transform: ({ translateY: number; scale?: undefined; } | { scale: number; translateY?: undefined; })[]; }>;
  confirmKeyboardHeight: number;
  confirmPlaceBusy: boolean;
  confirmPlaceBusyRef: React.RefObject<boolean>;
  dismissConfirmCard: () => void;
  favoriteBusy: boolean;
  fromCoords: Coordinates | undefined;
  handlePickDestination: (place: PlaceResult, placement?: "firstStop") => Promise<boolean>;
  insets: EdgeInsets;
  mapRef: React.RefObject<GroupMapHandle | null>;
  obliqueLocate: boolean;
  pendingIsFavorite: boolean;
  pendingPlace: PlaceResult | null;
  pendingPlaceTitle: string;
  setConfirmPlaceBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setPendingPlaceTitle: React.Dispatch<React.SetStateAction<string>>;
  setTourTargetRef: (id: TourTargetId, node: View | null) => void;
  styles: MapStyles;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  togglePendingFavorite: () => Promise<void>;
  user: User | null;
}

export function AddPlaceConfirmCard({
  accent,
  addPlaceTourStep,
  confirmCardReady,
  confirmCardStyle,
  confirmKeyboardHeight,
  confirmPlaceBusy,
  confirmPlaceBusyRef,
  dismissConfirmCard,
  favoriteBusy,
  fromCoords,
  handlePickDestination,
  insets,
  mapRef,
  obliqueLocate,
  pendingIsFavorite,
  pendingPlace,
  pendingPlaceTitle,
  setConfirmPlaceBusy,
  setPendingPlaceTitle,
  setTourTargetRef,
  styles,
  t,
  togglePendingFavorite,
  user,
}: AddPlaceConfirmCardProps) {
  return (
    <>{confirmCardReady && pendingPlace && (() => {
      // Walking time + distance from me to the picked place — the follower-nav
      // card layout (arrow · N min · distance) applied to the add-confirm step.
      const pDist = fromCoords
        ? distanceMeters(fromCoords, pendingPlace.coordinates)
        : null;
      const pMin = pDist != null ? shortEta(walkingEtaSeconds(pDist)) : null;
      const confirmAddPlace = async (placement?: 'firstStop') => {
        if (confirmPlaceBusyRef.current) return;
        confirmPlaceBusyRef.current = true;
        setConfirmPlaceBusy(true);
        lightTap();
        try {
          const place = { ...pendingPlace, name: pendingPlaceTitle.trim() || pendingPlace.name };
          // Keep confirm card until success so failures do not wipe UI state.
          await runUiAction(
            'map.confirm_add_destination',
            async (token) => {
              const ok = await handlePickDestination(place, placement);
              if (ok && token.isCurrent()) dismissConfirmCard();
            },
            { screen: 'Map' },
          );
        } finally {
          confirmPlaceBusyRef.current = false;
          setConfirmPlaceBusy(false);
        }
      };
      const confirmBottom = keyboardAvoidBottomOffset({
        baseBottom: insets.bottom + 24,
        keyboardHeight: confirmKeyboardHeight,
      });
      return (
        // Sits above the hidden sheet; lifts with keyboard (12pt gap).
        <Animated.View
          style={[styles.confirmCard, { bottom: confirmBottom }, confirmCardStyle]}
          pointerEvents="box-none"
        >
          <liquidGlass.GlassView
            glassStyle="regular"
            tintColor={Platform.OS === 'android' ? glass.cardActive : undefined}
            style={styles.confirmCardInner}
          >
            <View style={styles.confirmTitleRow}>
              <View style={styles.confirmTextCol}>
                <TextInput
                  value={pendingPlaceTitle}
                  onChangeText={setPendingPlaceTitle}
                  style={styles.confirmTitleInput}
                  placeholder={pendingPlace.name || t('map.droppedPin')}
                  placeholderTextColor={glass.textTertiary}
                  maxLength={120}
                  returnKeyType="done"
                  blurOnSubmit
                  onSubmitEditing={() => Keyboard.dismiss()}
                  accessibilityLabel={t('map.renameTitle')}
                  accessibilityHint={t('map.droppedPinHint')}
                  testID="confirm-place-name"
                />
                <Text style={styles.confirmNameHint} numberOfLines={1}>
                  {t('map.droppedPinHint')}
                </Text>
              </View>
              <View style={styles.confirmControlRow}>
                <View
                  ref={(node) => setTourTargetRef('addPlaceFavoriteStar', node as View | null)}
                  style={styles.confirmArrow}
                >
                  <Pressable
                    style={({ pressed }) => [
                      styles.confirmControl,
                      pressed && styles.confirmControlPressed,
                    ]}
                    testID="add-place-favorite-star"
                    onPress={() => {
                      // Tour is explanation-only: block real action while active.
                      if (addPlaceTourStep != null) return;
                      void togglePendingFavorite();
                    }}
                    disabled={favoriteBusy || !user?.id}
                    accessibilityRole="button"
                    accessibilityLabel={
                      pendingIsFavorite
                        ? t('stay.unfavoriteA11y')
                        : t('stay.favoriteA11y')
                    }
                    accessibilityState={{
                      disabled: favoriteBusy || !user?.id,
                      selected: pendingIsFavorite,
                      busy: favoriteBusy,
                    }}
                  >
                    {favoriteBusy ? (
                      <WaveLoading size="small" color={accent} />
                    ) : (
                      <Ionicons
                        name={pendingIsFavorite ? 'star' : 'star-outline'}
                        size={28}
                        color={accent}
                      />
                    )}
                  </Pressable>
                </View>
                <View
                  ref={(node) => setTourTargetRef('addPlaceCenter', node as View | null)}
                  style={styles.confirmArrow}
                >
                  <Pressable
                    style={({ pressed }) => [
                      styles.confirmControl,
                      pressed && styles.confirmControlPressed,
                    ]}
                    testID="add-place-center-btn"
                    onPress={() => {
                      if (addPlaceTourStep != null) return;
                      if (obliqueLocate) {
                        mapRef.current?.focusOblique(pendingPlace.coordinates);
                      } else {
                        mapRef.current?.centerOn(pendingPlace.coordinates);
                      }
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t('stay.centerPlaceA11y')}
                  >
                    <Ionicons name="navigate" size={28} color={accent} />
                  </Pressable>
                </View>
                <Pressable style={styles.confirmCloseTarget} disabled={confirmPlaceBusy}
                  accessibilityRole="button" accessibilityLabel={t('common.cancel')}
                  accessibilityState={{ disabled: confirmPlaceBusy }}
                  testID="confirm-place-cancel" onPress={() => { selectionTick(); dismissConfirmCard(); }}>
                  <View pointerEvents="none" accessible={false}>
                    <NativeGlassButton systemImage="xmark" shape="circle" size={36.3}
                      imageSize={14.85} disabled={confirmPlaceBusy} accessibilityLabel={t('common.cancel')} />
                  </View>
                </Pressable>
              </View>
            </View>
            <View style={styles.confirmTopRow}>
              <View style={styles.confirmEtaRow}>
                <Text style={[styles.confirmMin, { color: accent }]} numberOfLines={1}>
                  {pMin ?? '—'}
                </Text>
                {pDist != null ? (
                  <Text style={styles.confirmDist} numberOfLines={1}>
                    · {formatDistance(pDist)}
                  </Text>
                ) : null}
              </View>
            </View>
            <View style={styles.confirmBtnRow}>
              <View style={styles.confirmBtnSlot}>
                <Pressable style={({ pressed }) => [styles.confirmPool, pressed && styles.confirmControlPressed]}
                  disabled={confirmPlaceBusy} accessibilityRole="button"
                  accessibilityState={{ disabled: confirmPlaceBusy, busy: confirmPlaceBusy }}
                  accessibilityLabel={t('confirmGather.addPool')} testID="confirm-place-pool"
                  onPress={() => { void confirmAddPlace().catch(() => undefined); }}>
                  <Text style={styles.confirmPoolText}>{t('confirmGather.addPool')}</Text>
                </Pressable>
              </View>
              <View style={styles.confirmBtnSlot}>
                <Pressable style={({ pressed }) => [styles.confirmAdd, pressed && styles.confirmControlPressed]}
                  disabled={confirmPlaceBusy} accessibilityRole="button"
                  accessibilityState={{ disabled: confirmPlaceBusy, busy: confirmPlaceBusy }}
                  accessibilityLabel={t('confirmGather.quickAdd')} testID="confirm-place-quick-add"
                  onPress={() => { void confirmAddPlace('firstStop').catch(() => undefined); }}>
                  <Text style={styles.confirmAddText}>{t('confirmGather.quickAdd')}</Text>
                </Pressable>
              </View>
            </View>
          </liquidGlass.GlassView>
        </Animated.View>
      );
    })()}</>
  );
}
