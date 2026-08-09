import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mapScreen = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');
const reorder = readFileSync(
  join(__dirname, '../components/DestinationReorderList.tsx'),
  'utf8',
);
const kmlSheet = readFileSync(join(__dirname, '../components/KmlImportSheet.tsx'), 'utf8');
const migration = readFileSync(
  join(
    __dirname,
    '../../../../supabase/migrations/20260810000000_import_itinerary_batch.sql',
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

  it('KmlImportSheet maps persistence separately from parse', () => {
    expect(kmlSheet).toContain('kmlImportErrorI18nKey');
    expect(kmlSheet).toContain('kml.errPersistence');
    expect(kmlSheet).not.toMatch(/catch \{\s*setStep\(\{ kind: 'error', code: 'unknown' \}\)/);
  });

  it('migration is security invoker with leader auth and revoke public/anon', () => {
    expect(migration).toContain('security invoker');
    expect(migration).toContain('leader membership required');
    expect(migration).toContain('revoke all on function public.import_itinerary_batch');
    expect(migration).toContain('grant execute');
    expect(migration).not.toMatch(/security definer/i);
  });
});
