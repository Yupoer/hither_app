import AsyncStorage from '@react-native-async-storage/async-storage';
const cache = new Map<string, Set<string>>();
let writes = Promise.resolve();
const key = (actor: string, group: string) => `@hither/ended-navigation/${actor}/${group}`;
export async function readEndedNavigationSessions(actor: string, group: string): Promise<Set<string>> {
  const id = key(actor, group);
  if (cache.has(id)) return new Set(cache.get(id));
  const raw = await AsyncStorage.getItem(id);
  const parsed: unknown = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(parsed) || parsed.some(value => typeof value !== 'string')) throw new Error('Invalid ended navigation history');
  const values = new Set<string>(parsed as string[]);
  for (const value of cache.get(id) ?? []) values.add(value);
  cache.set(id, values);
  return new Set(values);
}
/** Exact session IDs only: an old End must never hide a future Start. */
export async function rememberEndedNavigationSession(actor: string, group: string, session: string): Promise<void> {
  const id = key(actor, group);
  const work = writes.then(async () => {
    const values = await readEndedNavigationSessions(actor, group);
    values.add(session);
    cache.set(id, values);
    await AsyncStorage.setItem(id, JSON.stringify([...values]));
  });
  writes = work.catch(() => undefined);
  return work;
}

/** Match Postgres epoch-ms projection, including microseconds and timezone variants. */
export function legacyNavigationSessionKey(startedAt: string | null | undefined, destinationId: string | null | undefined): string {
  const value = startedAt ?? '';
  const fraction = value.match(/\.(\d+)(?=Z|[+-]\d{2}(?::?\d{2})?$)/);
  const millis = fraction
    ? Date.parse(value.replace(`.${fraction[1]}`, '.000')) + Math.round(Number(`0.${fraction[1]}`) * 1000)
    : Date.parse(value);
  return `legacy:${Number.isFinite(millis) ? millis : value}:${destinationId ?? ''}`;
}
