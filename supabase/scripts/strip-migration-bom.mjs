/**
 * Strip UTF-8 BOM from supabase/migrations/*.sql in the working tree only.
 * Deployed migration files stay byte-immutable in git; supabase CLI 2.x
 * rejects a leading BOM when applying a fresh local database.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const bom = Buffer.from([0xef, 0xbb, 0xbf]);

for (const name of readdirSync(migrationsDir)) {
  if (!name.endsWith('.sql')) continue;
  const path = join(migrationsDir, name);
  const buf = readFileSync(path);
  if (buf.length >= 3 && buf.subarray(0, 3).equals(bom)) {
    writeFileSync(path, buf.subarray(3));
    console.log(`stripped BOM ${name}`);
  }
}
