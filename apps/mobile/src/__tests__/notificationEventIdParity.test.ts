/**
 * Parity contract: mobile buildAlignedNotificationEventId must match
 * production Deno eventIdFromPayload for the same vectors.
 *
 * Vectors: supabase/functions/send-push/eventId.vectors.json
 * Deno side runs the real eventId.ts (eventId_test.ts) — this Jest file
 * does NOT reimplement Deno logic.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildAlignedNotificationEventId,
  mapPushCategoryToEventKey,
} from '../utils/notificationDeliveryPolicy';

const sendPushDir = join(__dirname, '../../../../supabase/functions/send-push');
const vectorsPath = join(sendPushDir, 'eventId.vectors.json');
const eventIdModulePath = join(sendPushDir, 'eventId.ts');
const eventIdTestPath = join(sendPushDir, 'eventId_test.ts');
const indexPath = join(sendPushDir, 'index.ts');

type Vector = {
  name: string;
  mobile: Parameters<typeof buildAlignedNotificationEventId>[0];
  deno: Record<string, unknown>;
  expected: string;
};

const vectors: Vector[] = JSON.parse(readFileSync(vectorsPath, 'utf8'));

describe('notification event identity parity (mobile ↔ send-push production)', () => {
  it('loads shared vectors next to production eventId.ts', () => {
    expect(existsSync(vectorsPath)).toBe(true);
    expect(existsSync(eventIdModulePath)).toBe(true);
    expect(existsSync(eventIdTestPath)).toBe(true);
    expect(vectors.length).toBeGreaterThanOrEqual(6);
  });

  it.each(vectors.map((v) => [v.name, v] as const))(
    'mobile matches golden expected for %s',
    (_name, v) => {
      expect(buildAlignedNotificationEventId(v.mobile)).toBe(v.expected);
    },
  );

  it('send-push index imports production eventIdFromPayload (no local reimplementation)', () => {
    const indexSrc = readFileSync(indexPath, 'utf8');
    const eventIdSrc = readFileSync(eventIdModulePath, 'utf8');
    expect(indexSrc).toMatch(/from ["']\.\/eventId\.ts["']/);
    expect(indexSrc).toContain('eventIdFromPayload');
    // Helpers must not be re-declared inline in index.ts
    expect(indexSrc).not.toMatch(/function mapPushCategoryToEventKey\s*\(/);
    expect(indexSrc).not.toMatch(/function eventIdFromPayload\s*\(/);
    expect(eventIdSrc).toContain('export function eventIdFromPayload');
    expect(eventIdSrc).toContain('export function mapPushCategoryToEventKey');
    expect(eventIdSrc.toLowerCase()).toContain('keep lockstep with mobile');
  });

  it('Deno eventId_test exercises production module + shared vectors', () => {
    const testSrc = readFileSync(eventIdTestPath, 'utf8');
    expect(testSrc).toContain('from "./eventId.ts"');
    expect(testSrc).toContain('eventId.vectors.json');
    expect(testSrc).toContain('eventIdFromPayload');
    expect(testSrc).not.toMatch(/function eventIdFromPayload\s*\(/);
  });

  it('mapPushCategoryToEventKey covers arrival → member_arrival', () => {
    expect(mapPushCategoryToEventKey('arrival')).toBe('member_arrival');
  });
});
