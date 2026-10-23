import { unsaveFavoritePlace, type FavoritePlace } from '../../../api/client';
import DestinationReorderList from '../../../components/DestinationReorderList';
import OverlaySheet from '../../../components/OverlaySheet';
import { type TourTargetId } from '../../../featureTour';
import { glass } from '../../../glass';
import { type TranslationKey } from '../../../i18n';
import type { DailyAccommodation, Destination } from '../../../types';
import { lightTap } from '../../../utils/haptics';
import { dateForTripDay, localDayKey } from '../../../utils/tripDay';
import { nextOrderInDay, insertDraftDestination } from '../hooks/useRouteDraft';
import { type ReorderUpdate } from '../itineraryReorder';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, type View, Text, ScrollView, type NativeSyntheticEvent, type NativeScrollEvent, Alert } from 'react-native';
import type { RouteDraft } from '../hooks/useRouteDraft';
import type { MapStyles } from '../styles';
import type { Palette } from '../../../theme';
import type { User } from '../../../types';

export interface RouteEditorSheetProps {
  accent: string;
  canEditItinerary: boolean;
  dailyAccommodations: DailyAccommodation[];
  dark: Palette;
  destinations: Destination[];
  favoritePlaces: FavoritePlace[];
  flushRouteDraft: () => Promise<void>;
  groupId: string | null;
  handleDelete: (id: string) => void;
  handleDeleteMany: (ids: string[]) => void;
  handleReorder: (updates: ReorderUpdate[]) => Promise<boolean>;
  handleRouteDragAutoScroll: (deltaY: number) => void;
  handleUpdateEmojiColor: (id: string, next: { emoji: string | null; markerColor?: string | null; }) => Promise<void>;
  handleUpdateTripDetails: (days: number, date: string) => Promise<void>;
  localActionError: { title: string; message: string; destinationId?: string; } | null;
  navTargetId: string | null;
  openForRouteEditor: Destination[];
  openKmlImportForScope: (scopeId?: string) => Promise<void>;
  overlay: "route" | "settings" | "profile" | "feedback" | "history" | "account" | "custom" | "invite" | "commands" | "arrivalManage" | "arrival" | "ops" | null;
  routeDepartureDate: string | undefined;
  routeDraft: RouteDraft;
  routeDragPreview: React.ReactNode;
  routeEditorScopeId: string | undefined;
  routeEditorServerDestinations: Destination[];
  routeInteractionMode: "drag" | "select" | "none";
  routeScrollEnabled: boolean;
  routeScrollRef: React.RefObject<ScrollView | null>;
  routeScrollViewportHeightRef: React.RefObject<number>;
  routeScrollYRef: React.RefObject<number>;
  routeSelectedIds: string[];
  routeTripDays: number | undefined;
  setEditButtonActive: React.Dispatch<React.SetStateAction<boolean>>;
  setFavoritePlaces: React.Dispatch<React.SetStateAction<FavoritePlace[]>>;
  setOverlay: React.Dispatch<React.SetStateAction<"route" | "settings" | "profile" | "feedback" | "history" | "account" | "custom" | "invite" | "commands" | "arrivalManage" | "arrival" | "ops" | null>>;
  setRouteDragPreview: React.Dispatch<React.SetStateAction<React.ReactNode>>;
  setRouteInteractionMode: React.Dispatch<React.SetStateAction<"drag" | "select" | "none">>;
  setRouteOverlayOpenComplete: React.Dispatch<React.SetStateAction<boolean>>;
  setRouteScrollEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setRouteSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
  setTourTargetRef: (id: TourTargetId, node: View | null) => void;
  styles: MapStyles;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  user: User | null;
}

export function RouteEditorSheet({
  accent,
  canEditItinerary,
  dailyAccommodations,
  dark,
  destinations,
  favoritePlaces,
  flushRouteDraft,
  groupId,
  handleDelete,
  handleDeleteMany,
  handleReorder,
  handleRouteDragAutoScroll,
  handleUpdateEmojiColor,
  handleUpdateTripDetails,
  localActionError,
  navTargetId,
  openForRouteEditor,
  openKmlImportForScope,
  overlay,
  routeDepartureDate,
  routeDraft,
  routeDragPreview,
  routeEditorScopeId,
  routeEditorServerDestinations,
  routeInteractionMode,
  routeScrollEnabled,
  routeScrollRef,
  routeScrollViewportHeightRef,
  routeScrollYRef,
  routeSelectedIds,
  routeTripDays,
  setEditButtonActive,
  setFavoritePlaces,
  setOverlay,
  setRouteDragPreview,
  setRouteInteractionMode,
  setRouteOverlayOpenComplete,
  setRouteScrollEnabled,
  setRouteSelectedIds,
  setTourTargetRef,
  styles,
  t,
  user,
}: RouteEditorSheetProps) {
  return (
    <OverlaySheet
      visible={overlay === 'route'}
      onClose={() => {
        // 完成 and swipe-dismiss both commit: unlock scroll, close, flush.
        lightTap();
        setRouteScrollEnabled(true);
        setRouteOverlayOpenComplete(false);
        setEditButtonActive(false);
        setOverlay(null);
        void flushRouteDraft();
      }}
      onOpenComplete={() => {
        setEditButtonActive(false);
        setRouteScrollEnabled(true);
        setRouteOverlayOpenComplete(true);
      }}
      floatingContent={routeDragPreview}
      title={t('map.gatheringPoints')}
      accent={accent}
      doneLabel={t('map.done')}
      doneSystemImage="checkmark"
      material="mapSheet"
      edgeToEdge
      headerLeft={
        canEditItinerary ? (
          routeSelectedIds.length > 0 ? (
            <Pressable
              ref={(node) => setTourTargetRef('routeMode', node as View | null)}
              onPress={() => {
                lightTap();
                handleDeleteMany(routeSelectedIds);
              }}
              accessibilityRole="button"
              accessibilityLabel={t('route.deleteSelectedA11y')}
                testID="route-delete-selected"
              hitSlop={8}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
            >
              <Ionicons name="trash-outline" size={18} color="#FF5A5F" />
              <Text style={{ color: '#FF453A', fontSize: 14, fontWeight: '800' }}>
                {t('route.deleteSelected', { count: routeSelectedIds.length })}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              ref={(node) => setTourTargetRef('routeMode', node as View | null)}
              onPress={() => {
                lightTap();
                setRouteSelectedIds([]);
                setRouteInteractionMode((prev) =>
                  prev === 'drag' ? 'select' : prev === 'select' ? 'none' : 'drag',
                );
              }}
              accessibilityRole="button"
              accessibilityLabel={
                routeInteractionMode === 'drag'
                  ? t('route.modeDragA11y')
                  : routeInteractionMode === 'select'
                    ? t('route.modeSelectA11y')
                    : t('route.modeHiddenA11y')
              }
              hitSlop={8}
              style={{ paddingVertical: 2, paddingHorizontal: 2 }}
                testID="route-interaction-mode"
            >
              <Ionicons
                name={
                  routeInteractionMode === 'drag'
                    ? 'reorder-three-outline'
                    : routeInteractionMode === 'select'
                      ? 'checkbox-outline'
                      : 'lock-closed-outline'
                }
                size={22}
                color={accent}
              />
            </Pressable>
          )
        ) : undefined
      }
    >
      <ScrollView
        ref={routeScrollRef}
        contentContainerStyle={styles.overlayBody}
        scrollEnabled={routeScrollEnabled}
        onLayout={(event) => {
          routeScrollViewportHeightRef.current = event.nativeEvent.layout.height;
        }}
        onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
          routeScrollYRef.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
      >
        <Text style={styles.overlayHint}>{t('map.routeHint')}</Text>
        {localActionError ? <Text accessibilityLiveRegion="polite" style={{ color: glass.danger }}>{localActionError.title}{'：'}{localActionError.message}</Text> : null}
        <DestinationReorderList
          groupId={groupId ?? undefined}
          destinations={openForRouteEditor}
          canReorder={canEditItinerary}
          showTripDetails={routeEditorScopeId == null}
          tripDays={routeTripDays}
          departureDate={routeDepartureDate}
          onUpdateTripDetails={handleUpdateTripDetails}
          onReorder={handleReorder}
          activeDestinationId={navTargetId ?? undefined}
          onDelete={canEditItinerary ? handleDelete : undefined}
          onUpdateEmojiColor={canEditItinerary ? handleUpdateEmojiColor : undefined}
          onImport={() => { void openKmlImportForScope(routeEditorScopeId); }}
          colors={dark}
          emptyLabel={t('settings.noDestinations')}
          interactionMode={routeInteractionMode}
          selectedIds={routeSelectedIds}
          onSelectedIdsChange={setRouteSelectedIds}
          onDragActiveChange={(active) => {
            // Defensive: never leave scroll locked after drag ends.
            setRouteScrollEnabled(!active);
            if (!active) setRouteScrollEnabled(true);
          }}
          onDragPreviewChange={setRouteDragPreview}
          onDragAutoScroll={handleRouteDragAutoScroll}
          onTourTargetRef={setTourTargetRef}
          accountId={user?.id}
          dailyByDate={Object.fromEntries(
            dailyAccommodations.map((d) => [
              d.stayDate,
              {
                id: d.id,
                stayDate: d.stayDate,
                title: d.title,
                coordinates: d.coordinates,
              },
            ]),
          )}
          favoritePlaces={favoritePlaces}
          onDeleteFavorite={
            user?.id
              ? (fav) => {
                  lightTap();
                  const snapshot = favoritePlaces;
                  setFavoritePlaces((prev) => prev.filter((f) => f.id !== fav.id));
                  void unsaveFavoritePlace(fav.id).catch(() => {
                    setFavoritePlaces(snapshot);
                  });
                }
              : undefined
          }
          onClearDailyAccommodation={
            canEditItinerary && groupId
              ? (stayDate, _day) => {
                  // Local draft only — flush on sheet dismiss.
                  routeDraft.editDaily((base) => base.filter((d) => d.stayDate !== stayDate));
                }
              : undefined
          }
          onSetDailyFromDestination={
            canEditItinerary && groupId
              ? (destinationId, day) => {
                  const baseDests = routeDraft.latestDestinations() ?? routeEditorServerDestinations;
                  const dest =
                    baseDests.find((d) => d.id === destinationId)
                    ?? destinations.find((d) => d.id === destinationId);
                  if (!dest) return;
                  const departure = routeDepartureDate;
                  const date = dateForTripDay(departure, day);
                  if (!date) {
                    Alert.alert(
                      t('interaction.error'),
                      t('stay.needDepartureDate'),
                    );
                    return;
                  }
                  const stayDate = localDayKey(date);
                  const next: DailyAccommodation = {
                    id: `draft-daily-${stayDate}`,
                    groupId,
                    stayDate,
                    title: dest.title,
                    address: dest.address,
                    coordinates: dest.coordinates,
                    // Snapshot only (no FK); source stop is discarded below.
                    sourceDestinationId: dest.id,
                  };
                  routeDraft.editDaily((base) => [...base.filter((d) => d.stayDate !== stayDate), next]);
                  // Setting stay from a gathering point discards that stop;
                  // only the daily accommodation setting remains.
                  routeDraft.setDestinations(baseDests.filter((d) => d.id !== destinationId), { dirty: true });
                  if (!destinationId.startsWith('draft-')) routeDraft.markDeleted(destinationId);
                }
              : undefined
          }
          onQuickAddAccommodation={
            canEditItinerary && groupId
              ? (day) => {
                  // Local draft card — only days with existing stops show this CTA.
                  // Use full open route-editor list (not day-gated carousel).
                  const daily = dailyAccommodations.find((d) => {
                    const date = dateForTripDay(
                      routeDepartureDate,
                      day,
                    );
                    return date ? d.stayDate === localDayKey(date) : false;
                  });
                  const dayStops = openForRouteEditor
                    .filter((d) => (d.day || 1) === day)
                    .sort((a, b) => a.order - b.order);
                  if (dayStops.length === 0) return;
                  const allSorted = openForRouteEditor.slice().sort((a, b) => {
                    if ((a.day ?? 0) !== (b.day ?? 0)) {
                      return (a.day ?? 0) - (b.day ?? 0);
                    }
                    return a.order - b.order;
                  });
                  const fallbackStop =
                    dayStops[dayStops.length - 1]
                    ?? allSorted[allSorted.length - 1];
                  const title = daily?.title ?? t('stay.defaultTitle');
                  const address = daily?.address ?? fallbackStop?.address;
                  const coords = daily?.coordinates
                    ?? fallbackStop?.coordinates
                    ?? {
                      latitude: 0,
                      longitude: 0,
                    };
                  const base = routeDraft.latestDestinations() ?? routeEditorServerDestinations;
                  const insertOrder = nextOrderInDay(base, day, (fallbackStop?.order ?? 0) + 1);
                  const draftCard: Destination = {
                    id: routeDraft.nextDraftId('draft-acc'),
                    title,
                    address,
                    coordinates: coords,
                    order: insertOrder,
                    day,
                    kind: 'accommodation',
                    stayAnchor: false,
                    subgroupId: routeEditorScopeId,
                  };
                  routeDraft.setDestinations(insertDraftDestination(base, draftCard), { dirty: true });
                }
              : undefined
          }
          onPickFavorite={
            canEditItinerary && groupId
              ? (fav, _day) => {
                  const day = null;
                  // Local draft stop from favorites — flush on dismiss.
                  const base = routeDraft.latestDestinations() ?? routeEditorServerDestinations;
                  const insertOrder = nextOrderInDay(base, day, 0);
                  const draftStop: Destination = {
                    id: routeDraft.nextDraftId('draft-fav'),
                    title: fav.title,
                    address: fav.address,
                    coordinates: fav.coordinates,
                    order: insertOrder,
                    day,
                    kind: 'stop',
                    subgroupId: routeEditorScopeId,
                  };
                  routeDraft.setDestinations(insertDraftDestination(base, draftStop), { dirty: true });
                }
              : undefined
          }
        />
      </ScrollView>
    </OverlaySheet>
  );
}
