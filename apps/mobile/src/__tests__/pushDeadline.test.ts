// Runtime-load the pure Edge helper without extending mobile tsc's rootDir.
const source = require('node:fs').readFileSync(require('node:path').resolve(__dirname,
  '../../../../supabase/functions/send-push/deadline.ts'), 'utf8');
const compiled = require('typescript').transpileModule(source, { compilerOptions: { module: 1 } }).outputText;
const edgeExports: { isExpiredPush?: (payload: { expires_at?: string | null }, now?: number) => boolean } = {};
require('node:vm').runInNewContext(compiled, { exports: edgeExports });
const isExpiredPush = edgeExports.isExpiredPush!;

describe('durable push deadline', () => {
  it('preserves older event formats without a deadline', () => {
    expect(isExpiredPush({}, 1_000)).toBe(false);
  });
  it('drops expired and malformed deadlines but accepts unexpired commands', () => {
    expect(isExpiredPush({ expires_at: new Date(999).toISOString() }, 1_000)).toBe(true);
    expect(isExpiredPush({ expires_at: new Date(1_000).toISOString() }, 1_000)).toBe(true);
    expect(isExpiredPush({ expires_at: 'invalid' }, 1_000)).toBe(true);
    expect(isExpiredPush({ expires_at: new Date(1_001).toISOString() }, 1_000)).toBe(false);
  });
});
