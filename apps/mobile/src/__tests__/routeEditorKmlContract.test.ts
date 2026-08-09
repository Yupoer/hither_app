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
    '../../../../supabase/migrations/20260810005000_import_itinerary_batch.sql',
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

  it('route list is scope-filtered for leaders and day-1 reorderable', () => {
    expect(mapScreen).not.toMatch(/rawDestinations[\s\S]{0,200}if \(isLeader\) return all/);
    expect(reorder).toContain('const reorderable = canReorder;');
    expect(reorder).not.toContain('canReorder && item.day > 1');
  });

  it('open-once sync + import CTA replace always-on sync button', () => {
    expect(mapScreen).toContain('routeOpenSyncSessionRef');
    expect(mapScreen).toContain('onImport={() => setKmlVisible(true)}');
    expect(reorder).toContain('onImport');
    expect(reorder).toContain("t('kml.entry')");
  });

  it('route editor mutations use openDestinations only (exiting snapshots carousel-only)', () => {
    // DestinationReorderList must not receive merged exiting carousel rows.
    const reorderStart = mapScreen.indexOf('<DestinationReorderList');
    expect(reorderStart).toBeGreaterThan(-1);
    const reorderBlock = mapScreen.slice(reorderStart, reorderStart + 600);
    expect(reorderBlock).toContain('destinations={openDestinations}');
    expect(reorderBlock).not.toContain('destinations={destinations}');
    // Merged exiting list still exists for carousel presentation.
    expect(mapScreen).toContain('mergeExitingDestinations');
    expect(mapScreen).toContain('const destinations = useMemo');
    // Persisted position slots must come from open editor scope, not carousel.
    const handleStart = mapScreen.indexOf('const handleReorder = useCallback');
    const handleEnd = mapScreen.indexOf('reorderForNavigationRef.current = handleReorder');
    const handleBlock = mapScreen.slice(handleStart, handleEnd);
    expect(handleBlock).toContain('openPositionSlotsFromOpenDestinations(openDestinations)');
    expect(handleBlock).toContain('mapOpenReorderToPersistedPositions');
    expect(handleBlock).not.toMatch(
      /openPositionSlots\s*=\s*\[\.\.\.destinations\]/,
    );
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

  it('migration is security invoker with leader auth, subgroup ownership, revoke public/anon', () => {
    expect(migration).toContain('security invoker');
    expect(migration).toContain('leader membership required');
    expect(migration).toContain('subgroup does not belong to group');
    expect(migration).toContain('s.group_id = p_group_id');
    expect(migration).toContain('revoke all on function public.import_itinerary_batch');
    expect(migration).toContain('grant execute');
    expect(migration).not.toMatch(/security definer/i);
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
