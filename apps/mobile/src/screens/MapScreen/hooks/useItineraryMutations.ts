import { makeDestinationRegular } from '../../../api/services/DestinationService';
import { reorderDestinations, updateGroupTripDetails, deleteDestination, addDestination, clearDailyAccommodation, setDailyAccommodation, updateDestinationEmojiColor } from '../../../api/client';
import { demoSetDailyAccommodation, demoSetTripDetails, isDemoGroup } from '../../../api/demo';
import { resolveDailyAccommodationSourceId } from '../../../api/services/DailyAccommodationService';
import { type TranslationKey } from '../../../i18n';
import type { DailyAccommodation, Destination, Group } from '../../../types';
import { logEvent, logError } from '../../../utils/activityLog';
import { confirmAction } from '../../../utils/confirm';
import { buildOpenReorderPayload } from '../../../utils/openReorderSlots';
import { getOperationErrorMessage, classifyOperationError } from '../../../utils/operationError';
import { dateForTripDay, localDayKey, openDestinationsForReorder, parseDateOnlyLocal } from '../../../utils/tripDay';
import { runUiAction } from '../../../utils/uiAction';
import { hasDraftWork } from './useRouteDraft';
import { type ReorderUpdate, applyReorderUpdates, persistedReorderUpdates } from '../itineraryReorder';
import { d6DayNumber, d6Reorder } from '../d6Itinerary';
import { alignMeetTimeToTripDay } from '../../../utils/meetTime';
import React, { useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import type { RouteDraft } from './useRouteDraft';
import type { GroupReloadReason } from '../../../utils/syncAuthority';

export interface UseItineraryMutationsInput {
  allScopedDestinations: Destination[];
  allTripDestinations?: Destination[];
  canEditD6Trip?: boolean;
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
  allTripDestinations = allScopedDestinations,
  canEditD6Trip = false,
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
  const pooledStays = useRef(new Map<string, string>());
  const convertedStays = useRef(new Map<string, string>());

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

  const persistRouteDeletions = useCallback(async (ids: string[], inline = false): Promise<boolean> => {
    if (!groupId || !canEditItinerary) return false;
    const context = workflowContext;
    const isCurrent = () => isWorkflowContextCurrent(context);
    try {
      for (const id of ids) {
        if (!isCurrent()) return false;
        const source = inline ? allScopedDestinations : routeDraft.latestDestinations() ?? routeEditorServerDestinations;
        const original = source.find((destination) => destination.id === id);
        if (inline && (!original || original.closedAt)) return false;
        const sessionId = original ? resolveCurrentNavigationSessionId(original) : null;
        if (!id.startsWith('draft-')) await deleteDestination(groupId, id, sessionId);
        if (!isCurrent()) return false;
        if (isDemoGroup(groupId)) await refresh();
        else await refreshLocalSnapshot();
        if (!isCurrent()) return false;
        stopRemovedDestination(id, sessionId);
        const draft = routeDraft.latestDestinations();
        if (draft) routeDraft.setDestinations(draft.filter(d => d.id !== id));
        routeDraft.forgetDeleted(id);
        setRouteSelectedIds(previous => previous.filter(value => value !== id));
      }
      return true;
    } catch (cause) {
      // Service returns after a local transaction. Only a real local-save failure reaches here.
      if (isCurrent()) {
        if (inline) showOperationFailure(t('map.setFailedTitle'), getOperationErrorMessage(cause));
        else Alert.alert(t('map.setFailedTitle'), getOperationErrorMessage(cause));
      }
      return false;
    }
  }, [canEditItinerary, groupId, resolveCurrentNavigationSessionId, routeEditorServerDestinations, routeDraft, setRouteSelectedIds,
    refresh, refreshLocalSnapshot, stopRemovedDestination, t, workflowContext, isWorkflowContextCurrent,
    allScopedDestinations, showOperationFailure]);

  const deleteD6Destinations = useCallback((ids: string[]) => persistRouteDeletions(ids, true), [persistRouteDeletions]);

  const refreshD6Itinerary = useCallback(async () => {
    if (isDemoGroup(groupId)) await refresh();
    else {
      await refreshLocalSnapshot();
      void refresh().catch(() => undefined);
    }
  }, [groupId, refresh, refreshLocalSnapshot]);

  const addD6StayToPool = useCallback(async (stay: DailyAccommodation) => {
    if (!groupId) return;
    const previousId = pooledStays.current.get(stay.id);
    if (previousId) return;
    const id = await addDestination(groupId, {
      title: stay.title,
      address: stay.address,
      coordinates: stay.coordinates,
      day: null,
    });
    if (!id) throw new Error('missing_pooled_stay');
    pooledStays.current.set(stay.id, id);
  }, [groupId]);

  const moveD6StayToPool = useCallback(async (stay: DailyAccommodation) => {
    if (!groupId) return;
    const source = allTripDestinations.find((row) => row.id === stay.sourceDestinationId && !row.closedAt);
    if (!source) {
      await addD6StayToPool(stay);
      return;
    }
    if (source.id === navTargetId || source.id === group?.activeDestinationId) throw new Error(t('trip.endBeforePool'));
    const scope = allTripDestinations.filter((row) => row.subgroupId === source.subgroupId);
    const updates = d6Reorder(scope, { ids: [source.id], day: null });
    if (updates.length) await reorderDestinations(groupId, persistedReorderUpdates(scope, updates, routeDepartureDate));
  }, [addD6StayToPool, allTripDestinations, group?.activeDestinationId, groupId, navTargetId, routeDepartureDate, t]);

  const saveD6DailyAccommodation = useCallback(async (stayDate: string, day: number | undefined,
    stay: Pick<DailyAccommodation, 'title' | 'address' | 'coordinates' | 'sourceDestinationId'> | null) => {
    if (!groupId) return;
    if (isDemoGroup(groupId)) demoSetDailyAccommodation(stayDate, stay);
    else if (stay) await setDailyAccommodation(groupId, stayDate, { ...stay, day });
    else await clearDailyAccommodation(groupId, stayDate, day);
  }, [groupId]);

  const assignD6Accommodation = useCallback(async (
    day: number,
    input: Pick<DailyAccommodation, 'title' | 'address' | 'coordinates' | 'sourceDestinationId'>,
  ) => {
    if (!groupId || !canEditD6Trip || !Number.isInteger(day) || day < 1 || day > (routeTripDays ?? 1)) return false;
    const departure = routeDepartureDate ?? localDayKey(new Date());
    const date = dateForTripDay(departure, day);
    if (!date) return false;
    const stayDate = localDayKey(date);
    const existing = serverDailyAccommodations.find((row) => row.stayDate === stayDate);
    const source = input.sourceDestinationId
      ? allTripDestinations.find((row) => row.id === input.sourceDestinationId && row.subgroupId == null && !row.closedAt)
      : undefined;
    if (input.sourceDestinationId && (!source || source.day !== day)) return false;
    if (source?.id && source.id === existing?.sourceDestinationId) return true;
    if (existing?.sourceDestinationId && [navTargetId, group?.activeDestinationId].includes(existing.sourceDestinationId)) {
      showOperationFailure(t('map.setFailedTitle'), t('trip.endBeforePool'));
      return false;
    }
    const context = workflowContext;
    const isCurrent = () => isWorkflowContextCurrent(context);
    try {
      if (!isCurrent()) return false;
      if (!routeDepartureDate) {
        if (isDemoGroup(groupId)) demoSetTripDetails(routeTripDays ?? 1, departure);
        else await updateGroupTripDetails(groupId, routeTripDays ?? 1, departure);
      }
      if (!isCurrent()) return false;
      if (existing) await moveD6StayToPool(existing);
      if (!isCurrent()) return false;
      await saveD6DailyAccommodation(stayDate, day, input);
      if (existing) pooledStays.current.delete(existing.id);
      await refreshD6Itinerary();
      return true;
    } catch (cause) {
      if (isCurrent()) {
        showOperationFailure(t('map.setFailedTitle'), getOperationErrorMessage(cause));
        await refreshD6Itinerary().catch(() => undefined);
      }
      return false;
    }
  }, [allTripDestinations, canEditD6Trip, group?.activeDestinationId, groupId, isWorkflowContextCurrent, moveD6StayToPool, navTargetId,
    refreshD6Itinerary, routeDepartureDate, routeTripDays, saveD6DailyAccommodation, serverDailyAccommodations,
    showOperationFailure, t, workflowContext]);

  const mutateD6Accommodation = useCallback(async (stay: DailyAccommodation, action: 'delete' | 'pool') => {
    if (!groupId || !canEditD6Trip || stay.groupId !== groupId
      || !serverDailyAccommodations.some((row) => row.id === stay.id)) return false;
    const source = allTripDestinations.find((row) => row.id === stay.sourceDestinationId && !row.closedAt);
    if (action === 'pool' && source?.id === navTargetId) return false;
    const context = workflowContext;
    const isCurrent = () => isWorkflowContextCurrent(context);
    try {
      if (!isCurrent()) return false;
      if (action === 'pool') await moveD6StayToPool(stay);
      else if (source) {
        const sessionId = resolveCurrentNavigationSessionId(source);
        await deleteDestination(groupId, source.id, sessionId);
        if (isCurrent()) stopRemovedDestination(source.id, sessionId);
      }
      if (!isCurrent()) return false;
      const departure = parseDateOnlyLocal(routeDepartureDate);
      const date = parseDateOnlyLocal(stay.stayDate);
      const day = departure && date ? d6DayNumber(departure, date) : undefined;
      await saveD6DailyAccommodation(stay.stayDate, day && day > 0 ? day : undefined, null);
      pooledStays.current.delete(stay.id);
      await refreshD6Itinerary();
      return true;
    } catch (cause) {
      if (isCurrent()) {
        showOperationFailure(t('map.setFailedTitle'), getOperationErrorMessage(cause));
        await refreshD6Itinerary().catch(() => undefined);
      }
      return false;
    }
  }, [allTripDestinations, canEditD6Trip, groupId, isWorkflowContextCurrent, moveD6StayToPool, navTargetId,
    refreshD6Itinerary, resolveCurrentNavigationSessionId, routeDepartureDate, saveD6DailyAccommodation, serverDailyAccommodations,
    showOperationFailure, stopRemovedDestination, t, workflowContext]);

  const unsetD6Accommodation = useCallback(async (
    stop: Destination,
    stay: DailyAccommodation | undefined,
  ): Promise<Destination | false> => {
    if (!groupId || !canEditD6Trip || stop.day == null || stop.closedAt
      || (stay && (stay.groupId !== groupId || !serverDailyAccommodations.some(row => row.id === stay.id)))) return false;

    const source = allTripDestinations.find(row => row.id === (stay?.sourceDestinationId ?? stop.id) && !row.closedAt && !row.subgroupId);
    if (!source && !stay) return false;
    const isCurrent = () => isWorkflowContextCurrent(workflowContext);
    if (!isCurrent()) return false;
    let id = source?.id;
    if (!id && stay) {
      id = convertedStays.current.get(stay.id);
      if (!id) {
        id = await addDestination(groupId, { title: stay.title, address: stay.address, coordinates: stay.coordinates, day: stop.day });
        if (!id) return false;
        convertedStays.current.set(stay.id, id);
      }
    }
    if (!id || !isCurrent()) return false;
    if (source?.kind === 'accommodation') await makeDestinationRegular(groupId, source.id);
    if (!isCurrent()) return false;
    if (stay) {
      await saveD6DailyAccommodation(stay.stayDate, stop.day, null);
      convertedStays.current.delete(stay.id);
    }
    await refreshD6Itinerary();
    return isCurrent() && { ...source ?? stop, id, kind: 'stop', stayAnchor: false };
  }, [allTripDestinations, canEditD6Trip, groupId, isWorkflowContextCurrent, refreshD6Itinerary,
    saveD6DailyAccommodation, serverDailyAccommodations, workflowContext]);

  const updateD6TripDetails = useCallback(async (days: number, date: string) => {
    const nextDeparture = parseDateOnlyLocal(date);
    if (!groupId || !canEditD6Trip || days < 1 || !Number.isInteger(days) || !nextDeparture) return false;
    const previousDeparture = parseDateOnlyLocal(routeDepartureDate) ?? new Date();
    const dateChanged = localDayKey(previousDeparture) !== localDayKey(nextDeparture);
    const open = openDestinationsForReorder(allTripDestinations);
    const displaced = open.filter((row) => (row.day ?? 0) > days);
    if (displaced.some((row) => row.id === navTargetId || row.id === group?.activeDestinationId)) {
      showOperationFailure(t('map.setFailedTitle'), t('trip.endBeforePool'));
      return false;
    }
    const context = workflowContext;
    const isCurrent = () => isWorkflowContextCurrent(context);
    try {
      const stays = serverDailyAccommodations.flatMap((stay) => {
        const oldDate = parseDateOnlyLocal(stay.stayDate);
        if (!oldDate) return [];
        const day = d6DayNumber(previousDeparture, oldDate);
        if (day < 1 || day > (routeTripDays ?? 1)) return [];
        const newDate = day <= days ? dateForTripDay(date, day) : null;
        return [{ stay, day, nextDate: newDate ? localDayKey(newDate) : null }];
      });
      for (const { stay, nextDate } of stays) {
        if (!isCurrent()) return false;
        if (!nextDate && !open.some((row) => row.id === stay.sourceDestinationId)) await addD6StayToPool(stay);
      }

      for (const scopeId of new Set(open.map((row) => row.subgroupId))) {
        if (!isCurrent()) return false;
        const scope = allTripDestinations.filter((row) => row.subgroupId === scopeId);
        const updates = d6Reorder(scope, {
          ids: displaced.filter((row) => row.subgroupId === scopeId).map((row) => row.id),
          day: null,
        });
        const aligned = new Map(open.flatMap((row) => {
          if (!dateChanged || row.subgroupId !== scopeId || row.day == null || row.day > days || !row.meetAt) return [];
          return [[row.id, alignMeetTimeToTripDay(new Date(row.meetAt), date, row.day).toISOString()]];
        }));
        const byId = new Map(scope.map((row) => [row.id, row]));
        const persist = updates.length
          ? persistedReorderUpdates(scope, updates, routeDepartureDate)
          : [...aligned.keys()].flatMap((id) => {
              const row = byId.get(id);
              return row ? [{ id, position: row.order, day: row.day }] : [];
            });
        if (persist.length) await reorderDestinations(groupId, persist.map((update) => {
          const meetAt = aligned.get(update.id);
          return meetAt ? { ...update, meetAt } : update;
        }));
      }
      if (!isCurrent()) return false;
      const incomingDates = new Set(stays.flatMap(({ nextDate }) => nextDate ? [nextDate] : []));
      for (const { stay, day, nextDate } of stays) {
        if (!isCurrent()) return false;
        if (nextDate && nextDate !== stay.stayDate) await saveD6DailyAccommodation(nextDate, day, stay);
      }
      for (const { stay, day } of stays) {
        if (!isCurrent()) return false;
        if (!incomingDates.has(stay.stayDate)) {
          await saveD6DailyAccommodation(stay.stayDate, day, null);
          pooledStays.current.delete(stay.id);
        }
      }
      if (!isCurrent()) return false;
      if (isDemoGroup(groupId)) demoSetTripDetails(days, date);
      else await updateGroupTripDetails(groupId, days, date);
      await refreshD6Itinerary();
      return true;
    } catch (cause) {
      if (isCurrent()) {
        showOperationFailure(t('map.setFailedTitle'), getOperationErrorMessage(cause));
        await refreshD6Itinerary().catch(() => undefined);
      }
      return false;
    }
  }, [addD6StayToPool, allTripDestinations, canEditD6Trip, group?.activeDestinationId, groupId, isWorkflowContextCurrent, navTargetId,
    refreshD6Itinerary, routeDepartureDate, routeTripDays, saveD6DailyAccommodation, serverDailyAccommodations,
    showOperationFailure, t, workflowContext]);

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
    assignD6Accommodation,
    deleteD6Destinations,
    flushRouteDraft,
    handleDelete,
    handleDeleteMany,
    handleReorder,
    handleUpdateEmojiColor,
    handleUpdateTripDetails,
    mutateD6Accommodation,
    unsetD6Accommodation,
    openKmlImportForScope,
    updateD6TripDetails,
  };
}
