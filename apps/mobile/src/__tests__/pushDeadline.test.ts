// Runtime-load the pure Edge helper without extending mobile tsc's rootDir.
const { isExpiredPush } = require('../../../../supabase/functions/send-push/deadline') as {
  isExpiredPush: (payload: { expires_at?: string | null }, now?: number) => boolean;
};

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
