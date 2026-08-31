import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mapScreen = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');
const reorder = readFileSync(
  join(__dirname, '../components/DestinationReorderList.tsx'),
  'utf8',
);
const kmlSheet = readFileSync(join(__dirname, '../components/KmlImportSheet.tsx'), 'utf8');
const destinationService = readFileSync(
  join(__dirname, '../api/services/DestinationService.ts'),
  'utf8',
);
const migration = readFileSync(
  join(
    __dirname,
    '../../../../supabase/migrations/20260831010000_import_quota_and_scope_authority.sql',
  ),
  'utf8',
);

describe('route editor + KML contracts (#151)', () => {
  it('imports via atomic batch, not per-item addDestination loop', () => {
    expect(mapScreen).toContain('addDestinationsBatch');
    expect(mapScreen).toContain('normalizeImportBatch');
    const start = mapScreen.indexOf('const handleKmlImport = useCallback');
    const end = mapScreen.indexOf('const openCoordinateSheet', start);
    const block = mapScreen.slice(start, end);
    expect(block).toContain('addDestinationsBatch');
    expect(block).not.toMatch(/for \(let i = 0; i < items\.length/);
    expect(block).not.toContain('await addDestination(');
  });

  it('route list is scope-filtered for leaders; day>1 whole-day blocks may drag', () => {
    expect(mapScreen).not.toMatch(/rawDestinations[\s\S]{0,200}if \(isLeader\) return all/);
    // Stops drag only in interactionMode drag; Day1 header fixed; Day2+ swipe-toggle drag moves whole block.
    expect(reorder).toContain('interactionMode === \'drag\'');
    expect(reorder).toContain('canDrag={canDragStop}');
    expect(reorder).toContain("type === 'header'");
    expect(reorder).toContain('canDragHeader');
    expect(reorder).toContain('moveDayBlockBefore');
    expect(reorder).toContain('item.day > 1');
    expect(reorder).toContain('entry.day <= 1');
    expect(reorder).toContain('headerAffordanceByDay');
    expect(reorder).toContain('const canSwipeToggle = canReorder && item.day > 1');
    expect(reorder).toContain('const showCollapseAffordance');
    expect(reorder).toContain('const showDragAffordance');
    expect(reorder).toContain('onSwipeToggleAffordance');
    expect(reorder).toContain('drop-after-header');
  });
  it('open-once sync + import CTA replace always-on sync button', () => {
    expect(mapScreen).toContain('routeOpenSyncSessionRef');
    expect(mapScreen).toContain('openKmlImportForScope');
    expect(mapScreen).toContain('onImport={() => { void openKmlImportForScope(routeEditorScopeId); }}');
    expect(mapScreen).toContain('remainingQuota={kmlRemainingQuota}');
    expect(reorder).toContain('onImport');
    expect(reorder).toContain("t('kml.entry')");
  });

  it('route editor mutations use full open reorder list (exiting snapshots carousel-only)', () => {
    // DestinationReorderList must not receive merged exiting carousel rows.
    const reorderStart = mapScreen.indexOf('visible={overlay === \'route\'}');
    expect(reorderStart).toBeGreaterThan(-1);
    const reorderBlock = mapScreen.slice(reorderStart, reorderStart + 9000);
    // Full open list (all days) via openForRouteEditor — not day-gated carousel.
    expect(reorderBlock).toContain('destinations={openForRouteEditor}');
    expect(reorderBlock).not.toContain('destinations={destinations}');
    expect(mapScreen).toContain('openDestinationsForReorder');
    // Merged exiting list still exists for carousel presentation.
    expect(mapScreen).toContain('mergeExitingDestinations');
    expect(mapScreen).toContain('const destinations = useMemo');
    // Slot remap lives on applyReorderToDestinations (shared local + nav persist).
    expect(mapScreen).toContain('openPositionSlotsFromOpenDestinations');
    expect(mapScreen).toContain('mapOpenReorderToPersistedPositions');
    expect(mapScreen).toContain('buildOpenReorderPayload');
    expect(mapScreen).not.toMatch(
      /openPositionSlots\s*=\s*\[\.\.\.destinations\]/,
    );
  });

  it('route editor reorder is local draft; network flush on sheet dismiss', () => {
    expect(mapScreen).toContain('destination_reorder_local');
    expect(mapScreen).toContain('flushRouteDraft');
    expect(mapScreen).toContain('route_draft_flush');
    // Navigation promote still persists immediately.
    expect(mapScreen).toContain('reorderForNavigationRef.current = persistReorderNow');
    // Route list onReorder is the local handler.
    expect(mapScreen).toContain('onReorder={handleReorder}');
    // No 3s optimistic timeout that clobbers draft.
    expect(mapScreen).not.toMatch(/setOptimisticDestinations\(null\);\s*\}, 3000\)/);
  });

  it('route flush uses neutral errors, longer timeout, and dirty snapshot', () => {
    const start = mapScreen.indexOf('const flushRouteDraft = useCallback');
    expect(start).toBeGreaterThanOrEqual(0);
    const block = mapScreen.slice(start, start + 9000);
    expect(block).toContain('timeoutMs: 60_000');
    expect(block).toContain("t('map.routeSaveFailedTitle')");
    expect(block).toContain("t('map.routeSaveFailed')");
    expect(block).toContain("t('interaction.timeout')");
    // Must not blame leader role on route-sheet save failures.
    expect(block).not.toContain("t('map.setFailedMsg')");
    expect(block).toContain('deletedIds: [...routeDraftDirtyRef.current.deletedIds]');
    expect(block).toContain('draft_ids_in_reorder');
    expect(block).toContain('draft_materialize_empty');
  });

  it('open-route sync preserves dirty draft instead of wiping', () => {
    expect(mapScreen).toContain('Never wipe an in-progress / failed-retry draft');
    expect(mapScreen).toContain('hasDirty');
  });

  it('favorites CTA stays visible with empty list; multi-mode + bulk delete wired', () => {
    // Empty favorites must not hide the entry (regression).
    expect(reorder).not.toMatch(
      /onPickFavorite && \(favoritePlaces\?\.length \?\? 0\) > 0/,
    );
    expect(reorder).toContain("t('stay.noFavorites')");
    expect(reorder).toContain('HANDLE_SLOT');
    expect(reorder).toContain('multiSelect');
    expect(mapScreen).toContain('routeInteractionMode');
    expect(mapScreen).toContain('handleDeleteMany');
    expect(mapScreen).toContain('headerLeft');
    expect(mapScreen).toContain("t('route.deleteSelected'");
  });

  it('uses the checkbox alone for multi-select and keeps day blocks seam-free', () => {
    expect(reorder).toContain('multiSelected');
    expect(reorder).not.toContain('rowMultiSelected');
    expect(reorder).not.toContain('dayBlockSpaced');
    expect(reorder).not.toMatch(/dayBlock:\s*\{[\s\S]*?border(?:Top|Bottom)Width/);
  });

  it('quick-add CTA requires day stops; stay commit waits for finish', () => {
    expect(reorder).toContain('dayStopCount > 0');
    expect(reorder).toContain('pendingStayDestId');
    expect(reorder).toContain('stay.finishSet');
    // Checkbox must not call onSetDailyFromDestination immediately.
    expect(reorder).toMatch(/setPendingStayDestId\(item\.item\.id\)/);
    expect(reorder).toContain('setStayCancelLabel');
    expect(reorder).toContain('onCancelSetStay');
    expect(reorder).toContain("t('common.cancel')");
  });

  it('ghost drag: no mid-move setOrder; deleteBg hidden while active; release commits', () => {
    // Move path must not re-parent rows (cross-day freeze root cause).
    expect(reorder).toContain('Do NOT setOrder mid-move');
    expect(reorder).toContain('orderAfterDragMove');
    expect(reorder).toContain('canSwipe && !active');
    expect(reorder).toContain('selectionTick');
    expect(reorder).toContain('lightTap');
  });

  it('open-sync completion is gated by generation after close/reopen', () => {
    expect(mapScreen).toContain('routeOpenSyncGenerationRef');
    expect(mapScreen).toContain(
      'if (generation !== routeOpenSyncGenerationRef.current) return',
    );
    expect(mapScreen).toContain('routeOpenSyncGenerationRef.current += 1');
  });

  it('meet-time sheet exposes approved sections and selected quick state', () => {
    expect(mapScreen).toContain("t('meetTime.quickSection')");
    expect(mapScreen).toContain("t('meetTime.timeSection')");
    expect(mapScreen).toContain("t('meetTime.redInfo')");
    expect(mapScreen).toContain('meetTimeEditor.quickMinutes === m');
    expect(mapScreen).toContain('styles.meetDateSummary');
  });

  it('KmlImportSheet maps persistence separately from parse', () => {
    expect(kmlSheet).toContain('kmlImportErrorI18nKey');
    expect(kmlSheet).toContain('kml.errPersistence');
    expect(kmlSheet).not.toMatch(/catch \{\s*setStep\(\{ kind: 'error', code: 'unknown' \}\)/);
  });

  it('uses native child-sheet boundaries and scoped route-row surfaces', () => {
    expect(reorder).toContain("from '../screens/MapScreen/components/SettingsChildSheet'");
    expect((reorder.match(/<SettingsChildSheet/g) ?? [])).toHaveLength(3);
    expect(reorder).toContain('action="commit"');
    expect(reorder).toContain('shouldHighlightStayDuplicate');
    expect(reorder).toContain('rowStayDuplicate');
    expect(reorder).toContain("from 'react-native-gesture-handler/ReanimatedSwipeable'");
    expect(reorder).toContain('renderRightActions');
    expect(reorder).toContain('overshootRight={false}');
    expect(reorder).not.toContain('rowStayMatch');
    const rowStart = reorder.indexOf('const Row = memo(function Row');
    const rowBlock = reorder.slice(rowStart, reorder.indexOf('/** Dim checkbox', rowStart));
    expect(rowBlock).not.toContain('translateX');
    expect(rowBlock).not.toContain('deleteBg');
    expect(rowBlock).toContain('methods.close()');
    expect(rowBlock).toContain('onDelete?.(item.id)');
    expect(rowBlock).toContain('enabled={canSwipe && !active}');
    expect(rowBlock).toContain('onPanResponderMove');
    expect(rowBlock).toContain('onPanResponderRelease');
    expect(reorder).not.toContain('rowAccommodation');
    expect(reorder).toContain('backgroundColor: glass.fill');
    expect(kmlSheet).toContain('<SettingsChildSheet');
  });

  it('migration keeps the batch return contract, locks account quota, and revokes public/anon', () => {
    expect(migration).toContain('security definer');
    expect(migration).toContain('can_manage_itinerary_scope');
    expect(migration).toContain('account_import_quotas');
    expect(migration).toContain('select q.used_count into v_quota_used');
    expect(migration).toContain('for update');
    expect(migration).toContain('profile_has_lifetime_premium');
    expect(migration).toContain('personal_premium_is_live');
    expect(migration).toContain('drop policy if exists "itinerary_items: insert if in that subgroup"');
    expect(migration).toContain('subgroup does not belong to group');
    expect(migration).toContain('s.group_id = p_group_id');
    expect(migration).toContain('revoke all on function public.import_itinerary_batch');
    expect(migration).toContain('grant execute');
    expect(migration).toContain("raise exception 'kml import quota exceeded'");
  });

  it('position writers share locked server RPCs (add/reorder/import)', () => {
    const positionMigration = readFileSync(
      join(
        __dirname,
        '../../../../supabase/migrations/20260810010000_itinerary_position_serialization.sql',
      ),
      'utf8',
    );
    const reorderSnapshotMigration = readFileSync(
      join(
        __dirname,
        '../../../../supabase/migrations/20260810020000_reorder_itinerary_locked_snapshot.sql',
      ),
      'utf8',
    );
    const boundaryMigration = readFileSync(
      join(
        __dirname,
        '../../../../supabase/migrations/20260810030000_itinerary_position_rpc_boundary.sql',
      ),
      'utf8',
    );
    const accommodationRpcMigration = readFileSync(
      join(
        __dirname,
        '../../../../supabase/migrations/20260810030100_accommodation_position_rpc_integration.sql',
      ),
      'utf8',
    );
    expect(positionMigration).toContain('add_itinerary_item');
    expect(positionMigration).toContain('reorder_itinerary_items');
    expect(positionMigration).toContain('for update');
    // r2: ordered IDs → locked slots; full-batch validate; ignore stale positions.
    expect(reorderSnapshotMigration).toContain('Client "position" is ignored');
    expect(reorderSnapshotMigration).toContain('duplicate reorder id');
    expect(reorderSnapshotMigration).toContain('cannot reorder closed itinerary items');
    expect(reorderSnapshotMigration).toContain('reorder ids missing or out of scope');
    expect(reorderSnapshotMigration).toContain('permission denied');
    // r3: approval/coordination writers share the same group lock as add/reorder.
    expect(boundaryMigration).toContain('create or replace function public.resolve_gather_point_request');
    expect(boundaryMigration).toContain('create or replace function public.coordination_apply_outcome');
    expect(boundaryMigration).toMatch(
      /resolve_gather_point_request[\s\S]*for update/,
    );
    expect(boundaryMigration).toMatch(
      /coordination_apply_outcome[\s\S]*for update/,
    );
    expect(accommodationRpcMigration).toMatch(
      /add_itinerary_item[\s\S]*p_kind text default 'stop'[\s\S]*p_stay_anchor boolean default false/,
    );
    expect(accommodationRpcMigration).toMatch(
      /if v_kind = 'accommodation'[\s\S]*order by i\.position desc[\s\S]*tail\.stay_anchor/,
    );
    expect(accommodationRpcMigration).toContain("v_item ? 'stay_anchor'");
    expect(accommodationRpcMigration).toContain('v_has_stay_anchors[v_idx]');
    expect(destinationService).toContain("rpc('add_itinerary_item'");
    expect(destinationService).toContain("rpc('reorder_itinerary_items'");
    expect(destinationService).toContain("rpc('import_itinerary_batch'");
    expect(destinationService).toContain('reorder_incomplete');
    // No direct multi-step position shift on the client path.
    expect(destinationService).not.toMatch(
      /\.from\('itinerary_items'\)[\s\S]{0,200}\.update\(\{\s*position:/,
    );
  });
});
