/**
 * Ticket 05 — regression guard against hard-coded CJK user copy in migrated surfaces.
 * Conservative: scans priority screens/components for Alert.alert Chinese and
 * obvious string-literal CJK outside allowlists.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..');

const SCAN_ROOTS = [
  join(SRC, 'screens'),
  join(SRC, 'components'),
  join(SRC, 'onboarding'),
];

/** Files still carrying intentional non-catalog CJK (emoji catalogs, etc.). */
const FILE_ALLOWLIST = new Set([
  // Destination emoji/color catalog uses bilingual labels by design.
  'utils/destinationEmojiColor.ts',
  // Locale catalogs themselves.
  'i18n/locales/zh.ts',
  'i18n/locales/en.ts',
]);

/** Line-level exceptions (comments, brand, test ids). */
const LINE_ALLOW = [
  /^\s*\/\//, // line comment
  /^\s*\*/, // block comment body
  /Hither/,
  /console\.(log|warn|error|debug)/,
  /logEvent\(|logError\(/,
  /@deprecated/,
  /eslint-disable/,
];

const CJK = /[\u4e00-\u9fff]/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      walk(full, out);
    } else if (/\.(tsx|ts)$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx')) {
      out.push(full);
    }
  }
  return out;
}

function isAllowlistedFile(abs: string): boolean {
  const rel = relative(SRC, abs).replace(/\\/g, '/');
  if (FILE_ALLOWLIST.has(rel)) return true;
  if (rel.startsWith('i18n/')) return true;
  if (rel.includes('__tests__')) return true;
  return false;
}

describe('no hard-coded user-facing CJK in migrated UI surfaces', () => {
  const files = SCAN_ROOTS.flatMap((root) => walk(root)).filter((f) => !isAllowlistedFile(f));

  it('scans at least the priority screens', () => {
    const rels = files.map((f) => relative(SRC, f).replace(/\\/g, '/'));
    expect(rels.some((r) => r.includes('MyTeamsScreen'))).toBe(true);
    expect(rels.some((r) => r.includes('AccountSheet'))).toBe(true);
    expect(files.length).toBeGreaterThan(20);
  });

  it('flags Alert.alert with CJK string literals in migrated files', () => {
    const offenders: string[] = [];
    const priority = files.filter((f) => {
      const rel = relative(SRC, f).replace(/\\/g, '/');
      return (
        rel.includes('MyTeamsScreen')
        || rel.includes('AccountSheet')
        || rel.includes('RoleSelectScreen')
        || rel.includes('AppErrorBoundary')
      );
    });

    for (const file of priority) {
      const src = readFileSync(file, 'utf8');
      const rel = relative(SRC, file).replace(/\\/g, '/');
      // Alert.alert('中文' ...) or Alert.alert("中文"
      const alertRe = /Alert\.alert\s*\(\s*(['"`])([^'"`]*[\u4e00-\u9fff][^'"`]*)\1/g;
      let m: RegExpExecArray | null;
      while ((m = alertRe.exec(src))) {
        offenders.push(`${rel}: Alert.alert(${m[1]}${m[2]}${m[1]})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('flags obvious hard-coded CJK string literals in MyTeamsScreen', () => {
    const file = files.find((f) => f.replace(/\\/g, '/').endsWith('MyTeamsScreen.tsx'));
    expect(file).toBeTruthy();
    const src = readFileSync(file!, 'utf8');
    const lines = src.split(/\r?\n/);
    const hits: string[] = [];
    lines.forEach((line, i) => {
      if (!CJK.test(line)) return;
      if (LINE_ALLOW.some((re) => re.test(line))) return;
      // Allow t('...') keys only — any remaining quote-wrapped CJK is a hit.
      if (/t\(\s*['"][^'"]+['"]/.test(line) && !/['"`][^'"`]*[\u4e00-\u9fff]/.test(line.replace(/t\([^)]*\)/g, ''))) {
        return;
      }
      const lit = line.match(/(['"`])([^'"`]*[\u4e00-\u9fff][^'"`]*)\1/);
      if (lit) hits.push(`L${i + 1}: ${lit[0]}`);
    });
    expect(hits).toEqual([]);
  });
});
