import { reorderDestinations, updateGroupTripDetails, deleteDestination, addDestination, clearDailyAccommodation, setDailyAccommodation, updateDestinationEmojiColor } from '../../../api/client';
import { resolveDailyAccommodationSourceId } from '../../../api/services/DailyAccommodationService';
import { type TranslationKey } from '../../../i18n';
import type { Destination } from '../../../types';
import { logEvent, logError } from '../../../utils/activityLog';
import { confirmAction } from '../../../utils/confirm';
import { buildOpenReorderPayload } from '../../../utils/openReorderSlots';
import { getOperationErrorMessage, classifyOperationError } from '../../../utils/operationError';
import { dateForTripDay, localDayKey, openDestinationsForReorder } from '../../../utils/tripDay';
import { runUiAction } from '../../../utils/uiAction';
import { hasDraftWork } from './useRouteDraft';
import { type ReorderUpdate, applyReorderUpdates, persistedReorderUpdates } from '../itineraryReorder';
import React, { useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import type { RouteDraft } from './useRouteDraft';
import type { DailyAccommodation, Group } from '../../../types';
import type { GroupReloadReason } from '../../../utils/syncAuthority';

export interface UseItineraryMutationsInput {
  allScopedDestinations: Destination[];
  canEditItinerary: boolean;
  destinations: Destination[];
  group: Group | null;
  groupId: string | null;
  isWorkflowContextCurrent: (context: string) => boolean;
  markLeaderRevoked: () => void;
  navTargetId: string | null;
  rawDestinations: Destination[];
  refresh: (reason?: GroupReloadReason) => Promise<boolean>;
  refreshKmlQuota: () => Promise<void>;
  refreshLocalSnapshot: () => Promise<boolean>;
  resolveCurrentNavigationSessionId: (destination: Destination) => string | null;
  routeDepartureDate: string | undefined;
  routeDraft: RouteDraft;
  routeEditorServerDestinations: Destination[];
  routeTripDays: number | undefined;
  serverDailyAccommodations: DailyAccommodation[];
  setKmlScopeId: React.Dispatch<React.SetStateAction<string | undefined>>;
  setKmlVisible: React.Dispatch<React.SetStateAction<boolean>>;
  setRouteSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
  showOperationFailure: (title: string, message: string) => void;
  stopRemovedDestination: (destinationId: string, sessionId: string | null) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  workflowContext: string;
}

export function useItineraryMutations({
  allScopedDestinations,
  canEditItinerary,
  destinations,
  group,
  groupId,
  isWorkflowContextCurrent,
  markLeaderRevoked,
  navTargetId,
  rawDestinations,
  refresh,
  refreshKmlQuota,
  refreshLocalSnapshot,
  resolveCurrentNavigationSessionId,
  routeDepartureDate,
  routeDraft,
  routeEditorServerDestinations,
  routeTripDays,
  serverDailyAccommodations,
  setKmlScopeId,
  setKmlVisible,
  setRouteSelectedIds,
  showOperationFailure,
  stopRemovedDestination,
  t,
  workflowContext,
}: UseItineraryMutationsInput) {
  const routeFlushInFlightRef = useRef(false);

  /**
   * Navigation promote must hit the server immediately (not the route draft).
   * The durable reorder paints the local snapshot; an open draft is kept in step.
   */
  const persistReorderNow = useCallback(
    async (updates: ReorderUpdate[]): Promise<boolean> => {
      if (!groupId) return false;
      const result = await runUiAction(
        'map.destination_reorder',
        async (token) => {
          logEvent('destination_reorder', { count: updates.length });
          const draft = routeDraft.latestDestinations();
          if (draft) routeDraft.setDestinations(applyReorderUpdates(draft, updates, routeDepartureDate));
          const persistedUpdates = persistedReorderUpdates(draft ?? rawDestinations, updates, routeDepartureDate);
          try {
            await reorderDestinations(groupId, persistedUpdates);
            if (!token.isCurrent()) return false;
            refresh();
            return true;
          } catch (e) {
            logError('destination_reorder_failed', e);
            if (token.isCurrent()) {
              showOperationFailure(t('map.setFailedTitle'), getOperationErrorMessage(e));
              routeDraft.setDestinations(null);
              refresh();
            }
            throw e;
          }
        },
        {
          screen: 'Map',
          suppressBanner: true,
          onError: (kind) => {
            routeDraft.setDestinations(null);
            void refresh();
            if (kind === 'timeout') {
              showOperationFailure(t('map.setFailedTitle'), t('interaction.timeout'));
            }
          },
        },
      );
      return result === true;
    },
    [groupId, t, refresh, rawDestinations, routeDraft, routeDepartureDate, showOperationFailure],
  );

  /**
   * Persist saved places immediately; unmaterialized drafts flush on dismissal.
   */
  const handleReorder = useCallback(
    async (updates: ReorderUpdate[]): Promise<boolean> => {
      if (!groupId) return false;
      if (updates.some(update => update.id === navTargetId && update.day == null)) {
        showOperationFailure(t('map.setFailedTitle'), t('trip.endBeforePool'));
        return false;
      }
      const persisted = updates.every(update => !update.id.startsWith('draft-'));
      if (persisted && !routeDraft.dirty().destinations) return persistReorderNow(updates);
      logEvent('destination_reorder_local', { count: updates.length });
      routeDraft.editDestinations((base) => applyReorderUpdates(base, updates, routeDepartureDate));
      return true;
    },
    [groupId, navTargetId, persistReorderNow, routeDraft, routeDepartureDate, showOperationFailure, t],
  );


  /**
   * Save route-sheet draft durably after 完成 / swipe-dismiss.
   * Network delivery is owned by the outbox.
   */
  const flushRouteDraft = useCallback(async () => {
    if (!groupId || routeFlushInFlightRef.current) return;
    // Snapshot so mid-flight mutations to the ref cannot scramble steps.
    const dirty = routeDraft.dirty();
    if (!hasDraftWork(dirty)) {
      routeDraft.setDestinations(null);
      routeDraft.setDaily(null);
      return;
    }
    routeFlushInFlightRef.current = true;
    let localSaveError: unknown;
    try {
      await runUiAction(
        'map.route_draft_flush',
        async (token) => {
          try {
            logEvent('route_draft_flush', {
              destinations: dirty.destinations,
              daily: dirty.daily,
              trip: dirty.trip,
              deleted: dirty.deletedIds.length,
            });

            // 1) Trip meta first (day count / departure) so day alignment is stable.
            if (dirty.trip) {
              const days = routeTripDays;
              const date = routeDepartureDate;
              if (typeof days === 'number' && date) {
                await updateGroupTripDetails(groupId, days, date);
              }
            }
            if (!token.isCurrent()) return;

            // 2) Deletes before reorder so slots free up.
            for (const id of dirty.deletedIds) {
              if (id.startsWith('draft-')) continue;
              const original = routeEditorServerDestinations.find(d => d.id === id);
              await deleteDestination(groupId, id, original ? resolveCurrentNavigationSessionId(original) : null);
            }
            if (!token.isCurrent()) return;

            // 3) Materialize draft-only rows; map temp → real ids.
            let draftDests = routeDraft.latestDestinations();
            if (draftDests) {
              const nextDests: Destination[] = [];
              for (const dest of draftDests) {
                if (!dest.id.startsWith('draft-')) {
                  nextDests.push(dest);
                  continue;
                }
                const newId = await addDestination(
                  groupId,
                  {
                    title: dest.title,
                    address: dest.address,
                    coordinates: dest.coordinates,
                    day: dest.day,
                    providerPlaceId: dest.providerPlaceId,
                    kind: dest.kind === 'accommodation' ? 'accommodation' : 'stop',
                  },
                  routeDraft.editorScopeIdRef.current,
                );
                if (!newId) {
                  throw new Error('draft_materialize_empty');
                }
                nextDests.push({ ...dest, id: newId });
                // Keep each saved id immediately: a later local write failure must
                // not materialize this row again when the draft is retried.
                const savedDests = (routeDraft.latestDestinations() ?? draftDests)
                  .map(row => row.id === dest.id ? { ...row, id: newId } : row);
                routeDraft.setDestinations(savedDests, { dirty: true });
                const draftDaily = routeDraft.latestDaily();
                if (draftDaily) {
                  routeDraft.setDaily(draftDaily.map(row => row.sourceDestinationId === dest.id
                    ? { ...row, sourceDestinationId: newId } : row));
                }
                dirty.destinations = true;
              }
              draftDests = nextDests;
            }
            if (!token.isCurrent()) return;

            // 4) Daily stay set/clear from draft snapshot.
            const draftDaily = routeDraft.latestDaily();
            if (dirty.daily && draftDaily) {
              const serverByDate = new Map(
                serverDailyAccommodations.map((d) => [d.stayDate, d]),
              );
              const draftByDate = new Map(
                draftDaily.map((d) => [d.stayDate, d]),
              );
              for (const [stayDate, serverRow] of serverByDate) {
                if (!draftByDate.has(stayDate)) {
                  const day = (() => {
                    const dep = routeDepartureDate;
                    if (!dep) return undefined;
                    // Best-effort: match by stayDate via open dests day.
                    const match = (draftDests ?? routeEditorServerDestinations).find((d) => {
                      const date = dateForTripDay(dep, d.day || 1);
                      return date ? localDayKey(date) === stayDate : false;
                    });
                    return match?.day ?? undefined;
                  })();
                  await clearDailyAccommodation(groupId, stayDate, day);
                }
                void serverRow;
              }
              for (const [stayDate, draftRow] of draftByDate) {
                const serverRow = serverByDate.get(stayDate);
                if (serverRow && serverRow.title === draftRow.title
                  && serverRow.address === draftRow.address
                  && serverRow.coordinates.latitude === draftRow.coordinates.latitude
                  && serverRow.coordinates.longitude === draftRow.coordinates.longitude
                  && serverRow.sourceDestinationId === draftRow.sourceDestinationId) {
                  continue;
                }
                const day = (() => {
                  const dep = routeDepartureDate;
                  if (!dep) return draftRow.sourceDestinationId ? undefined : undefined;
                  const match = (draftDests ?? routeEditorServerDestinations).find((d) => {
                    if (draftRow.sourceDestinationId && d.id === draftRow.sourceDestinationId) {
                      return true;
                    }
                    const date = dateForTripDay(dep, d.day || 1);
                    return date ? localDayKey(date) === stayDate : false;
                  });
                  return match?.day ?? undefined;
                })();
                // A discarded stop is already deleted by step 2; save its value snapshot.
                const sourceId = draftRow.sourceDestinationId;
                const resolvedSource = resolveDailyAccommodationSourceId(sourceId, dirty.deletedIds);
                await setDailyAccommodation(groupId, stayDate, {
                  title: draftRow.title,
                  address: draftRow.address,
                  coordinates: draftRow.coordinates,
                  sourceDestinationId: resolvedSource,
                  day,
                });
              }
            }
            if (!token.isCurrent()) return;

            // 5) Final open-list reorder against absolute slots (ALL open days).
            // Must not use filterActiveDestinations — day-gating drops past-day
            // rows from the write and makes Day1 appear to become Day2 after 完成.
            if (dirty.destinations && draftDests) {
              const openDraft = openDestinationsForReorder(draftDests);
              if (openDraft.some((d) => d.id.startsWith('draft-'))) {
                throw new Error('draft_ids_in_reorder');
              }
              const withSlots = buildOpenReorderPayload(openDraft);
              await reorderDestinations(groupId, withSlots);
            }
            if (!token.isCurrent()) return;

            if (!(await refreshLocalSnapshot())) throw Object.assign(new Error('local snapshot read failed'), { code: 'SQLITE_READ_FAILED' });
            if (!token.isCurrent()) return;
            routeDraft.reset();
            void refresh().catch(() => undefined);
          } catch (cause) {
            localSaveError = cause;
            throw cause;
          }
        },
        {
          screen: 'Map',
          suppressBanner: true,
          // Multi-step batch (trip + deletes + adds + stays + reorder + refresh).
          timeoutMs: 60_000,
          onError: (kind) => {
            logError('route_draft_flush_failed', new Error(kind));
            if (classifyOperationError(localSaveError).kind === 'leader_role_rejected') {
              markLeaderRevoked();
              void refresh().catch(() => undefined);
            }
            Alert.alert(t('map.setFailedTitle'), kind === 'timeout'
              ? t('interaction.timeout') : getOperationErrorMessage(localSaveError));
            // Keep draft visible so the user can reopen and retry.
          },
        },
      );
    } finally {
      routeFlushInFlightRef.current = false;
    }
  }, [
    routeDraft,
    groupId,
    routeTripDays,
    routeDepartureDate,
    serverDailyAccommodations,
    refreshLocalSnapshot,
    markLeaderRevoked,
    routeEditorServerDestinations,
    resolveCurrentNavigationSessionId,
    refresh,
    t,
  ]);

  const openKmlImport = useCallback(async () => {
    // Persist any unsaved route ordering first; an import must never be
    // followed by a stale optimistic draft overwriting the new server rows.
    await flushRouteDraft();
    if (routeDraft.hasUnsavedChanges()) return;
    await refreshKmlQuota();
    setKmlVisible(true);
  }, [flushRouteDraft, refreshKmlQuota, routeDraft, setKmlVisible]);

  const openKmlImportForScope = useCallback(async (scopeId?: string) => {
    setKmlScopeId(scopeId);
    await openKmlImport();
  }, [openKmlImport, setKmlScopeId]);

  const persistRouteDeletions = useCallback(async (ids: string[]) => {
    if (!groupId || !canEditItinerary) return;
    const context = workflowContext;
    const isCurrent = () => isWorkflowContextCurrent(context);
    try {
      for (const id of ids) {
        if (!isCurrent()) return;
        const original = (routeDraft.latestDestinations() ?? routeEditorServerDestinations).find(d => d.id === id);
        const sessionId = original ? resolveCurrentNavigationSessionId(original) : null;
        if (!id.startsWith('draft-')) await deleteDestination(groupId, id, sessionId);
        if (!isCurrent()) return;
        await refreshLocalSnapshot();
        if (!isCurrent()) return;
        stopRemovedDestination(id, sessionId);
        const draft = routeDraft.latestDestinations();
        if (draft) routeDraft.setDestinations(draft.filter(d => d.id !== id));
        routeDraft.forgetDeleted(id);
        setRouteSelectedIds(previous => previous.filter(value => value !== id));
      }
    } catch (cause) {
      // Service returns after a local transaction. Only a real local-save failure reaches here.
      if (isCurrent()) Alert.alert(t('map.setFailedTitle'), getOperationErrorMessage(cause));
    }
  }, [canEditItinerary, groupId, resolveCurrentNavigationSessionId, routeEditorServerDestinations, routeDraft, setRouteSelectedIds,
    refreshLocalSnapshot, stopRemovedDestination, t, workflowContext, isWorkflowContextCurrent]);

  const handleDelete = useCallback(
    (id: string) => {
      if (!groupId || !canEditItinerary) return;
      const target =
        (routeDraft.latestDestinations() ?? destinations).find((d) => d.id === id);
      confirmAction(
        {
          title: t('settings.deleteTitle'),
          message: t('settings.deleteMsg', { title: target?.title ?? '' }),
          confirmLabel: t('settings.deleteConfirm'),
          destructive: true,
        },
        () => {
          logEvent('destination_delete_local', { id });
          void persistRouteDeletions([id]);
        },
      );
    },
    [canEditItinerary, groupId, destinations, persistRouteDeletions, routeDraft, t],
  );

  /** Multi-select delete saves each accepted local operation before transport. */
  const handleDeleteMany = useCallback(
    (ids: string[]) => {
      if (!groupId || !canEditItinerary || ids.length === 0) return;
      confirmAction(
        {
          title: t('settings.deleteTitle'),
          message: t('route.deleteManyMsg', { count: ids.length }),
          confirmLabel: t('settings.deleteConfirm'),
          destructive: true,
        },
        () => {
          logEvent('destination_delete_many_local', { count: ids.length });
          void persistRouteDeletions(ids);
        },
      );
    },
    [canEditItinerary, groupId, persistRouteDeletions, t],
  );

  const handleUpdateEmojiColor = useCallback(
    async (
      id: string,
      next: { emoji: string | null; markerColor?: string | null },
    ) => {
      if (!groupId || !canEditItinerary) {
        logError('destination_emoji_color_not_allowed', new Error('emoji_color_not_allowed'), { id });
        return;
      }
      const current = allScopedDestinations.find((destination) => destination.id === id);
      if (!current) {
        logError('destination_emoji_color_missing', new Error('destination_not_found'), { id });
        return;
      }
      try {
        // Emoji only — flag color is day-scoped via day header picker.
        // The durable edit paints the local snapshot and owns rejection rollback.
        await updateDestinationEmojiColor(groupId, id, {
          emoji: next.emoji ?? null,
          markerColor: next.markerColor ?? current.markerColor ?? null,
        });
      } catch (e) {
        logError('destination_emoji_color_failed', e, { id });
        showOperationFailure(t('map.setFailedTitle'), getOperationErrorMessage(e));
        return;
      }
      try {
        await refresh();
      } catch (e) {
        // Soft-refresh only: server already has the new emoji.
        logError('destination_emoji_color_refresh_failed', e, { id });
      }
    },
    [allScopedDestinations, canEditItinerary, groupId, refresh, showOperationFailure, t],
  );
  const handleUpdateTripDetails = useCallback(async (days: number, date: string) => {
    if (!groupId) return;
    // Departure picker enforces ≥ today for new choices. Existing past
    // departures can be re-saved unchanged so in-progress trips don't jump.
    // Route sheet: local draft only — flush on dismiss.
    routeDraft.setTripDetails(days, date);
  }, [groupId, routeDraft]);

  return {
    flushRouteDraft,
    handleDelete,
    handleDeleteMany,
    handleReorder,
    handleUpdateEmojiColor,
    handleUpdateTripDetails,
    openKmlImportForScope,
  };
}
